import { sleep } from "workflow";
import { submitBranchStep } from "@/workflows/steps/branch";
import { inspectImageJobStep, persistImageStep } from "@/workflows/steps/status";
import { cancelGenerationJobStep } from "@/workflows/steps/cancel";
import { PROVIDER_POLL_ATTEMPTS, providerPollDelay } from "@/workflows/polling";

export async function generateBranchWorkflow(
  versionId: string,
): Promise<{ versionId: string; status: "COMPLETED" }> {
  "use workflow";
  const jobId = await submitBranchStep(versionId);
  await waitForBranch(jobId);
  await persistImageStep(jobId);
  return { versionId, status: "COMPLETED" };
}

async function waitForBranch(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < PROVIDER_POLL_ATTEMPTS; attempt += 1) {
    const state = await inspectImageJobStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod branch generation failed");
    if (attempt < PROVIDER_POLL_ATTEMPTS - 1) await sleep(providerPollDelay(attempt));
  }
  if (await cancelGenerationJobStep(jobId) === "completed") return;
  throw new Error("Runpod branch generation timed out");
}
