import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { appRequest, createLiveContext, type LiveAppContext } from "./live-smoke-context.ts";

const POLL_INTERVAL_MS = 3_000;
const TRANSCRIPTION_TIMEOUT_MS = 15 * 60 * 1_000;
const DREAM_TIMEOUT_MS = 45 * 60 * 1_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const envSchema = z.object({
  DREAMTRACE_VOICE_SMOKE: z.literal("1"),
  DREAMTRACE_BASE_URL: z.url().default("http://localhost:3000"),
  DREAMTRACE_AUDIO_PATH: z.string().min(1),
  DREAMTRACE_AUDIO_MIME: z.enum(["audio/webm", "audio/mp4", "audio/ogg"]),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});
const uploadSchema = z.object({
  dreamId: z.uuid(), path: z.string().min(1), token: z.string().min(1),
}).strict();
const startSchema = z.object({ dreamId: z.uuid(), runId: z.string().nullable() }).strict();
const storySchema = z.object({
  id: z.uuid(), status: z.string(), inputMode: z.literal("audio"), transcript: z.string().nullable(),
  awaitingTranscriptReview: z.boolean(), failedStage: z.string().nullable(), errorCode: z.string().nullable(),
  scenes: z.array(z.object({
    ordinal: z.number().int(), imageUrl: z.url().nullable(),
    versions: z.array(z.object({ status: z.string(), isSelected: z.boolean(), imageUrl: z.url().nullable() })),
  })),
}).passthrough();

type VoiceEnv = z.infer<typeof envSchema>;
type VoiceStory = z.infer<typeof storySchema>;

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const audio = await readAudio(resolveAudioPath(env.DREAMTRACE_AUDIO_PATH));
  const context = await createLiveContext({
    baseUrl: env.DREAMTRACE_BASE_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const upload = await prepareUpload(context, env.DREAMTRACE_AUDIO_MIME);
  await storeAudio(env, upload, audio);
  await completeUploadTwice(context, upload, env.DREAMTRACE_AUDIO_MIME, audio.byteLength);
  const review = await waitForReview(context, upload.dreamId);
  const transcript = z.string().trim().min(10).parse(review.transcript);
  await confirmTranscriptTwice(context, upload.dreamId, transcript);
  await waitForReady(context, upload.dreamId);
  console.log(`voice_demo_ready dream=${upload.dreamId} transcript_words=${transcript.split(/\s+/).length}`);
}

async function readAudio(path: string): Promise<Buffer> {
  const audio = await readFile(path);
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error("Audio fixture must be between 1 byte and 10 MB");
  }
  return audio;
}

function resolveAudioPath(path: string): string {
  if (isAbsolute(path)) return path;
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

async function prepareUpload(context: LiveAppContext, mimeType: VoiceEnv["DREAMTRACE_AUDIO_MIME"]) {
  const payload = await appRequest(context, "/api/dreams/audio", {
    method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), mimeType }),
  });
  const upload = uploadSchema.parse(payload);
  console.log(`voice_upload_ready dream=${upload.dreamId}`);
  return upload;
}

async function storeAudio(
  env: VoiceEnv,
  upload: z.infer<typeof uploadSchema>,
  audio: Buffer,
): Promise<void> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const bytes = new Uint8Array(audio.byteLength);
  bytes.set(audio);
  const result = await client.storage.from("dream-audio").uploadToSignedUrl(
    upload.path,
    upload.token,
    new Blob([bytes], { type: env.DREAMTRACE_AUDIO_MIME }),
    { contentType: env.DREAMTRACE_AUDIO_MIME },
  );
  if (result.error) throw result.error;
  console.log(`voice_uploaded bytes=${audio.byteLength}`);
}

async function completeUploadTwice(
  context: LiveAppContext,
  upload: z.infer<typeof uploadSchema>,
  mimeType: VoiceEnv["DREAMTRACE_AUDIO_MIME"],
  sizeBytes: number,
): Promise<void> {
  const body = JSON.stringify({ path: upload.path, mimeType, sizeBytes });
  const first = startSchema.parse(await appRequest(context, `/api/dreams/${upload.dreamId}/audio`, {
    method: "POST", body,
  }));
  const replay = startSchema.parse(await appRequest(context, `/api/dreams/${upload.dreamId}/audio`, {
    method: "POST", body,
  }));
  if (!first.runId && !replay.runId) throw new Error("Transcription workflow did not start");
  console.log("transcription_started upload_replay=accepted");
}

async function waitForReview(context: LiveAppContext, dreamId: string): Promise<VoiceStory> {
  const deadline = Date.now() + TRANSCRIPTION_TIMEOUT_MS;
  let previous = "";
  while (Date.now() < deadline) {
    const story = await readStory(context, dreamId);
    if (story.status !== previous) console.log(`voice status=${story.status}`);
    previous = story.status;
    if (story.awaitingTranscriptReview && story.transcript) return story;
    assertNotFailed(story, "transcription");
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Voice transcription timed out");
}

async function confirmTranscriptTwice(
  context: LiveAppContext,
  dreamId: string,
  transcript: string,
): Promise<void> {
  const body = JSON.stringify({ transcript });
  const first = startSchema.parse(await appRequest(context, `/api/dreams/${dreamId}/transcript`, {
    method: "POST", body,
  }));
  const replay = startSchema.parse(await appRequest(context, `/api/dreams/${dreamId}/transcript`, {
    method: "POST", body,
  }));
  if (!first.runId || first.runId !== replay.runId) throw new Error("Transcript replay changed the workflow run");
  console.log("transcript_confirmed replay_same_run=true");
}

async function waitForReady(context: LiveAppContext, dreamId: string): Promise<void> {
  const deadline = Date.now() + DREAM_TIMEOUT_MS;
  let previous = "";
  while (Date.now() < deadline) {
    const story = await readStory(context, dreamId);
    if (story.status !== previous) console.log(`voice status=${story.status}`);
    previous = story.status;
    if (story.status === "READY") return assertReady(story);
    assertNotFailed(story, "generation");
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Voice dream generation timed out");
}

async function readStory(context: LiveAppContext, dreamId: string): Promise<VoiceStory> {
  return storySchema.parse(await appRequest(context, `/api/dreams/${dreamId}`));
}

function assertNotFailed(story: VoiceStory, phase: string): void {
  if (story.status === "FAILED") {
    throw new Error(`${phase} failed at ${story.failedStage}:${story.errorCode}`);
  }
}

function assertReady(story: VoiceStory): void {
  if (story.scenes.length !== 3) throw new Error("Voice dream does not have exactly three scenes");
  for (const scene of story.scenes) {
    const selected = scene.versions.filter((version) => version.isSelected);
    if (selected.length !== 1 || selected[0].status !== "COMPLETED" || !selected[0].imageUrl) {
      throw new Error(`Voice scene ${scene.ordinal} has no selected completed image`);
    }
  }
}

await main();
