import { z } from "zod";
import { getRunpodEnv } from "@/lib/config/env";
import { getProcessingDream } from "@/lib/database/dreams";
import {
  createIdentityProviderUrl,
  getIdentityReference,
} from "@/lib/database/identity";
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
import { MAX_STORY_SCENES } from "@/lib/domain/dream";
import {
  VISUAL_STYLE_PROMPTS,
  type VisualStyle,
} from "@/lib/domain/identity";
import type { ProcessingDream, Scene } from "@/lib/database/schemas";

const ANCHOR_MODEL = "black-forest-labs/FLUX.1-dev";
const KONTEXT_MODEL = "black-forest-labs/FLUX.1-Kontext-dev";

export async function submitAnchorStep(dreamId: string): Promise<string> {
  "use step";
  const dream = await getProcessingDream(dreamId);
  if (dream.status !== "GENERATING_ANCHOR") throw new Error("Dream is not ready for its anchor");
  const scene = await getScene(dreamId, 1);
  if (dream.identity_reference_id) return submitIdentityScene(dream, scene);
  const version = await ensureInitialVersion(scene, ANCHOR_MODEL);
  const prompt = visualPrompt(dream.visual_style, dream.visual_bible, scene.prompt);
  const input = buildAnchorInput({ prompt, seed: requireSeed(version.seed) });
  const endpointId = getRunpodEnv().fluxEndpointId;
  const claim = await claimImageJob(
    dream.user_id, dreamId, version.id, "anchor", ANCHOR_MODEL, endpointId, { endpointId, input },
  );
  return submitClaimedJob(claim, endpointId, input);
}

export async function submitSceneStep(dreamId: string, ordinal: number): Promise<string> {
  "use step";
  const sceneOrdinal = z.number().int().min(2).max(MAX_STORY_SCENES).parse(ordinal);
  const dream = await getProcessingDream(dreamId);
  if (dream.status !== "GENERATING_SCENES") throw new Error("Dream is not ready for scene generation");
  const scene = await getScene(dreamId, sceneOrdinal);
  if (dream.identity_reference_id) return submitIdentityScene(dream, scene);
  const anchorScene = await getScene(dreamId, 1);
  const [anchor, version] = await Promise.all([
    getSelectedVersion(anchorScene.id), ensureInitialVersion(scene, KONTEXT_MODEL),
  ]);
  if (!anchor.storage_path) throw new Error("Anchor image is missing");
  const seed = requireSeed(version.seed);
  const prompt = visualPrompt(dream.visual_style, dream.visual_bible, scene.prompt);
  const endpointId = getRunpodEnv().kontextEndpointId;
  const identity = buildKontextRequestIdentity({ prompt, imageStoragePath: anchor.storage_path, seed });
  const input = buildKontextInput({
    prompt,
    imageUrl: await createDreamImageUrl(anchor.storage_path),
    seed,
  });
  const claim = await claimImageJob(
    dream.user_id, dreamId, version.id, "scene", KONTEXT_MODEL, endpointId, { endpointId, identity },
  );
  return submitClaimedJob(claim, endpointId, input);
}

async function claimImageJob(
  userId: string,
  dreamId: string,
  versionId: string,
  stage: "anchor" | "scene" | "identity_scene",
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

async function submitIdentityScene(dream: ProcessingDream, scene: Scene): Promise<string> {
  const identityId = dream.identity_reference_id;
  if (!identityId) throw new Error("Dream Self reference is missing");
  const reference = await getIdentityReference(dream.user_id, identityId);
  if (!reference || reference.status !== "READY" || !reference.storage_path
    || !reference.content_sha256) throw new Error("Dream Self is not ready");
  const version = await ensureInitialVersion(scene, KONTEXT_MODEL);
  const seed = requireSeed(version.seed);
  const prompt = identityVisualPrompt(dream.visual_style, dream.visual_bible, scene.prompt);
  const endpointId = getRunpodEnv().kontextEndpointId;
  const identity = {
    ...buildKontextRequestIdentity({
      prompt,
      imageStoragePath: reference.storage_path,
      seed,
    }),
    identity_reference_id: reference.id,
    identity_content_sha256: reference.content_sha256,
  };
  const input = buildKontextInput({
    prompt,
    imageUrl: await createIdentityProviderUrl(reference.storage_path),
    seed,
  });
  const claim = await claimImageJob(
    dream.user_id,
    dream.id,
    version.id,
    "identity_scene",
    KONTEXT_MODEL,
    endpointId,
    { endpointId, identity },
  );
  return submitClaimedJob(claim, endpointId, input);
}

function identityVisualPrompt(
  style: VisualStyle,
  visualBible: string | null,
  prompt: string,
): string {
  return boundedPrompt([
    "The person in the reference image is the dreamer. Preserve their recognizable identity, facial structure, skin tone, eyes, nose, mouth, hairstyle, age, and distinctive features. Keep natural facial proportions and show only one dreamer unless the story explicitly requires more people.",
    VISUAL_STYLE_PROMPTS[style],
    visualBible,
    prompt,
  ]);
}

function visualPrompt(style: VisualStyle, visualBible: string | null, prompt: string): string {
  return boundedPrompt([VISUAL_STYLE_PROMPTS[style], visualBible, prompt]);
}

function boundedPrompt(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).reduce((result, part) => {
    const separator = result ? ". " : "";
    const remaining = 2_000 - result.length - separator.length;
    return remaining > 0 ? result + separator + part.slice(0, remaining) : result;
  }, "");
}

function requireSeed(seed: number | null): number {
  if (seed === null) throw new Error("Scene version has no deterministic seed");
  return seed;
}
