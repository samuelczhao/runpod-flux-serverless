import "server-only";
import { randomUUID } from "node:crypto";
import { getRun, start } from "workflow/api";
import {
  claimAudioPlanWorkflow,
  claimDreamWorkflow,
  releaseDreamWorkflowExecution,
  type WorkflowClaim,
} from "@/lib/database/dreams";
import { generateDreamWorkflow } from "@/workflows/generate-dream";
import { shouldReleaseWorkflow, type ExistingRunState } from "@/workflows/run-recovery";
import { transcribeDreamWorkflow } from "@/workflows/transcribe-dream";

const MAX_CLAIM_ATTEMPTS = 2;

export class DreamAccessError extends Error {
  public constructor() {
    super("Dream not found");
    this.name = "DreamAccessError";
  }
}

export interface DreamStartResult {
  readonly runId: string | null;
  readonly started: boolean;
}

export async function startDreamGeneration(dreamId: string, userId: string): Promise<DreamStartResult> {
  return startRecoverableDream(dreamId, "generation", (token) =>
    claimDreamWorkflow(dreamId, userId, token));
}

export async function startDreamTranscription(dreamId: string, userId: string): Promise<DreamStartResult> {
  return startRecoverableDream(dreamId, "transcription", (token) =>
    claimDreamWorkflow(dreamId, userId, token));
}

export async function startAudioGeneration(
  dreamId: string,
  userId: string,
  transcript: string,
): Promise<DreamStartResult> {
  return startRecoverableDream(dreamId, "generation", (token) =>
    claimAudioPlanWorkflow(dreamId, userId, transcript, token));
}

async function startRecoverableDream(
  dreamId: string,
  kind: "generation" | "transcription",
  claimWorkflow: (token: string) => Promise<WorkflowClaim | null>,
): Promise<DreamStartResult> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const result = await claimOrRecoverDream(dreamId, kind, claimWorkflow);
    if (result) return result;
  }
  throw new Error("Dream workflow could not be reclaimed");
}

async function claimOrRecoverDream(
  dreamId: string,
  kind: "generation" | "transcription",
  claimWorkflow: (token: string) => Promise<WorkflowClaim | null>,
): Promise<DreamStartResult | null> {
  const token = randomUUID();
  const claim = await claimWorkflow(token);
  if (!claim) throw new DreamAccessError();
  if (claim.claimed) return startClaimedDream(dreamId, token, kind);
  if (!claim.workflowId) return { runId: null, started: false };
  const state = await getExistingRunState(claim.workflowId);
  if (!shouldReleaseWorkflow(state)) return { runId: claim.workflowId, started: false };
  await releaseDreamWorkflowExecution(dreamId, token, claim.workflowId);
  return null;
}

async function startClaimedDream(
  dreamId: string,
  token: string,
  kind: "generation" | "transcription",
): Promise<DreamStartResult> {
  try {
    const run = kind === "generation"
      ? await start(generateDreamWorkflow, [dreamId, token])
      : await start(transcribeDreamWorkflow, [dreamId, token]);
    return { runId: run.runId, started: true };
  } catch (error: unknown) {
    await releaseDreamWorkflowExecution(dreamId, token, token);
    throw error;
  }
}

async function getExistingRunState(runId: string): Promise<ExistingRunState> {
  const run = getRun(runId);
  if (!(await run.exists)) return "missing";
  return await run.status;
}
