import { FatalError } from "workflow";
import { getRunpodEnv } from "@/lib/config/env";
import { completeDreamPlan, getProcessingDream } from "@/lib/database/dreams";
import { hashJson } from "@/lib/database/hash";
import {
  claimGenerationJob, getGenerationJob, recordGenerationSubmission,
  transitionGenerationJob, type JobClaim,
} from "@/lib/database/jobs";
import type { GenerationJob } from "@/lib/database/schemas";
import { getQueueStatus, submitQueueJob, type QueueStatus } from "@/lib/runpod/queue";
import { buildDreamPlanInput, normalizeDreamPlanOutput } from "@/lib/runpod/qwen";
import { recordSubmissionFailure } from "@/lib/runpod/submission";

const PLAN_MODEL = "Qwen/Qwen3-4B-AWQ";

export type PlanningPollState = "pending" | "completed" | "failed";

export async function submitPlanStep(dreamId: string): Promise<string> {
  "use step";
  const dream = await getProcessingDream(dreamId);
  if (dream.status !== "PLANNING" || !dream.transcript) throw new Error("Dream is not ready for planning");
  const endpointId = getRunpodEnv().plannerEndpointId;
  const input = buildDreamPlanInput(dream.transcript);
  const claim = await claimPlanJob(dream.user_id, dream.id, endpointId, input);
  if (!claim.claimed) return resumePlanClaim(claim);
  return submitPlan(claim, endpointId, input);
}

export async function inspectPlanStep(jobId: string): Promise<PlanningPollState> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return "completed";
  if (isTerminalFailure(job.status)) return "failed";
  const status = await fetchPlanStatus(job);
  if (status.status === "COMPLETED") return "completed";
  if (status.status === "IN_QUEUE") return "pending";
  if (status.status === "IN_PROGRESS") return recordPlanRunning(job, status);
  await recordPlanFailure(job, status);
  return "failed";
}

export async function persistPlanStep(jobId: string): Promise<void> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return;
  if (isTerminalFailure(job.status)) throw new FatalError("Planning job is terminal");
  const status = await fetchPlanStatus(job);
  if (status.status !== "COMPLETED") throw new Error("Provider plan is not complete");
  await persistProviderPlan(job, status);
}

async function claimPlanJob(
  userId: string,
  dreamId: string,
  endpointId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<JobClaim> {
  return claimGenerationJob({
    userId, dreamId, sceneVersionId: null, stage: "plan",
    operationKey: `${dreamId}:plan:v2`, model: PLAN_MODEL,
    endpointId,
    requestHash: hashJson({ endpointId, input }),
  });
}

async function submitPlan(
  claim: JobClaim,
  endpointId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  try {
    const env = getRunpodEnv();
    const externalId = await submitQueueJob(endpointId, input, env.apiKey);
    await recordGenerationSubmission(claim.jobId, externalId);
    return claim.jobId;
  } catch (error: unknown) {
    await recordSubmissionFailure(claim.jobId, error);
    throw new FatalError("Planning submission failed");
  }
}

async function resumePlanClaim(claim: JobClaim): Promise<string> {
  if (claim.status === "COMPLETED") return claim.jobId;
  if (claim.externalId && (claim.status === "QUEUED" || claim.status === "RUNNING")) return claim.jobId;
  if (claim.status === "SUBMITTING") {
    await transitionGenerationJob(claim.jobId, "SUBMITTING", "SUBMIT_UNKNOWN", {
      p_error_code: "SUBMISSION_RESPONSE_LOST",
    });
  }
  throw new FatalError("Planning submission cannot be safely repeated");
}

async function fetchPlanStatus(job: GenerationJob): Promise<QueueStatus> {
  if (!job.external_job_id || !job.endpoint_id) throw new Error("Planning job has incomplete provider identity");
  return getQueueStatus(job.endpoint_id, job.external_job_id, getRunpodEnv().apiKey);
}

async function recordPlanRunning(job: GenerationJob, status: QueueStatus): Promise<PlanningPollState> {
  if (job.status === "QUEUED") {
    await transitionGenerationJob(job.id, "QUEUED", "RUNNING", queueMetrics(status));
  } else if (job.status !== "RUNNING") throw new Error("Provider job state diverged from local state");
  return "pending";
}

async function recordPlanFailure(job: GenerationJob, status: QueueStatus): Promise<void> {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") throw new Error("Invalid terminal job state");
  const next = status.status === "CANCELLED" ? "CANCELLED" : "FAILED";
  await transitionGenerationJob(job.id, job.status, next, {
    ...queueMetrics(status), p_error_code: `RUNPOD_${status.status}`,
  });
}

async function persistProviderPlan(job: GenerationJob, status: QueueStatus): Promise<void> {
  const plan = await parseProviderPlan(job, status);
  await completeDreamPlan(job.id, plan, hashJson(plan), queueMetrics(status));
}

async function parseProviderPlan(
  job: GenerationJob,
  status: QueueStatus,
): Promise<ReturnType<typeof normalizeDreamPlanOutput>> {
  try {
    return normalizeDreamPlanOutput(status.output);
  } catch {
    await recordInvalidPlan(job, status);
    throw new FatalError("Provider returned an invalid dream plan");
  }
}

async function recordInvalidPlan(job: GenerationJob, status: QueueStatus): Promise<void> {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") return;
  await transitionGenerationJob(job.id, job.status, "FAILED", {
    ...queueMetrics(status), p_error_code: "INVALID_PROVIDER_OUTPUT",
  });
}

function isTerminalFailure(status: GenerationJob["status"]): boolean {
  return status !== "QUEUED" && status !== "RUNNING" && status !== "COMPLETED";
}

function queueMetrics(status: QueueStatus) {
  return { p_delay_ms: status.delayTime ?? null, p_execution_ms: status.executionTime ?? null };
}
