import "server-only";
import { z } from "zod";
import type { DreamPlan, DreamStatus } from "@/lib/domain/dream";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseDatabaseRow, parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import { processingDreamSchema, type ProcessingDream } from "@/lib/database/schemas";
import type { VisualStyle } from "@/lib/domain/identity";

const optionalWorkflowClaimSchema = z.object({
  workflow_id: z.string().nullable(), claimed: z.boolean(),
}).strict();
const audioCleanupCandidateSchema = z.object({ id: z.uuid(), user_id: z.uuid() }).strict();
const cleanupLimitSchema = z.number().int().min(1).max(100);
const ACTIVE_STATES: readonly DreamStatus[] = [
  "TRANSCRIBING", "PLANNING", "GENERATING_ANCHOR", "GENERATING_SCENES",
];

export interface WorkflowClaim {
  readonly workflowId: string | null;
  readonly claimed: boolean;
}

export interface AudioCleanupClaim {
  readonly workflowId: string | null;
  readonly claimed: boolean;
}

export interface AudioCleanupCandidate {
  readonly dreamId: string;
  readonly userId: string;
}

export async function getProcessingDream(dreamId: string): Promise<ProcessingDream> {
  const client = createSupabaseAdminClient();
  const result = await client.from("dreams").select(DREAM_FIELDS).eq("id", dreamId).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(processingDreamSchema, result.data);
}

export async function getProcessingDreamOrNull(dreamId: string): Promise<ProcessingDream | null> {
  const client = createSupabaseAdminClient();
  const result = await client.from("dreams").select(DREAM_FIELDS).eq("id", dreamId).maybeSingle();
  throwIfDatabaseError(result.error);
  return result.data === null ? null : parseDatabaseRow(processingDreamSchema, result.data);
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
  metrics: { readonly p_delay_ms: number | null; readonly p_execution_ms: number | null },
): Promise<void> {
  const client = createSupabaseAdminClient();
  const result = await client.rpc("complete_dream_plan", {
    p_job_id: jobId, p_plan: plan, p_plan_hash: planHash,
    p_cost_usd: null, p_cost_source: "unavailable", ...metrics,
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
  const rows = parseDatabaseRows(optionalWorkflowClaimSchema, result.data);
  return rows[0] ? { workflowId: rows[0].workflow_id, claimed: rows[0].claimed } : null;
}

export async function claimAudioPlanWorkflow(
  dreamId: string,
  userId: string,
  transcript: string,
  token: string,
): Promise<WorkflowClaim | null> {
  const result = await createSupabaseAdminClient().rpc("claim_audio_plan_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_transcript: transcript, p_claim_token: token,
  });
  throwIfDatabaseError(result.error);
  const rows = parseDatabaseRows(optionalWorkflowClaimSchema, result.data);
  return rows[0] ? { workflowId: rows[0].workflow_id, claimed: rows[0].claimed } : null;
}

export async function completeAudioUpload(
  dreamId: string,
  userId: string,
  path: string,
  mimeType: string,
  sizeBytes: number,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_audio_upload", {
    p_dream_id: dreamId, p_user_id: userId, p_storage_path: path,
    p_mime_type: mimeType, p_size_bytes: sizeBytes,
  });
  throwIfDatabaseError(result.error);
}

export async function prepareAudioDream(
  userId: string,
  operationId: string,
  mimeType: string,
  identityReferenceId: string | null,
  visualStyle: VisualStyle,
): Promise<string> {
  const result = await createSupabaseAdminClient().rpc("prepare_audio_dream", {
    p_user_id: userId, p_operation_key: operationId, p_mime_type: mimeType,
    p_identity_reference_id: identityReferenceId, p_visual_style: visualStyle,
  });
  throwIfDatabaseError(result.error);
  return z.uuid().parse(result.data);
}

export async function prepareTextDream(
  userId: string,
  operationId: string,
  transcript: string,
  identityReferenceId: string | null,
  visualStyle: VisualStyle,
): Promise<string> {
  const result = await createSupabaseAdminClient().rpc("prepare_text_dream", {
    p_user_id: userId, p_operation_key: operationId, p_transcript: transcript,
    p_identity_reference_id: identityReferenceId, p_visual_style: visualStyle,
  });
  throwIfDatabaseError(result.error);
  return z.uuid().parse(result.data);
}

export async function claimAudioCleanupWorkflow(
  dreamId: string,
  userId: string,
  token: string,
): Promise<AudioCleanupClaim | null> {
  const result = await createSupabaseAdminClient().rpc("claim_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_claim_token: token,
  });
  throwIfDatabaseError(result.error);
  const row = parseDatabaseRows(optionalWorkflowClaimSchema, result.data)[0];
  return row ? { workflowId: row.workflow_id, claimed: row.claimed } : null;
}

export async function recordAudioCleanupWorkflow(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("record_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  throwIfDatabaseError(result.error);
}

export async function releaseAudioCleanupExecution(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("release_audio_cleanup_execution", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  throwIfDatabaseError(result.error);
}

export async function completeAudioCleanupWorkflow(dreamId: string, runId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_run_id: runId,
  });
  throwIfDatabaseError(result.error);
}

export async function expireStaleAudioProcessing(
  dreamId: string,
  userId: string,
): Promise<string | null> {
  const result = await createSupabaseAdminClient().rpc("expire_stale_audio_processing", {
    p_dream_id: dreamId, p_user_id: userId,
  });
  throwIfDatabaseError(result.error);
  return z.string().nullable().parse(result.data);
}

export async function getExpiredAudioCleanupCandidates(
  limit: number,
): Promise<AudioCleanupCandidate[]> {
  const result = await queryExpiredAudioCandidates(cleanupLimitSchema.parse(limit));
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(audioCleanupCandidateSchema, result.data).map(toAudioCleanupCandidate);
}

export async function recordDreamWorkflow(dreamId: string, token: string, runId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("record_dream_workflow", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  throwIfDatabaseError(result.error);
}

export async function releaseDreamWorkflowExecution(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("release_dream_workflow_execution", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
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

function queryExpiredAudioCandidates(limit: number) {
  return createSupabaseAdminClient().from("dreams").select("id,user_id")
    .eq("input_mode", "audio").not("audio_upload_expires_at", "is", null)
    .lte("audio_upload_expires_at", new Date().toISOString())
    .order("audio_upload_expires_at", { ascending: true }).limit(limit);
}

function toAudioCleanupCandidate(
  row: z.infer<typeof audioCleanupCandidateSchema>,
): AudioCleanupCandidate {
  return { dreamId: row.id, userId: row.user_id };
}

const DREAM_FIELDS = "id,user_id,status,input_mode,transcript,audio_storage_path,audio_mime_type,"
  + "audio_upload_expires_at,retain_audio,visual_bible,identity_reference_id,visual_style,"
  + "plan_hash,error_code";
