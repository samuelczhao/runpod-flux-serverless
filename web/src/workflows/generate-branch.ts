import { sleep } from "workflow";
import { submitBranchStep } from "@/workflows/steps/branch";
import { inspectImageJobStep, persistImageStep } from "@/workflows/steps/status";
import { cancelGenerationJobStep } from "@/workflows/steps/cancel";

const POLL_INTERVAL = "5s";
const MAX_POLLS = 120;

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
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const state = await inspectImageJobStep(jobId);
    if (state === "completed") return;
    if (state === "failed") throw new Error("Runpod branch generation failed");
    if (attempt < MAX_POLLS - 1) await sleep(POLL_INTERVAL);
  }
  if (await cancelGenerationJobStep(jobId) === "completed") return;
  throw new Error("Runpod branch generation timed out");
}
