import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database/types";
import { parseDatabaseRow, parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import { sceneSchema, sceneVersionSchema, type Scene, type SceneVersion } from "@/lib/database/schemas";
import { sha256 } from "@/lib/database/hash";
import { assertVersionModel } from "@/lib/domain/version";

export async function getScene(dreamId: string, ordinal: number): Promise<Scene> {
  const result = await createSupabaseAdminClient().from("scenes").select(SCENE_FIELDS)
    .eq("dream_id", dreamId).eq("ordinal", ordinal).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(sceneSchema, result.data);
}

export async function getSceneById(sceneId: string): Promise<Scene> {
  const result = await createSupabaseAdminClient().from("scenes").select(SCENE_FIELDS)
    .eq("id", sceneId).single();
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

export async function getOwnedSceneVersion(
  client: SupabaseClient<Database>,
  versionId: string,
): Promise<SceneVersion | null> {
  const result = await client.from("scene_versions").select(VERSION_FIELDS)
    .eq("id", versionId).maybeSingle();
  throwIfDatabaseError(result.error);
  return result.data ? parseDatabaseRow(sceneVersionSchema, result.data) : null;
}

export async function getSelectedVersion(sceneId: string): Promise<SceneVersion> {
  const result = await createSupabaseAdminClient().from("scene_versions").select(VERSION_FIELDS)
    .eq("scene_id", sceneId).eq("is_selected", true).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(sceneVersionSchema, result.data);
}

const branchClaimSchema = z.object({ version_id: z.uuid(), claimed: z.boolean() }).strict();
const branchWorkflowClaimSchema = z.object({
  workflow_id: z.string().nullable(), claimed: z.boolean(),
}).strict();

export interface BranchInput {
  readonly userId: string;
  readonly dreamId: string;
  readonly parentVersionId: string;
  readonly instruction: string;
  readonly model: string;
  readonly seed: number;
  readonly operationKey: string;
  readonly requestHash: string;
}

export interface BranchClaim {
  readonly versionId: string;
  readonly claimed: boolean;
}

export interface BranchWorkflowClaim {
  readonly workflowId: string | null;
  readonly claimed: boolean;
}

export async function createSceneBranch(input: BranchInput): Promise<BranchClaim> {
  const result = await createSupabaseAdminClient().rpc("create_scene_branch", {
    p_user_id: input.userId, p_dream_id: input.dreamId,
    p_parent_version_id: input.parentVersionId, p_instruction: input.instruction,
    p_model: input.model, p_seed: input.seed, p_operation_key: input.operationKey,
    p_request_hash: input.requestHash,
  });
  throwIfDatabaseError(result.error);
  const row = parseDatabaseRows(branchClaimSchema, result.data)[0];
  if (!row) throw new Error("Scene branch creation returned no row");
  return { versionId: row.version_id, claimed: row.claimed };
}

export async function claimBranchWorkflow(
  userId: string,
  versionId: string,
  token: string,
): Promise<BranchWorkflowClaim | null> {
  const result = await createSupabaseAdminClient().rpc("claim_branch_workflow", {
    p_user_id: userId, p_version_id: versionId, p_claim_token: token,
  });
  throwIfDatabaseError(result.error);
  const row = parseDatabaseRows(branchWorkflowClaimSchema, result.data)[0];
  return row ? { workflowId: row.workflow_id, claimed: row.claimed } : null;
}

export async function recordBranchWorkflow(versionId: string, token: string, runId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("record_branch_workflow", {
    p_version_id: versionId, p_claim_token: token, p_run_id: runId,
  });
  throwIfDatabaseError(result.error);
}

export async function releaseBranchWorkflow(versionId: string, token: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("release_branch_workflow_claim", {
    p_version_id: versionId, p_claim_token: token,
  });
  throwIfDatabaseError(result.error);
}

export async function selectSceneVersion(
  userId: string,
  sceneId: string,
  expectedVersionId: string,
  nextVersionId: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("select_scene_version", {
    p_user_id: userId, p_scene_id: sceneId,
    p_expected_version_id: expectedVersionId, p_next_version_id: nextVersionId,
  });
  throwIfDatabaseError(result.error);
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
const VERSION_FIELDS = "id,scene_id,parent_version_id,storage_path,edit_instruction,seed,model,status,is_selected,operation_key,request_hash";
