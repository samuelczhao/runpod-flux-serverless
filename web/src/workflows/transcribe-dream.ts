import { sleep } from "workflow";
import {
  inspectTranscriptionStep,
  persistTranscriptionStep,
  submitTranscriptionStep,
} from "@/workflows/steps/transcription";
import { failDreamStep } from "@/workflows/steps/finalize";

const POLL_INTERVAL = "5s";
const MAX_POLLS = 120;

export async function transcribeDreamWorkflow(
  dreamId: string,
): Promise<{ dreamId: string; status: "PLANNING" }> {
  "use workflow";
  try {
    const jobId = await submitTranscriptionStep(dreamId);
    await waitForTranscription(jobId);
    await persistTranscriptionStep(jobId);
    return { dreamId, status: "PLANNING" };
  } catch (error: unknown) {
    await failDreamStep(dreamId, "transcription");
    throw error;
  }
}

async function waitForTranscription(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const state = await inspectTranscriptionStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod transcription failed");
    if (attempt < MAX_POLLS - 1) await sleep(POLL_INTERVAL);
  }
  throw new Error("Runpod transcription timed out");
}
