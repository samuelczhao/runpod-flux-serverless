import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { parseDatabaseRow, parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import { dreamStorySchema, type DreamStory, type StoryScene } from "@/lib/domain/story";
import { jobStatusSchema } from "@/lib/database/schemas";

const IMAGE_URL_TTL_SECONDS = 3_600;

const dreamRowSchema = z.object({
  id: z.uuid(), status: z.string(), title: z.string().nullable(), summary: z.string().nullable(),
  mood: z.array(z.string()), failed_stage: z.string().nullable(), error_code: z.string().nullable(),
  input_mode: z.enum(["audio", "text"]), transcript: z.string().nullable(), workflow_run_id: z.string().nullable(),
}).strict();
const sceneRowSchema = z.object({
  id: z.uuid(), ordinal: z.number().int(), caption: z.string(),
}).strict();
const versionRowSchema = z.object({
  id: z.uuid(), scene_id: z.uuid(), parent_version_id: z.uuid().nullable(),
  storage_path: z.string().nullable(), edit_instruction: z.string().nullable(),
  status: jobStatusSchema, is_selected: z.boolean(),
}).strict();

export async function readDreamStory(
  client: SupabaseClient<Database>,
  dreamId: string,
): Promise<DreamStory | null> {
  const dream = await readDream(client, dreamId);
  if (!dream) return null;
  const scenes = await readScenes(client, dreamId);
  const storyScenes = await attachSceneVersions(client, scenes);
  return dreamStorySchema.parse({
    id: dream.id, status: dream.status, title: dream.title, summary: dream.summary,
    inputMode: dream.input_mode, transcript: dream.transcript,
    awaitingTranscriptReview: needsTranscriptReview(dream),
    mood: dream.mood, failedStage: dream.failed_stage, errorCode: dream.error_code, scenes: storyScenes,
  });
}

async function readDream(client: SupabaseClient<Database>, dreamId: string) {
  const result = await client.from("dreams").select(DREAM_FIELDS).eq("id", dreamId).maybeSingle();
  throwIfDatabaseError(result.error);
  return result.data ? parseDatabaseRow(dreamRowSchema, result.data) : null;
}

async function readScenes(client: SupabaseClient<Database>, dreamId: string) {
  const result = await client.from("scenes").select("id,ordinal,caption")
    .eq("dream_id", dreamId).order("ordinal");
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(sceneRowSchema, result.data);
}

async function attachSceneVersions(
  client: SupabaseClient<Database>,
  scenes: readonly z.infer<typeof sceneRowSchema>[],
): Promise<StoryScene[]> {
  if (scenes.length === 0) return [];
  const versions = await readSceneVersions(client, scenes.map((scene) => scene.id));
  return Promise.all(scenes.map((scene) => attachVersions(client, scene, versions)));
}

async function readSceneVersions(client: SupabaseClient<Database>, sceneIds: readonly string[]) {
  const result = await client.from("scene_versions").select(VERSION_FIELDS)
    .in("scene_id", sceneIds).order("created_at");
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(versionRowSchema, result.data);
}

async function attachVersions(
  client: SupabaseClient<Database>,
  scene: z.infer<typeof sceneRowSchema>,
  versions: readonly z.infer<typeof versionRowSchema>[],
): Promise<StoryScene> {
  const matching = versions.filter((version) => version.scene_id === scene.id);
  const storyVersions = await Promise.all(matching.map((version) => attachVersionImage(client, version)));
  const selected = storyVersions.find((version) => version.isSelected);
  return { ...scene, versionId: selected?.id ?? null, imageUrl: selected?.imageUrl ?? null, versions: storyVersions };
}

async function attachVersionImage(
  client: SupabaseClient<Database>,
  version: z.infer<typeof versionRowSchema>,
) {
  const imageUrl = version.storage_path ? await signImage(client, version.storage_path) : null;
  return { id: version.id, parentVersionId: version.parent_version_id,
    editInstruction: version.edit_instruction, status: version.status,
    isSelected: version.is_selected, imageUrl };
}

async function signImage(client: SupabaseClient<Database>, path: string): Promise<string> {
  const result = await client.storage.from("dream-images").createSignedUrl(path, IMAGE_URL_TTL_SECONDS);
  throwIfDatabaseError(result.error);
  return z.url().parse(result.data?.signedUrl);
}

function needsTranscriptReview(dream: z.infer<typeof dreamRowSchema>): boolean {
  return dream.input_mode === "audio" && dream.status === "PLANNING"
    && dream.workflow_run_id === null && Boolean(dream.transcript);
}

const DREAM_FIELDS = "id,status,input_mode,transcript,workflow_run_id,title,summary,mood,failed_stage,error_code";
const VERSION_FIELDS = "id,scene_id,parent_version_id,storage_path,edit_instruction,status,is_selected";
