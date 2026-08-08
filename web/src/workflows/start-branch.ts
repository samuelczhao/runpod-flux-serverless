import "server-only";
import { randomUUID } from "node:crypto";
import { getRun, start } from "workflow/api";
import {
  claimBranchWorkflow,
  releaseBranchWorkflowExecution,
} from "@/lib/database/scenes";
import {
  shouldReleaseBranchWorkflow,
  type ExistingRunState,
} from "@/workflows/branch-recovery";
import { generateBranchWorkflow } from "@/workflows/generate-branch";

const MAX_CLAIM_ATTEMPTS = 2;

export interface BranchStartResult {
  readonly runId: string | null;
  readonly started: boolean;
}

export async function startBranchGeneration(
  versionId: string,
  userId: string,
): Promise<BranchStartResult> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const result = await claimOrRecoverBranch(versionId, userId);
    if (result) return result;
  }
  throw new Error("Branch workflow could not be reclaimed");
}

async function claimOrRecoverBranch(
  versionId: string,
  userId: string,
): Promise<BranchStartResult | null> {
  const token = randomUUID();
  const claim = await claimBranchWorkflow(userId, versionId, token);
  if (!claim) throw new BranchAccessError();
  if (claim.claimed) return startClaimedBranch(versionId, token);
  if (!claim.workflowId) return { runId: null, started: false };
  const state = await getExistingRunState(claim.workflowId);
  if (!shouldReleaseBranchWorkflow(state)) return { runId: claim.workflowId, started: false };
  await releaseBranchWorkflowExecution(versionId, token, claim.workflowId);
  return null;
}

async function startClaimedBranch(versionId: string, token: string): Promise<BranchStartResult> {
  try {
    const run = await start(generateBranchWorkflow, [versionId, token]);
    return { runId: run.runId, started: true };
  } catch (error: unknown) {
    await releaseBranchWorkflowExecution(versionId, token, token);
    throw error;
  }
}

async function getExistingRunState(runId: string): Promise<ExistingRunState> {
  const run = getRun(runId);
  if (!(await run.exists)) return "missing";
  return await run.status;
}

export class BranchAccessError extends Error {
  public constructor() {
    super("Scene branch not found");
    this.name = "BranchAccessError";
  }
}
