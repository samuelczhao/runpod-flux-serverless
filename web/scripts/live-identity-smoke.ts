import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { appRequest, createLiveContext, type LiveAppContext } from "./live-smoke-context.ts";
import { MAX_STORY_SCENES, MIN_STORY_SCENES } from "../src/lib/domain/dream.ts";
import { IDENTITY_CONSENT_VERSION, MAX_IDENTITY_IMAGE_BYTES } from "../src/lib/domain/identity.ts";

const POLL_INTERVAL_MS = 3_000;
const DREAM_TIMEOUT_MS = 45 * 60 * 1_000;
const IDENTITY_MIME = "image/png";

const envSchema = z.object({
  DREAMTRACE_IDENTITY_SMOKE: z.literal("1"),
  DREAMTRACE_BASE_URL: z.url().default("http://localhost:3000"),
  DREAMTRACE_IDENTITY_PATH: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});
const preparedSchema = z.object({
  status: z.enum(["upload", "stored", "ready"]),
  identityId: z.uuid(),
  path: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
}).strict();
const identitySchema = z.object({
  identity: z.object({ id: z.uuid(), previewUrl: z.url() }).passthrough().nullable(),
}).strict();
const createdSchema = z.object({ dreamId: z.uuid(), runId: z.string().nullable() }).strict();
const storySchema = z.object({
  id: z.uuid(), status: z.string(), failedStage: z.string().nullable(),
  errorCode: z.string().nullable(), visualStyle: z.literal("watercolor-memory"),
  scenes: z.array(z.object({
    ordinal: z.number().int(),
    versions: z.array(z.object({
      status: z.string(), isSelected: z.boolean(), imageUrl: z.url().nullable(),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

type IdentityEnv = z.infer<typeof envSchema>;
type Story = z.infer<typeof storySchema>;

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const portrait = await readPortrait(resolvePath(env.DREAMTRACE_IDENTITY_PATH));
  const context = await createLiveContext({
    baseUrl: env.DREAMTRACE_BASE_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const identityId = await createIdentity(env, context, portrait);
  const dream = await createDream(context, identityId);
  const story = await waitForDream(context, dream.dreamId);
  await deleteIdentity(context, identityId);
  console.log(`identity_demo_ready dream=${story.id} identity_deleted=true scenes=${story.scenes.length}`);
}

async function readPortrait(path: string): Promise<Buffer> {
  const portrait = await readFile(path);
  if (portrait.byteLength < 1 || portrait.byteLength > MAX_IDENTITY_IMAGE_BYTES) {
    throw new Error("Identity fixture must be between 1 byte and 8 MB");
  }
  return portrait;
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

async function createIdentity(
  env: IdentityEnv,
  context: LiveAppContext,
  portrait: Buffer,
): Promise<string> {
  const body = JSON.stringify({
    operationId: crypto.randomUUID(), mimeType: IDENTITY_MIME, sizeBytes: portrait.byteLength,
    consentConfirmed: true, consentVersion: IDENTITY_CONSENT_VERSION,
  });
  const prepared = preparedSchema.parse(await appRequest(context, "/api/identity/prepare", {
    method: "POST", body,
  }));
  const replay = preparedSchema.parse(await appRequest(context, "/api/identity/prepare", {
    method: "POST", body,
  }));
  if (prepared.identityId !== replay.identityId) throw new Error("Identity replay created a duplicate");
  await uploadPortrait(env, prepared, portrait);
  await completeIdentity(context, prepared.identityId);
  console.log(`identity_ready id=${prepared.identityId} upload_replay=accepted`);
  return prepared.identityId;
}

async function uploadPortrait(
  env: IdentityEnv,
  prepared: z.infer<typeof preparedSchema>,
  portrait: Buffer,
): Promise<void> {
  if (prepared.status !== "upload" || !prepared.path || !prepared.token) {
    throw new Error("New identity did not return a signed upload target");
  }
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const bytes = new Uint8Array(portrait.byteLength);
  bytes.set(portrait);
  const result = await client.storage.from("identity-references").uploadToSignedUrl(
    prepared.path, prepared.token, new Blob([bytes], { type: IDENTITY_MIME }),
    { contentType: IDENTITY_MIME },
  );
  if (result.error) throw result.error;
}

async function completeIdentity(context: LiveAppContext, identityId: string): Promise<void> {
  const path = `/api/identity/${identityId}/complete`;
  const first = identitySchema.parse(await appRequest(context, path, { method: "POST" }));
  const replay = identitySchema.parse(await appRequest(context, path, { method: "POST" }));
  if (first.identity?.id !== identityId || replay.identity?.id !== identityId) {
    throw new Error("Identity completion replay did not return the same reference");
  }
}

async function createDream(context: LiveAppContext, identityReferenceId: string) {
  const body = JSON.stringify({
    transcript: DREAM,
    operationId: crypto.randomUUID(),
    identityReferenceId,
    visualStyle: "watercolor-memory",
  });
  const created = createdSchema.parse(await appRequest(context, "/api/dreams", { method: "POST", body }));
  const replay = createdSchema.parse(await appRequest(context, "/api/dreams", { method: "POST", body }));
  if (created.dreamId !== replay.dreamId || created.runId !== replay.runId) {
    throw new Error("Identity dream replay changed the operation");
  }
  console.log(`identity_dream_started id=${created.dreamId} run=${created.runId}`);
  return created;
}

async function waitForDream(context: LiveAppContext, dreamId: string): Promise<Story> {
  let previous = "";
  const deadline = Date.now() + DREAM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const story = storySchema.parse(await appRequest(context, `/api/dreams/${dreamId}`));
    if (story.status !== previous) console.log(`identity_dream status=${story.status}`);
    previous = story.status;
    if (story.status === "READY") return assertReady(story);
    if (story.status === "FAILED") {
      throw new Error(`Identity dream failed at ${story.failedStage}:${story.errorCode}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Identity dream generation timed out");
}

function assertReady(story: Story): Story {
  const ordinals = story.scenes.map((scene) => scene.ordinal).sort((left, right) => left - right);
  if (ordinals.length < MIN_STORY_SCENES || ordinals.length > MAX_STORY_SCENES
    || ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw new Error("Identity dream does not have one to six contiguous scenes");
  }
  for (const scene of story.scenes) {
    const selected = scene.versions.filter((version) => version.isSelected);
    if (selected.length !== 1 || selected[0].status !== "COMPLETED" || !selected[0].imageUrl) {
      throw new Error(`Identity scene ${scene.ordinal} has no selected completed image`);
    }
  }
  return story;
}

async function deleteIdentity(context: LiveAppContext, identityId: string): Promise<void> {
  const response = await fetch(`${context.baseUrl}/api/identity/${identityId}`, {
    method: "DELETE", headers: { Cookie: context.cookie },
  });
  if (response.status !== 204) throw new Error(`Identity deletion failed with HTTP ${response.status}`);
}

const DREAM = "I crossed a flooded ballroom in my rust-colored sweater while paper birds carried lanterns above me. A mirrored door opened onto a garden floating in the night sky, and I climbed a spiral staircase made of vines until I reached a small moonlit observatory.";

await main();
