import { getRunpodEnv } from "@/lib/config/env";
import { providerCostUsd } from "@/lib/domain/cost";
import { completeImageJob, getGenerationJob, transitionGenerationJob } from "@/lib/database/jobs";
import type { GenerationJob } from "@/lib/database/schemas";
import { getSceneVersion } from "@/lib/database/scenes";
import { downloadProviderPng, storeDreamPng } from "@/lib/database/storage";
import { decodeAnchorPng } from "@/lib/runpod/anchor";
import { normalizeKontextOutput } from "@/lib/runpod/kontext";
import { getQueueStatus, type QueueStatus } from "@/lib/runpod/queue";

export type ImagePollState = "pending" | "completed" | "failed";

export async function inspectImageJobStep(jobId: string): Promise<ImagePollState> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return "completed";
  const status = await fetchProviderStatus(job);
  if (status.status === "COMPLETED") return "completed";
  if (status.status === "IN_QUEUE") return "pending";
  if (status.status === "IN_PROGRESS") {
    await recordRunning(job, status);
    return "pending";
  }
  await recordTerminalFailure(job, status);
  return "failed";
}

export async function persistImageStep(jobId: string): Promise<void> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return;
  const status = await fetchProviderStatus(job);
  if (status.status !== "COMPLETED") throw new Error("Provider image is not complete");
  const version = await getSceneVersion(requireVersionId(job));
  const bytes = await imageBytes(job, status.output);
  const path = await storeDreamPng(job.user_id, job.dream_id, version.id, bytes);
  const cost = imageCost(job, status.output);
  await completeImageJob(job.id, path, cost.value, cost.source, queueMetrics(status));
}

async function fetchProviderStatus(job: GenerationJob): Promise<QueueStatus> {
  if (!job.external_job_id) throw new Error("Generation job has no provider ID");
  const env = getRunpodEnv();
  const endpoint = job.stage === "anchor" ? env.fluxEndpointId : env.kontextEndpointId;
  return getQueueStatus(endpoint, job.external_job_id, env.apiKey);
}

async function recordRunning(job: GenerationJob, status: QueueStatus): Promise<void> {
  if (job.status === "RUNNING") return;
  if (job.status !== "QUEUED") throw new Error("Provider job state diverged from local state");
  await transitionGenerationJob(job.id, "QUEUED", "RUNNING", queueMetrics(status));
}

async function recordTerminalFailure(job: GenerationJob, status: QueueStatus): Promise<void> {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") throw new Error("Invalid terminal job state");
  const next = status.status === "CANCELLED" ? "CANCELLED" : "FAILED";
  await transitionGenerationJob(job.id, job.status, next, {
    ...queueMetrics(status), p_error_code: `RUNPOD_${status.status}`,
  });
}

async function imageBytes(job: GenerationJob, output: unknown): Promise<Buffer> {
  if (job.stage === "anchor") return decodeAnchorPng(output);
  const normalized = normalizeKontextOutput(output);
  return downloadProviderPng(normalized.imageUrl);
}

function imageCost(job: GenerationJob, output: unknown) {
  if (job.stage === "anchor") return { value: null, source: "unavailable" as const };
  const cost = normalizeKontextOutput(output).cost;
  return cost === undefined
    ? { value: "0.02500000", source: "estimated" as const }
    : { value: providerCostUsd(cost), source: "provider" as const };
}

function queueMetrics(status: QueueStatus) {
  return { p_delay_ms: status.delayTime ?? null, p_execution_ms: status.executionTime ?? null };
}

function requireVersionId(job: GenerationJob): string {
  if (!job.scene_version_id) throw new Error("Image job has no scene version");
  return job.scene_version_id;
}
