import { FatalError } from "workflow";
import { getRunpodEnv } from "@/lib/config/env";
import { providerCostUsd } from "@/lib/domain/cost";
import { completeImageJob, getGenerationJob, transitionGenerationJob } from "@/lib/database/jobs";
import type { GenerationJob } from "@/lib/database/schemas";
import { getSceneVersion } from "@/lib/database/scenes";
import {
  downloadProviderPng,
  ProviderArtifactError,
  storeDreamPng,
} from "@/lib/database/storage";
import { decodeAnchorPng } from "@/lib/runpod/anchor";
import { normalizeKontextOutput } from "@/lib/runpod/kontext";
import { getQueueStatus, type QueueStatus } from "@/lib/runpod/queue";

export type ImagePollState = "pending" | "completed" | "failed";
type ImageCost = { readonly value: string | null; readonly source: "provider" | "estimated" | "unavailable" };
interface ParsedImage { readonly bytes?: Buffer; readonly imageUrl?: string; readonly cost: ImageCost }

export async function inspectImageJobStep(jobId: string): Promise<ImagePollState> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return "completed";
  if (isTerminalFailure(job.status)) return "failed";
  const status = await fetchProviderStatus(job);
  if (status.status === "COMPLETED") return "completed";
  if (status.status === "IN_QUEUE") return "pending";
  if (status.status === "IN_PROGRESS") return recordRunning(job, status);
  await recordTerminalFailure(job, status);
  return "failed";
}

export async function persistImageStep(jobId: string): Promise<void> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return;
  if (isTerminalFailure(job.status)) throw new FatalError("Image job is terminal");
  const status = await fetchProviderStatus(job);
  if (status.status !== "COMPLETED") throw new Error("Provider image is not complete");
  const parsed = await parseProviderImage(job, status);
  const version = await getSceneVersion(requireVersionId(job));
  const bytes = await readProviderImage(job, status, parsed);
  const path = await storeDreamPng(job.user_id, job.dream_id, version.id, bytes);
  await completeImageJob(job.id, path, parsed.cost.value, parsed.cost.source, queueMetrics(status));
}

async function fetchProviderStatus(job: GenerationJob): Promise<QueueStatus> {
  if (!job.external_job_id || !job.endpoint_id) throw new Error("Generation job has incomplete provider identity");
  return getQueueStatus(job.endpoint_id, job.external_job_id, getRunpodEnv().apiKey);
}

async function recordRunning(job: GenerationJob, status: QueueStatus): Promise<ImagePollState> {
  if (job.status === "QUEUED") {
    await transitionGenerationJob(job.id, "QUEUED", "RUNNING", queueMetrics(status));
  } else if (job.status !== "RUNNING") throw new Error("Provider job state diverged from local state");
  return "pending";
}

async function recordTerminalFailure(job: GenerationJob, status: QueueStatus): Promise<void> {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") throw new Error("Invalid terminal job state");
  const next = status.status === "CANCELLED" ? "CANCELLED" : "FAILED";
  await transitionGenerationJob(job.id, job.status, next, {
    ...queueMetrics(status), p_error_code: `RUNPOD_${status.status}`,
  });
}

async function parseProviderImage(job: GenerationJob, status: QueueStatus): Promise<ParsedImage> {
  try {
    return job.stage === "anchor" ? anchorImage(status.output) : kontextImage(status.output);
  } catch {
    await recordInvalidImage(job, status);
    throw new FatalError("Provider returned an invalid image result");
  }
}

function anchorImage(output: unknown): ParsedImage {
  return { bytes: decodeAnchorPng(output), cost: { value: null, source: "unavailable" } };
}

function kontextImage(output: unknown): ParsedImage {
  const result = normalizeKontextOutput(output);
  const cost = result.cost === undefined
    ? { value: "0.02500000", source: "estimated" as const }
    : { value: providerCostUsd(result.cost), source: "provider" as const };
  return { imageUrl: result.imageUrl, cost };
}

async function recordInvalidImage(job: GenerationJob, status: QueueStatus): Promise<void> {
  if (job.status !== "QUEUED" && job.status !== "RUNNING") return;
  await transitionGenerationJob(job.id, job.status, "FAILED", {
    ...queueMetrics(status), p_error_code: "INVALID_PROVIDER_OUTPUT",
  });
}

async function imageBytes(parsed: ParsedImage): Promise<Buffer> {
  if (parsed.bytes) return parsed.bytes;
  if (!parsed.imageUrl) throw new Error("Parsed image has no content");
  return downloadProviderPng(parsed.imageUrl);
}

async function readProviderImage(
  job: GenerationJob,
  status: QueueStatus,
  parsed: ParsedImage,
): Promise<Buffer> {
  try {
    return await imageBytes(parsed);
  } catch (error: unknown) {
    if (!(error instanceof ProviderArtifactError)) throw error;
    await recordInvalidImage(job, status);
    throw new FatalError("Provider returned an invalid image artifact");
  }
}

function isTerminalFailure(status: GenerationJob["status"]): boolean {
  return status !== "QUEUED" && status !== "RUNNING" && status !== "COMPLETED";
}

function queueMetrics(status: QueueStatus) {
  return { p_delay_ms: status.delayTime ?? null, p_execution_ms: status.executionTime ?? null };
}

function requireVersionId(job: GenerationJob): string {
  if (!job.scene_version_id) throw new Error("Image job has no scene version");
  return job.scene_version_id;
}
