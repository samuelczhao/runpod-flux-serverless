import { getRun } from "workflow/api";
import {
  completeAudioCleanupWorkflow,
  expireStaleAudioProcessing,
  getProcessingDreamOrNull,
  recordAudioCleanupWorkflow,
  releaseAudioCleanupExecution,
} from "@/lib/database/dreams";
import { getActiveTranscriptionJob, transitionGenerationJob } from "@/lib/database/jobs";
import { deleteDreamAudio, deleteExpiredDraftAudio } from "@/lib/database/storage";
import { cancelGenerationJobStep } from "@/workflows/steps/cancel";

export type AudioCleanupState = "done" | "defer";

export async function recordAudioCleanupWorkflowStep(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  "use step";
  await recordAudioCleanupWorkflow(dreamId, token, runId);
}

export async function releaseAudioCleanupExecutionStep(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  "use step";
  await releaseAudioCleanupExecution(dreamId, token, runId);
}

export async function getAudioCleanupDeadlineStep(
  dreamId: string,
  userId: string,
): Promise<string | null> {
  "use step";
  const dream = await getProcessingDreamOrNull(dreamId);
  if (!dream) return null;
  if (dream.user_id !== userId) throw new Error("Audio cleanup owner changed");
  return dream.audio_upload_expires_at;
}

export async function cleanupExpiredAudioStep(
  dreamId: string,
  userId: string,
): Promise<AudioCleanupState> {
  "use step";
  const dream = await getProcessingDreamOrNull(dreamId);
  if (!dream) return "done";
  if (dream.user_id !== userId) throw new Error("Audio cleanup owner changed");
  if (dream.status === "DRAFT" || dream.status === "DELETING") {
    return await deleteExpiredDraftAudio(dreamId, userId) ? "done" : "defer";
  }
  if (dream.status === "UPLOADED" || dream.status === "TRANSCRIBING") return "defer";
  if (!dream.retain_audio && dream.audio_storage_path) {
    await deleteDreamAudio(dream.id, dream.audio_storage_path);
  }
  return "done";
}

export async function completeAudioCleanupWorkflowStep(
  dreamId: string,
  runId: string,
): Promise<void> {
  "use step";
  await completeAudioCleanupWorkflow(dreamId, runId);
}

export async function expireStaleAudioProcessingStep(
  dreamId: string,
  userId: string,
): Promise<void> {
  "use step";
  const runId = await expireStaleAudioProcessing(dreamId, userId);
  if (runId) await cancelDurableRun(runId);
  const dream = await getProcessingDreamOrNull(dreamId);
  if (dream?.error_code !== "audio_processing_expired") return;
  const job = await getActiveTranscriptionJob(dreamId);
  if (!job) return;
  const outcome = await cancelGenerationJobStep(job.id);
  if (outcome === "completed") {
    await transitionGenerationJob(job.id, job.status, "FAILED", {
      p_error_code: "STALE_TRANSCRIPTION_COMPLETED_UNPERSISTED",
    });
  }
}

async function cancelDurableRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!(await run.exists)) return;
  const status = await run.status;
  if (status !== "pending" && status !== "running") return;
  try { await run.cancel(); } catch { /* Database state already prevents completion. */ }
}
