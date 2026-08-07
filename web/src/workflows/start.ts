import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { claimDreamWorkflow, recordDreamWorkflow, releaseDreamWorkflow } from "@/lib/database/dreams";
import { generateDreamWorkflow } from "@/workflows/generate-dream";

export class DreamAccessError extends Error {
  public constructor() {
    super("Dream not found");
    this.name = "DreamAccessError";
  }
}

export interface DreamStartResult {
  readonly runId: string;
  readonly started: boolean;
}

export async function startDreamGeneration(dreamId: string, userId: string): Promise<DreamStartResult> {
  const token = randomUUID();
  const claim = await claimDreamWorkflow(dreamId, userId, token);
  if (!claim) throw new DreamAccessError();
  if (!claim.claimed) return { runId: claim.workflowId, started: false };
  return startClaimedDream(dreamId, token);
}

async function startClaimedDream(dreamId: string, token: string): Promise<DreamStartResult> {
  try {
    const run = await start(generateDreamWorkflow, [dreamId]);
    await recordDreamWorkflow(dreamId, token, run.runId);
    return { runId: run.runId, started: true };
  } catch (error: unknown) {
    await releaseDreamWorkflow(dreamId, token);
    throw error;
  }
}
