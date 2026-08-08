import { FatalError } from "workflow";
import { getRunpodEnv } from "@/lib/config/env";
import { getProcessingDream } from "@/lib/database/dreams";
import {
  claimGenerationJob,
  getGenerationJobByVersion,
  recordGenerationSubmission,
  transitionGenerationJob,
  type JobClaim,
} from "@/lib/database/jobs";
import { getSceneById, getSceneVersion } from "@/lib/database/scenes";
import { createDreamImageUrl } from "@/lib/database/storage";
import { branchEditPrompt, branchRequestHash, KONTEXT_MODEL } from "@/lib/domain/branch";
import { buildKontextInput } from "@/lib/runpod/kontext";
import { submitQueueJob } from "@/lib/runpod/queue";
import { recordSubmissionFailure } from "@/lib/runpod/submission";

interface BranchContext {
  readonly userId: string;
  readonly dreamId: string;
  readonly parentPath: string;
  readonly instruction: string;
  readonly seed: number;
  readonly endpointId: string;
  readonly requestHash: string;
}

export async function submitBranchStep(versionId: string): Promise<string> {
  "use step";
  const version = await getSceneVersion(versionId);
  if (version.status === "COMPLETED") return (await getGenerationJobByVersion(version.id)).id;
  const context = await buildBranchContext(version);
  const claim = await claimBranchJob(
    context.userId, context.dreamId, version, context.endpointId, context.requestHash,
  );
  if (!claim.claimed) return resumeBranchClaim(claim);
  return submitBranch(claim, context.endpointId, await branchInput(context));
}

async function buildBranchContext(
  version: Awaited<ReturnType<typeof getSceneVersion>>,
): Promise<BranchContext> {
  const scene = await getSceneById(version.scene_id);
  const dream = await getProcessingDream(scene.dream_id);
  if (dream.status !== "READY") throw new Error("Dream is not ready for branching");
  const parent = await getSceneVersion(requireValue(version.parent_version_id, "parent"));
  if (!parent.storage_path || parent.status !== "COMPLETED") throw new Error("Branch parent is unavailable");
  const endpointId = getRunpodEnv().kontextEndpointId;
  const instruction = requireValue(version.edit_instruction, "instruction");
  const seed = requireSeed(version.seed);
  const requestHash = branchRequestHash({ parentVersionId: parent.id, instruction }, seed, {
    endpointId, parentStoragePath: parent.storage_path,
  });
  if (version.request_hash !== requestHash) throw new FatalError("Branch provider identity changed");
  return { userId: dream.user_id, dreamId: dream.id,
    parentPath: parent.storage_path, instruction, seed, endpointId, requestHash };
}

async function branchInput(context: BranchContext): Promise<Readonly<Record<string, unknown>>> {
  return buildKontextInput({
    prompt: branchEditPrompt(context.instruction),
    imageUrl: await createDreamImageUrl(context.parentPath),
    seed: context.seed,
  });
}

async function claimBranchJob(
  userId: string,
  dreamId: string,
  version: Awaited<ReturnType<typeof getSceneVersion>>,
  endpointId: string,
  requestHash: string,
): Promise<JobClaim> {
  const operationKey = requireValue(version.operation_key, "operation key");
  return claimGenerationJob({
    userId, dreamId, sceneVersionId: version.id, stage: "branch",
    operationKey: `${operationKey}:generation`, model: KONTEXT_MODEL,
    endpointId, requestHash,
  });
}

async function submitBranch(
  claim: JobClaim,
  endpointId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  try {
    const env = getRunpodEnv();
    const externalId = await submitQueueJob(endpointId, input, env.apiKey);
    await recordGenerationSubmission(claim.jobId, externalId);
    return claim.jobId;
  } catch (error: unknown) {
    await recordSubmissionFailure(claim.jobId, error);
    throw new FatalError("Branch submission failed");
  }
}

async function resumeBranchClaim(claim: JobClaim): Promise<string> {
  if (claim.status === "COMPLETED") return claim.jobId;
  if (claim.externalId && (claim.status === "QUEUED" || claim.status === "RUNNING")) return claim.jobId;
  if (claim.status === "SUBMITTING") {
    await transitionGenerationJob(claim.jobId, "SUBMITTING", "SUBMIT_UNKNOWN", {
      p_error_code: "SUBMISSION_RESPONSE_LOST",
    });
  }
  throw new FatalError("Branch submission cannot be safely repeated");
}

function requireValue(value: string | null, name: string): string {
  if (!value) throw new Error(`Scene branch has no ${name}`);
  return value;
}

function requireSeed(seed: number | null): number {
  if (seed === null) throw new Error("Scene branch has no deterministic seed");
  return seed;
}
