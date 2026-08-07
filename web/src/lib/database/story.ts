import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { parseDatabaseRow, parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import { dreamStorySchema, type DreamStory, type StoryScene } from "@/lib/domain/story";

const dreamRowSchema = z.object({
  id: z.uuid(), status: z.string(), title: z.string().nullable(), summary: z.string().nullable(),
  mood: z.array(z.string()), failed_stage: z.string().nullable(), error_code: z.string().nullable(),
}).strict();
const sceneRowSchema = z.object({
  id: z.uuid(), ordinal: z.number().int(), caption: z.string(),
}).strict();
const versionRowSchema = z.object({
  id: z.uuid(), scene_id: z.uuid(), storage_path: z.string(),
}).strict();

export async function readDreamStory(
  client: SupabaseClient<Database>,
  dreamId: string,
): Promise<DreamStory | null> {
  const dream = await readDream(client, dreamId);
  if (!dream) return null;
  const scenes = await readScenes(client, dreamId);
  const storyScenes = await attachSelectedImages(client, scenes);
  return dreamStorySchema.parse({
    id: dream.id, status: dream.status, title: dream.title, summary: dream.summary,
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

async function attachSelectedImages(
  client: SupabaseClient<Database>,
  scenes: readonly z.infer<typeof sceneRowSchema>[],
): Promise<StoryScene[]> {
  if (scenes.length === 0) return [];
  const versions = await readSelectedVersions(client, scenes.map((scene) => scene.id));
  return Promise.all(scenes.map((scene) => attachImage(client, scene, versions)));
}

async function readSelectedVersions(client: SupabaseClient<Database>, sceneIds: readonly string[]) {
  const result = await client.from("scene_versions").select("id,scene_id,storage_path")
    .in("scene_id", sceneIds).eq("is_selected", true);
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(versionRowSchema, result.data);
}

async function attachImage(
  client: SupabaseClient<Database>,
  scene: z.infer<typeof sceneRowSchema>,
  versions: readonly z.infer<typeof versionRowSchema>[],
): Promise<StoryScene> {
  const version = versions.find((candidate) => candidate.scene_id === scene.id);
  if (!version) return { ...scene, versionId: null, imageUrl: null };
  const result = await client.storage.from("dream-images").createSignedUrl(version.storage_path, 600);
  throwIfDatabaseError(result.error);
  return { ...scene, versionId: version.id, imageUrl: z.url().parse(result.data?.signedUrl) };
}

const DREAM_FIELDS = "id,status,title,summary,mood,failed_stage,error_code";
