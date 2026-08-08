import { getWorkflowMetadata, sleep } from "workflow";
import { failDreamStep, finalizeDreamStep } from "@/workflows/steps/finalize";
import { submitAnchorStep, submitSceneStep } from "@/workflows/steps/images";
import { inspectPlanStep, persistPlanStep, submitPlanStep } from "@/workflows/steps/planning";
import { inspectImageJobStep, persistImageStep } from "@/workflows/steps/status";
import { cancelGenerationJobStep } from "@/workflows/steps/cancel";
import { PROVIDER_POLL_ATTEMPTS, providerPollDelay } from "@/workflows/polling";
import {
  getDreamWorkflowStatusStep,
  recordDreamWorkflowStep,
  releaseDreamWorkflowExecutionStep,
} from "@/workflows/steps/dream-workflow";

export async function generateDreamWorkflow(
  dreamId: string,
  claimToken: string,
): Promise<{ dreamId: string; status: "READY" }> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  try {
    await recordDreamWorkflowStep(dreamId, claimToken, runId);
  } catch (error: unknown) {
    await releaseDreamWorkflowExecutionStep(dreamId, claimToken, runId);
    throw error;
  }
  try {
    await resumeDreamGeneration(dreamId);
    return { dreamId, status: "READY" };
  } catch (error: unknown) {
    await failDreamStep(dreamId, "generation");
    await releaseDreamWorkflowExecutionStep(dreamId, claimToken, runId);
    throw error;
  }
}

async function resumeDreamGeneration(dreamId: string): Promise<void> {
  let status = await getDreamWorkflowStatusStep(dreamId);
  if (status === "PLANNING") {
    await generatePlan(dreamId);
    status = "GENERATING_ANCHOR";
  }
  if (status === "GENERATING_ANCHOR") {
    await generateAnchor(dreamId);
    status = "GENERATING_SCENES";
  }
  if (status === "GENERATING_SCENES") {
    await generateScene(dreamId, 2);
    await generateScene(dreamId, 3);
    await finalizeDreamStep(dreamId);
    return;
  }
  if (status !== "READY") throw new Error(`Dream cannot resume from ${status}`);
}

async function generatePlan(dreamId: string): Promise<void> {
  const jobId = await submitPlanStep(dreamId);
  await waitForPlan(jobId);
  await persistPlanStep(jobId);
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
  for (let attempt = 0; attempt < PROVIDER_POLL_ATTEMPTS; attempt += 1) {
    const state = await inspectImageJobStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod image generation failed");
    if (attempt < PROVIDER_POLL_ATTEMPTS - 1) await sleep(providerPollDelay(attempt));
  }
  if (await cancelGenerationJobStep(jobId) === "completed") return;
  throw new Error("Runpod image generation timed out");
}

async function waitForPlan(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < PROVIDER_POLL_ATTEMPTS; attempt += 1) {
    const state = await inspectPlanStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod planning failed");
    if (attempt < PROVIDER_POLL_ATTEMPTS - 1) await sleep(providerPollDelay(attempt));
  }
  if (await cancelGenerationJobStep(jobId) === "completed") return;
  throw new Error("Runpod planning timed out");
}
