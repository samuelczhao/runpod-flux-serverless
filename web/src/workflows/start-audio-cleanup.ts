import "server-only";
import { randomUUID } from "node:crypto";
import { getRun, start } from "workflow/api";
import {
  claimAudioCleanupWorkflow,
  releaseAudioCleanupExecution,
} from "@/lib/database/dreams";
import { shouldReleaseAudioCleanup } from "@/workflows/audio-cleanup-recovery";
import { cleanupAudioWorkflow } from "@/workflows/cleanup-audio";

const MAX_CLAIM_ATTEMPTS = 2;

export async function startAudioCleanup(dreamId: string, userId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    if (await claimOrRecoverCleanup(dreamId, userId)) return;
  }
  throw new Error("Audio cleanup workflow could not be reclaimed");
}

async function claimOrRecoverCleanup(dreamId: string, userId: string): Promise<boolean> {
  const token = randomUUID();
  const claim = await claimAudioCleanupWorkflow(dreamId, userId, token);
  if (!claim) throw new Error("Audio cleanup dream not found");
  if (claim.claimed) return startClaimedCleanup(dreamId, userId, token);
  if (!claim.workflowId) return true;
  const run = getRun(claim.workflowId);
  const state = await run.exists ? await run.status : "missing";
  if (!shouldReleaseAudioCleanup(state)) return true;
  await releaseAudioCleanupExecution(dreamId, token, claim.workflowId);
  return false;
}

async function startClaimedCleanup(
  dreamId: string,
  userId: string,
  token: string,
): Promise<boolean> {
  try {
    await start(cleanupAudioWorkflow, [dreamId, userId, token]);
    return true;
  } catch (error: unknown) {
    await releaseAudioCleanupExecution(dreamId, token, token);
    throw error;
  }
}
