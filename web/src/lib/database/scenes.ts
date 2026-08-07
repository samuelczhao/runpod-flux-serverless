import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseDatabaseRow, throwIfDatabaseError } from "@/lib/database/errors";
import { sceneSchema, sceneVersionSchema, type Scene, type SceneVersion } from "@/lib/database/schemas";
import { sha256 } from "@/lib/database/hash";
import { assertVersionModel } from "@/lib/domain/version";

export async function getScene(dreamId: string, ordinal: number): Promise<Scene> {
  const result = await createSupabaseAdminClient().from("scenes").select(SCENE_FIELDS)
    .eq("dream_id", dreamId).eq("ordinal", ordinal).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(sceneSchema, result.data);
}

export async function ensureInitialVersion(
  scene: Scene,
  model: string,
): Promise<SceneVersion> {
  const existing = await findInitialVersion(scene.id);
  if (existing) return requireModel(existing, model);
  const result = await createSupabaseAdminClient().from("scene_versions").insert({
    scene_id: scene.id, model, seed: seedFromId(scene.id), status: "PENDING",
  }).select(VERSION_FIELDS).single();
  if (result.error?.code === "23505") return requireModel(await requireInitialVersion(scene.id), model);
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(sceneVersionSchema, result.data);
}

function requireModel(version: SceneVersion, model: string): SceneVersion {
  assertVersionModel(version, model);
  return version;
}

export async function getSceneVersion(versionId: string): Promise<SceneVersion> {
  const result = await createSupabaseAdminClient().from("scene_versions").select(VERSION_FIELDS)
    .eq("id", versionId).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(sceneVersionSchema, result.data);
}

export async function getSelectedVersion(sceneId: string): Promise<SceneVersion> {
  const result = await createSupabaseAdminClient().from("scene_versions").select(VERSION_FIELDS)
    .eq("scene_id", sceneId).eq("is_selected", true).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(sceneVersionSchema, result.data);
}

async function findInitialVersion(sceneId: string): Promise<SceneVersion | null> {
  const result = await createSupabaseAdminClient().from("scene_versions").select(VERSION_FIELDS)
    .eq("scene_id", sceneId).is("parent_version_id", null).maybeSingle();
  throwIfDatabaseError(result.error);
  return result.data ? parseDatabaseRow(sceneVersionSchema, result.data) : null;
}

async function requireInitialVersion(sceneId: string): Promise<SceneVersion> {
  const version = await findInitialVersion(sceneId);
  if (!version) throw new Error("Initial scene version disappeared after a concurrent insert");
  return version;
}

function seedFromId(id: string): number {
  return Number.parseInt(sha256(id).slice(0, 8), 16);
}

const SCENE_FIELDS = "id,dream_id,ordinal,caption,prompt";
const VERSION_FIELDS = "id,scene_id,parent_version_id,storage_path,seed,model,status,is_selected";
