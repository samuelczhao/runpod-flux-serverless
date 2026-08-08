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
const signedImageSchema = z.object({
  error: z.string().nullable(), path: z.string().nullable(), signedUrl: z.string().nullable(),
}).passthrough();

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
  const imageUrls = await signImages(client, versions);
  return scenes.map((scene) => attachVersions(scene, versions, imageUrls));
}

async function readSceneVersions(client: SupabaseClient<Database>, sceneIds: readonly string[]) {
  const result = await client.from("scene_versions").select(VERSION_FIELDS)
    .in("scene_id", sceneIds).order("created_at");
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(versionRowSchema, result.data);
}

function attachVersions(
  scene: z.infer<typeof sceneRowSchema>,
  versions: readonly z.infer<typeof versionRowSchema>[],
  imageUrls: ReadonlyMap<string, string>,
): StoryScene {
  const matching = versions.filter((version) => version.scene_id === scene.id);
  const storyVersions = matching.map((version) => attachVersionImage(version, imageUrls));
  const selected = storyVersions.find((version) => version.isSelected);
  return { ...scene, versionId: selected?.id ?? null, imageUrl: selected?.imageUrl ?? null, versions: storyVersions };
}

function attachVersionImage(
  version: z.infer<typeof versionRowSchema>,
  imageUrls: ReadonlyMap<string, string>,
) {
  const imageUrl = version.storage_path ? requireSignedImage(imageUrls, version.storage_path) : null;
  return { id: version.id, parentVersionId: version.parent_version_id,
    editInstruction: version.edit_instruction, status: version.status,
    isSelected: version.is_selected, imageUrl };
}

async function signImages(
  client: SupabaseClient<Database>,
  versions: readonly z.infer<typeof versionRowSchema>[],
): Promise<ReadonlyMap<string, string>> {
  const storedPaths = versions.map((version) => version.storage_path)
    .filter((path): path is string => path !== null);
  const paths = [...new Set(storedPaths)];
  if (paths.length === 0) return new Map();
  const result = await client.storage.from("dream-images").createSignedUrls(paths, IMAGE_URL_TTL_SECONDS);
  throwIfDatabaseError(result.error);
  const images = z.array(signedImageSchema).length(paths.length).parse(result.data);
  return new Map(images.map((image) => {
    if (image.error || !image.path || !image.signedUrl) {
      throw new Error("Could not sign one or more dream images");
    }
    return [image.path, z.url().parse(image.signedUrl)] as const;
  }));
}

function requireSignedImage(imageUrls: ReadonlyMap<string, string>, path: string): string {
  const imageUrl = imageUrls.get(path);
  if (!imageUrl) throw new Error("No signed URL returned for a dream image");
  return imageUrl;
}

function needsTranscriptReview(dream: z.infer<typeof dreamRowSchema>): boolean {
  return dream.input_mode === "audio" && dream.status === "PLANNING"
    && dream.workflow_run_id === null && Boolean(dream.transcript);
}

const DREAM_FIELDS = "id,status,input_mode,transcript,workflow_run_id,title,summary,mood,failed_stage,error_code";
const VERSION_FIELDS = "id,scene_id,parent_version_id,storage_path,edit_instruction,status,is_selected";
