import { getWorkflowMetadata, sleep } from "workflow";
import {
  cleanupExpiredAudioStep,
  completeAudioCleanupWorkflowStep,
  expireStaleAudioProcessingStep,
  getAudioCleanupDeadlineStep,
  recordAudioCleanupWorkflowStep,
  releaseAudioCleanupExecutionStep,
} from "@/workflows/steps/audio-cleanup";

const CLEANUP_GRACE_MS = 5 * 60 * 1_000;
const ACTIVE_AUDIO_RETRY = "15m";

export async function cleanupAudioWorkflow(
  dreamId: string,
  userId: string,
  claimToken: string,
): Promise<void> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  try {
    await recordAudioCleanupWorkflowStep(dreamId, claimToken, runId);
    await waitForAudioCleanup(dreamId, userId);
    await completeAudioCleanupWorkflowStep(dreamId, runId);
  } catch (error: unknown) {
    await releaseAudioCleanupExecutionStep(dreamId, claimToken, runId);
    throw error;
  }
}

async function waitForAudioCleanup(dreamId: string, userId: string): Promise<void> {
  while (true) {
    const deadline = await getAudioCleanupDeadlineStep(dreamId, userId);
    if (!deadline) return;
    await sleep(new Date(Date.parse(deadline) + CLEANUP_GRACE_MS));
    await expireStaleAudioProcessingStep(dreamId, userId);
    if (await cleanupExpiredAudioStep(dreamId, userId) === "done") return;
    await sleep(ACTIVE_AUDIO_RETRY);
  }
}
