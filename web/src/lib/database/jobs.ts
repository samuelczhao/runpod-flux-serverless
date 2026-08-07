import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseDatabaseRow, parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";
import { jobSchema, jobStatusSchema, type GenerationJob } from "@/lib/database/schemas";

const claimSchema = z.object({
  job_id: z.uuid(), job_status: jobStatusSchema, external_id: z.string().nullable(), claimed: z.boolean(),
}).strict();

export interface JobClaimInput {
  readonly userId: string;
  readonly dreamId: string;
  readonly sceneVersionId: string | null;
  readonly stage: string;
  readonly operationKey: string;
  readonly model: string;
  readonly requestHash: string;
}

export interface JobClaim {
  readonly jobId: string;
  readonly status: z.infer<typeof jobStatusSchema>;
  readonly externalId: string | null;
  readonly claimed: boolean;
}

export interface JobMetrics {
  readonly p_delay_ms?: number | null;
  readonly p_execution_ms?: number | null;
  readonly p_error_code?: string | null;
}

export async function claimGenerationJob(input: JobClaimInput): Promise<JobClaim> {
  const result = await createSupabaseAdminClient().rpc("claim_generation_job", {
    p_user_id: input.userId, p_dream_id: input.dreamId,
    p_scene_version_id: input.sceneVersionId, p_stage: input.stage,
    p_operation_key: input.operationKey, p_model: input.model, p_request_hash: input.requestHash,
  });
  throwIfDatabaseError(result.error);
  const row = parseDatabaseRows(claimSchema, result.data)[0];
  if (!row) throw new Error("Generation job claim returned no row");
  return { jobId: row.job_id, status: row.job_status, externalId: row.external_id, claimed: row.claimed };
}

export async function getGenerationJob(jobId: string): Promise<GenerationJob> {
  const result = await createSupabaseAdminClient().from("generation_jobs")
    .select(JOB_FIELDS).eq("id", jobId).single();
  throwIfDatabaseError(result.error);
  return parseDatabaseRow(jobSchema, result.data);
}

export async function recordGenerationSubmission(jobId: string, externalId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("record_generation_submission", {
    p_job_id: jobId, p_external_id: externalId,
  });
  throwIfDatabaseError(result.error);
}

export async function transitionGenerationJob(
  jobId: string,
  expected: z.infer<typeof jobStatusSchema>,
  next: z.infer<typeof jobStatusSchema>,
  metrics: JobMetrics = {},
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("update_generation_job", {
    p_job_id: jobId, p_expected: expected, p_next: next, ...metrics,
  });
  throwIfDatabaseError(result.error);
}

export async function completeImageJob(
  jobId: string,
  storagePath: string,
  costUsd: string | null,
  costSource: "provider" | "estimated" | "unavailable",
  metrics: Omit<JobMetrics, "p_error_code">,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_generation_job", {
    p_job_id: jobId, p_storage_path: storagePath, p_cost_usd: costUsd,
    p_cost_source: costSource, ...metrics,
  });
  throwIfDatabaseError(result.error);
}

export async function completeTranscriptionJob(
  jobId: string,
  transcript: string,
  metrics: Omit<JobMetrics, "p_error_code">,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_transcription_job", {
    p_job_id: jobId, p_transcript: transcript, ...metrics,
  });
  throwIfDatabaseError(result.error);
}

const JOB_FIELDS = "id,user_id,dream_id,scene_version_id,stage,model,external_job_id,status,request_hash";
