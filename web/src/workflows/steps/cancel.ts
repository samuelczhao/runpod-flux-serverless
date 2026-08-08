import { FatalError } from "workflow";
import { getRunpodEnv } from "@/lib/config/env";
import { getGenerationJob, transitionGenerationJob } from "@/lib/database/jobs";
import { cancelQueueJob, type QueueStatus } from "@/lib/runpod/queue";

export type CancelOutcome = "completed" | "cancelled" | "terminal";

export async function cancelGenerationJobStep(jobId: string): Promise<CancelOutcome> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return "completed";
  if (job.status !== "QUEUED" && job.status !== "RUNNING") return "terminal";
  const { endpoint_id: endpointId, external_job_id: externalId } = job;
  if (!externalId || !endpointId) throw new FatalError("Job cannot be cancelled safely");
  const status = await requestCancellation(endpointId, externalId);
  if (status.status === "COMPLETED") return "completed";
  if (status.status === "CANCELLED") return recordCancellation(job.id, job.status, status, "CANCELLED");
  if (status.status === "FAILED" || status.status === "TIMED_OUT") {
    return recordCancellation(job.id, job.status, status, "FAILED");
  }
  throw new FatalError("Runpod cancellation was not confirmed; manual reconciliation required");
}

async function requestCancellation(endpointId: string, externalId: string): Promise<QueueStatus> {
  try {
    return await cancelQueueJob(endpointId, externalId, getRunpodEnv().apiKey);
  } catch {
    throw new FatalError("Runpod cancellation response was uncertain; manual reconciliation required");
  }
}

async function recordCancellation(
  jobId: string,
  current: "QUEUED" | "RUNNING",
  provider: QueueStatus,
  next: "CANCELLED" | "FAILED",
): Promise<CancelOutcome> {
  await transitionGenerationJob(jobId, current, next, {
    p_delay_ms: provider.delayTime ?? null,
    p_execution_ms: provider.executionTime ?? null,
    p_error_code: next === "CANCELLED" ? "LOCAL_POLL_TIMEOUT" : `RUNPOD_${provider.status}`,
  });
  return next === "CANCELLED" ? "cancelled" : "terminal";
}
