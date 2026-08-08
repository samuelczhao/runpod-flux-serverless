import { getRunpodEnv } from "@/lib/config/env";
import { getProcessingDream } from "@/lib/database/dreams";
import { hashJson } from "@/lib/database/hash";
import {
  claimGenerationJob,
  completeTranscriptionJob,
  getGenerationJob,
  recordGenerationSubmission,
  transitionGenerationJob,
  type JobClaim,
} from "@/lib/database/jobs";
import { createDreamAudioUrl } from "@/lib/database/storage";
import { getQueueStatus, submitQueueJob, type QueueStatus } from "@/lib/runpod/queue";
import { recordSubmissionFailure } from "@/lib/runpod/submission";
import { buildWhisperInput, normalizeWhisperOutput } from "@/lib/runpod/whisper";

const WHISPER_MODEL = "faster-whisper/turbo";

export type TranscriptionPollState = "pending" | "completed" | "failed";

export async function submitTranscriptionStep(dreamId: string): Promise<string> {
  "use step";
  const dream = await getProcessingDream(dreamId);
  if (dream.status !== "TRANSCRIBING" || !dream.audio_storage_path) {
    throw new Error("Dream is not ready for transcription");
  }
  const endpointId = requireWhisperEndpoint();
  const identity = { endpointId, path: dream.audio_storage_path, model: WHISPER_MODEL, version: "whisper-v1" };
  const claim = await claimTranscriptionJob(dream.user_id, dream.id, endpointId, identity);
  if (!claim.claimed) return resumeTranscriptionClaim(claim);
  const input = buildWhisperInput(await createDreamAudioUrl(dream.audio_storage_path));
  return submitTranscription(claim, endpointId, input);
}

export async function inspectTranscriptionStep(jobId: string): Promise<TranscriptionPollState> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status === "COMPLETED") return "completed";
  const status = await fetchTranscriptionStatus(job);
  if (status.status === "COMPLETED") return "completed";
  if (status.status === "IN_QUEUE") return "pending";
  if (status.status === "IN_PROGRESS") return recordTranscriptionRunning(job.id, job.status, status);
  await recordTranscriptionFailure(job.id, job.status, status);
  return "failed";
}

export async function persistTranscriptionStep(jobId: string): Promise<void> {
  "use step";
  const job = await getGenerationJob(jobId);
  if (job.status !== "COMPLETED") await completeFromProvider(job);
}

async function claimTranscriptionJob(
  userId: string,
  dreamId: string,
  endpointId: string,
  identity: Readonly<Record<string, unknown>>,
): Promise<JobClaim> {
  return claimGenerationJob({
    userId, dreamId, sceneVersionId: null, stage: "transcription",
    operationKey: `transcription:${dreamId}:v1`, model: WHISPER_MODEL,
    endpointId, requestHash: hashJson(identity),
  });
}

async function submitTranscription(
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
    throw error;
  }
}

async function resumeTranscriptionClaim(claim: JobClaim): Promise<string> {
  if (claim.externalId || claim.status === "COMPLETED") return claim.jobId;
  if (claim.status === "SUBMITTING") {
    await transitionGenerationJob(claim.jobId, "SUBMITTING", "SUBMIT_UNKNOWN", {
      p_error_code: "SUBMISSION_RESPONSE_LOST",
    });
  }
  throw new Error("Transcription submission cannot be safely repeated");
}

async function fetchTranscriptionStatus(
  job: Awaited<ReturnType<typeof getGenerationJob>>,
): Promise<QueueStatus> {
  if (!job.external_job_id || !job.endpoint_id) throw new Error("Transcription job has incomplete provider identity");
  return getQueueStatus(job.endpoint_id, job.external_job_id, getRunpodEnv().apiKey);
}

async function completeFromProvider(job: Awaited<ReturnType<typeof getGenerationJob>>): Promise<void> {
  const status = await fetchTranscriptionStatus(job);
  if (status.status !== "COMPLETED") throw new Error("Provider transcription is not complete");
  const output = normalizeWhisperOutput(status.output);
  await completeTranscriptionJob(job.id, output.transcript, queueMetrics(status));
}

async function recordTranscriptionRunning(
  jobId: string,
  status: Awaited<ReturnType<typeof getGenerationJob>>["status"],
  provider: QueueStatus,
): Promise<TranscriptionPollState> {
  if (status === "QUEUED") await transitionGenerationJob(jobId, "QUEUED", "RUNNING", queueMetrics(provider));
  else if (status !== "RUNNING") throw new Error("Provider job state diverged from local state");
  return "pending";
}

async function recordTranscriptionFailure(
  jobId: string,
  status: Awaited<ReturnType<typeof getGenerationJob>>["status"],
  provider: QueueStatus,
): Promise<void> {
  if (status !== "QUEUED" && status !== "RUNNING") throw new Error("Invalid terminal job state");
  const next = provider.status === "CANCELLED" ? "CANCELLED" : "FAILED";
  await transitionGenerationJob(jobId, status, next, {
    ...queueMetrics(provider), p_error_code: `RUNPOD_${provider.status}`,
  });
}

function queueMetrics(status: QueueStatus) {
  return { p_delay_ms: status.delayTime ?? null, p_execution_ms: status.executionTime ?? null };
}

function requireWhisperEndpoint(): string {
  const endpointId = getRunpodEnv().whisperEndpointId;
  if (!endpointId) throw new Error("Runpod Whisper endpoint is not configured");
  return endpointId;
}
