import { getRunpodEnv } from "@/lib/config/env";
import { getProcessingDream } from "@/lib/database/dreams";
import { hashJson } from "@/lib/database/hash";
import {
  claimGenerationJob,
  recordGenerationSubmission,
  transitionGenerationJob,
  type JobClaim,
} from "@/lib/database/jobs";
import { ensureInitialVersion, getScene, getSelectedVersion } from "@/lib/database/scenes";
import { createDreamImageUrl } from "@/lib/database/storage";
import { buildAnchorInput } from "@/lib/runpod/anchor";
import { buildKontextInput, buildKontextRequestIdentity } from "@/lib/runpod/kontext";
import { submitQueueJob } from "@/lib/runpod/queue";
import { recordSubmissionFailure } from "@/lib/runpod/submission";

const ANCHOR_MODEL = "black-forest-labs/FLUX.1-dev";
const KONTEXT_MODEL = "black-forest-labs/FLUX.1-Kontext-dev";

export async function submitAnchorStep(dreamId: string): Promise<string> {
  "use step";
  const dream = await getProcessingDream(dreamId);
  if (dream.status !== "GENERATING_ANCHOR") throw new Error("Dream is not ready for its anchor");
  const scene = await getScene(dreamId, 1);
  const version = await ensureInitialVersion(scene, ANCHOR_MODEL);
  const prompt = visualPrompt(dream.visual_bible, scene.prompt);
  const input = buildAnchorInput({ prompt, seed: requireSeed(version.seed) });
  const endpointId = getRunpodEnv().fluxEndpointId;
  const claim = await claimImageJob(
    dream.user_id, dreamId, version.id, "anchor", ANCHOR_MODEL, endpointId, { endpointId, input },
  );
  return submitClaimedJob(claim, endpointId, input);
}

export async function submitSceneStep(dreamId: string, ordinal: 2 | 3): Promise<string> {
  "use step";
  const dream = await getProcessingDream(dreamId);
  if (dream.status !== "GENERATING_SCENES") throw new Error("Dream is not ready for scene generation");
  const [anchorScene, scene] = await Promise.all([getScene(dreamId, 1), getScene(dreamId, ordinal)]);
  const [anchor, version] = await Promise.all([
    getSelectedVersion(anchorScene.id), ensureInitialVersion(scene, KONTEXT_MODEL),
  ]);
  if (!anchor.storage_path) throw new Error("Anchor image is missing");
  const seed = requireSeed(version.seed);
  const prompt = visualPrompt(dream.visual_bible, scene.prompt);
  const endpointId = getRunpodEnv().kontextEndpointId;
  const identity = buildKontextRequestIdentity({ prompt, imageStoragePath: anchor.storage_path, seed });
  const claim = await claimImageJob(
    dream.user_id, dreamId, version.id, "scene", KONTEXT_MODEL, endpointId, { endpointId, identity },
  );
  if (!claim.claimed) return resumeImageClaim(claim);
  const input = buildKontextInput({ prompt, imageUrl: await createDreamImageUrl(anchor.storage_path), seed });
  return submitClaimedJob(claim, endpointId, input);
}

async function claimImageJob(
  userId: string,
  dreamId: string,
  versionId: string,
  stage: "anchor" | "scene",
  model: string,
  endpointId: string,
  identity: Readonly<Record<string, unknown>>,
): Promise<JobClaim> {
  return claimGenerationJob({
    userId, dreamId, sceneVersionId: versionId, stage,
    operationKey: `${stage}:${versionId}:v1`, model, endpointId, requestHash: hashJson(identity),
  });
}

async function submitClaimedJob(
  claim: JobClaim,
  endpointId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (!claim.claimed) return resumeImageClaim(claim);
  try {
    const externalId = await submitQueueJob(endpointId, input, getRunpodEnv().apiKey);
    await recordGenerationSubmission(claim.jobId, externalId);
    return claim.jobId;
  } catch (error: unknown) {
    await recordSubmissionFailure(claim.jobId, error);
    throw error;
  }
}

async function resumeImageClaim(claim: JobClaim): Promise<string> {
  if (claim.externalId || claim.status === "COMPLETED") return claim.jobId;
  if (claim.status === "SUBMITTING") {
    await transitionGenerationJob(claim.jobId, "SUBMITTING", "SUBMIT_UNKNOWN", {
      p_error_code: "SUBMISSION_RESPONSE_LOST",
    });
  }
  throw new Error("Image submission cannot be safely repeated");
}

function visualPrompt(visualBible: string | null, prompt: string): string {
  return `${visualBible ?? "Dreamlike cinematic realism"}. ${prompt}`;
}

function requireSeed(seed: number | null): number {
  if (seed === null) throw new Error("Scene version has no deterministic seed");
  return seed;
}
