import "server-only";
import { z } from "zod";
import type { DreamPlan, DreamStatus } from "@/lib/domain/dream";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseDatabaseRow, parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import { processingDreamSchema, type ProcessingDream } from "@/lib/database/schemas";

const workflowClaimSchema = z.object({ workflow_id: z.string(), claimed: z.boolean() }).strict();
const ACTIVE_STATES: readonly DreamStatus[] = [
  "TRANSCRIBING", "PLANNING", "GENERATING_ANCHOR", "GENERATING_SCENES",
];

export interface WorkflowClaim {
  readonly workflowId: string;
  readonly claimed: boolean;
}

export async function getProcessingDream(dreamId: string): Promise<ProcessingDream> {
  const client = createSupabaseAdminClient();
  const result = await client.from("dreams").select(DREAM_FIELDS).eq("id", dreamId).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(processingDreamSchema, result.data);
}

export async function transitionDream(
  dreamId: string,
  expected: DreamStatus,
  next: DreamStatus,
): Promise<void> {
  const client = createSupabaseAdminClient();
  const result = await client.rpc("transition_dream_state", transitionArgs(dreamId, expected, next));
  throwIfDatabaseError(result.error);
}

export async function completeDreamPlan(
  jobId: string,
  plan: DreamPlan,
  planHash: string,
  costUsd: string,
): Promise<void> {
  const client = createSupabaseAdminClient();
  const result = await client.rpc("complete_dream_plan", {
    p_job_id: jobId, p_plan: plan, p_plan_hash: planHash, p_cost_usd: costUsd,
  });
  throwIfDatabaseError(result.error);
}

export async function claimDreamWorkflow(
  dreamId: string,
  userId: string,
  token: string,
): Promise<WorkflowClaim | null> {
  const client = createSupabaseAdminClient();
  const result = await client.rpc("claim_dream_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_claim_token: token,
  });
  throwIfDatabaseError(result.error);
  const rows = parseDatabaseRows(workflowClaimSchema, result.data);
  return rows[0] ? { workflowId: rows[0].workflow_id, claimed: rows[0].claimed } : null;
}

export async function recordDreamWorkflow(dreamId: string, token: string, runId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("record_dream_workflow", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  throwIfDatabaseError(result.error);
}

export async function releaseDreamWorkflow(dreamId: string, token: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("release_dream_workflow_claim", {
    p_dream_id: dreamId, p_claim_token: token,
  });
  throwIfDatabaseError(result.error);
}

export async function failDream(dreamId: string, stage: string, code: string): Promise<void> {
  const dream = await getProcessingDream(dreamId);
  if (!ACTIVE_STATES.includes(dream.status)) return;
  const client = createSupabaseAdminClient();
  const result = await client.rpc("transition_dream_state", {
    ...transitionArgs(dreamId, dream.status, "FAILED"), p_failed_stage: stage, p_error_code: code,
  });
  throwIfDatabaseError(result.error);
}

export async function finalizeDream(dreamId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("finalize_dream", { p_dream_id: dreamId });
  throwIfDatabaseError(result.error);
}

function transitionArgs(dreamId: string, expected: DreamStatus, next: DreamStatus) {
  return { p_dream_id: dreamId, p_expected: expected, p_next: next };
}

const DREAM_FIELDS = "id,user_id,status,input_mode,transcript,audio_storage_path,visual_bible,plan_hash";
