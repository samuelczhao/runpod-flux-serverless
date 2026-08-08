import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import {
  claimAudioPlanWorkflow,
  claimDreamWorkflow,
  recordDreamWorkflow,
  releaseDreamWorkflow,
  type WorkflowClaim,
} from "@/lib/database/dreams";
import { generateDreamWorkflow } from "@/workflows/generate-dream";
import { transcribeDreamWorkflow } from "@/workflows/transcribe-dream";

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
  return startClaimedDream(dreamId, token, "generation");
}

export async function startDreamTranscription(dreamId: string, userId: string): Promise<DreamStartResult> {
  const token = randomUUID();
  const claim = await claimDreamWorkflow(dreamId, userId, token);
  return startClaim(dreamId, token, claim, "transcription");
}

export async function startAudioGeneration(
  dreamId: string,
  userId: string,
  transcript: string,
): Promise<DreamStartResult> {
  const token = randomUUID();
  const claim = await claimAudioPlanWorkflow(dreamId, userId, transcript, token);
  return startClaim(dreamId, token, claim, "generation");
}

async function startClaim(
  dreamId: string,
  token: string,
  claim: WorkflowClaim | null,
  kind: "generation" | "transcription",
): Promise<DreamStartResult> {
  if (!claim) throw new DreamAccessError();
  if (!claim.claimed) return { runId: claim.workflowId, started: false };
  return startClaimedDream(dreamId, token, kind);
}

async function startClaimedDream(
  dreamId: string,
  token: string,
  kind: "generation" | "transcription",
): Promise<DreamStartResult> {
  const run = await startWorkflow(dreamId, token, kind);
  await recordDreamWorkflow(dreamId, token, run.runId);
  return { runId: run.runId, started: true };
}

async function startWorkflow(dreamId: string, token: string, kind: "generation" | "transcription") {
  try {
    return kind === "generation"
      ? await start(generateDreamWorkflow, [dreamId])
      : await start(transcribeDreamWorkflow, [dreamId]);
  } catch (error: unknown) {
    await releaseDreamWorkflow(dreamId, token);
    throw error;
  }
}
