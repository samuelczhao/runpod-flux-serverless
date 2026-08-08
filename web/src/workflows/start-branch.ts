import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import {
  claimBranchWorkflow,
  recordBranchWorkflow,
  releaseBranchWorkflow,
} from "@/lib/database/scenes";
import { generateBranchWorkflow } from "@/workflows/generate-branch";

export interface BranchStartResult {
  readonly runId: string | null;
  readonly started: boolean;
}

export async function startBranchGeneration(
  versionId: string,
  userId: string,
): Promise<BranchStartResult> {
  const token = randomUUID();
  const claim = await claimBranchWorkflow(userId, versionId, token);
  if (!claim) throw new BranchAccessError();
  if (!claim.claimed) return { runId: claim.workflowId, started: false };
  const run = await startClaimedBranch(versionId, token);
  await recordBranchWorkflow(versionId, token, run.runId);
  return { runId: run.runId, started: true };
}

async function startClaimedBranch(versionId: string, token: string) {
  try {
    return await start(generateBranchWorkflow, [versionId]);
  } catch (error: unknown) {
    await releaseBranchWorkflow(versionId, token);
    throw error;
  }
}

export class BranchAccessError extends Error {
  public constructor() {
    super("Scene branch not found");
    this.name = "BranchAccessError";
  }
}
