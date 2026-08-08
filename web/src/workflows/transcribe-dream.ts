import { getWorkflowMetadata, sleep } from "workflow";
import {
  inspectTranscriptionStep,
  persistTranscriptionStep,
  submitTranscriptionStep,
} from "@/workflows/steps/transcription";
import { failDreamStep } from "@/workflows/steps/finalize";
import { cancelGenerationJobStep } from "@/workflows/steps/cancel";
import { PROVIDER_POLL_ATTEMPTS, providerPollDelay } from "@/workflows/polling";
import {
  recordDreamWorkflowStep,
  releaseDreamWorkflowExecutionStep,
} from "@/workflows/steps/dream-workflow";

export async function transcribeDreamWorkflow(
  dreamId: string,
  claimToken: string,
): Promise<{ dreamId: string; status: "PLANNING" }> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  try {
    await recordDreamWorkflowStep(dreamId, claimToken, runId);
  } catch (error: unknown) {
    await releaseDreamWorkflowExecutionStep(dreamId, claimToken, runId);
    throw error;
  }
  try {
    const jobId = await submitTranscriptionStep(dreamId);
    await waitForTranscription(jobId);
    await persistTranscriptionStep(jobId);
    return { dreamId, status: "PLANNING" };
  } catch (error: unknown) {
    await failDreamStep(dreamId, "transcription");
    await releaseDreamWorkflowExecutionStep(dreamId, claimToken, runId);
    throw error;
  }
}

async function waitForTranscription(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < PROVIDER_POLL_ATTEMPTS; attempt += 1) {
    const state = await inspectTranscriptionStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod transcription failed");
    if (attempt < PROVIDER_POLL_ATTEMPTS - 1) await sleep(providerPollDelay(attempt));
  }
  if (await cancelGenerationJobStep(jobId) === "completed") return;
  throw new Error("Runpod transcription timed out");
}
