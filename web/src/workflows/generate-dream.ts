import { sleep } from "workflow";
import { failDreamStep, finalizeDreamStep } from "@/workflows/steps/finalize";
import { submitAnchorStep, submitSceneStep } from "@/workflows/steps/images";
import { planDreamStep } from "@/workflows/steps/planning";
import { inspectImageJobStep, persistImageStep } from "@/workflows/steps/status";

const POLL_INTERVAL = "5s";
const MAX_POLLS = 120;

export async function generateDreamWorkflow(dreamId: string): Promise<{ dreamId: string; status: "READY" }> {
  "use workflow";
  try {
    await planDreamStep(dreamId);
    await generateAnchor(dreamId);
    await generateScene(dreamId, 2);
    await generateScene(dreamId, 3);
    await finalizeDreamStep(dreamId);
    return { dreamId, status: "READY" };
  } catch (error: unknown) {
    await failDreamStep(dreamId, "generation");
    throw error;
  }
}

async function generateAnchor(dreamId: string): Promise<void> {
  const jobId = await submitAnchorStep(dreamId);
  await waitForImage(jobId);
  await persistImageStep(jobId);
}

async function generateScene(dreamId: string, ordinal: 2 | 3): Promise<void> {
  const jobId = await submitSceneStep(dreamId, ordinal);
  await waitForImage(jobId);
  await persistImageStep(jobId);
}

async function waitForImage(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const state = await inspectImageJobStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod image generation failed");
    if (attempt < MAX_POLLS - 1) await sleep(POLL_INTERVAL);
  }
  throw new Error("Runpod image generation timed out");
}
