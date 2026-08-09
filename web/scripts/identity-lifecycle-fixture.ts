import { z } from "zod";
import type { Json } from "../src/lib/database/types.ts";
import {
  FIXTURE_ENDPOINT,
  ONE_PIXEL_PNG,
  assertNoError,
  type AdminClient,
} from "./branch-recovery-fixture.ts";

const preparationSchema = z.object({
  reference_id: z.uuid(),
  source_path: z.string().min(1),
});
const claimSchema = z.object({ job_id: z.uuid(), claimed: z.literal(true) });
const idSchema = z.object({ id: z.uuid() });
const PLAN_HASH = "b".repeat(64);
const CONTENT_HASH = "c".repeat(64);

export async function assertIdentityLifecycle(
  admin: AdminClient,
  userId: string,
  dreamImagePaths: string[],
  identityPaths: string[],
): Promise<void> {
  await assertRenewedIdentitySurvivesStaleCleanup(admin, userId);
  const identityId = await prepareIdentity(admin, userId, identityPaths);
  await completeIdentity(admin, userId, identityId, identityPaths);
  const dreamId = await prepareIdentityDream(admin, userId, identityId);
  const versionId = await applyOneScenePlan(admin, dreamId);
  const imagePath = `${userId}/${dreamId}/${versionId}.png`;
  dreamImagePaths.push(imagePath);
  await completeIdentityScene(admin, userId, dreamId, versionId, imagePath);
  await assertReadyDream(admin, dreamId);
  await deleteIdentity(admin, userId, identityId, identityPaths);
  console.log("identity_lifecycle status=COMPLETED");
}

async function assertRenewedIdentitySurvivesStaleCleanup(
  admin: AdminClient,
  userId: string,
): Promise<void> {
  const operationId = crypto.randomUUID();
  const prepared = await admin.rpc("prepare_identity_reference", {
    p_user_id: userId, p_operation_key: operationId, p_mime_type: "image/jpeg",
    p_consent_confirmed: true, p_consent_version: "dream-self-v1",
  });
  assertNoError(prepared.error);
  const identityId = preparationSchema.array().min(1).parse(prepared.data)[0].reference_id;
  const expired = await admin.from("identity_references").update({
    upload_expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq("id", identityId);
  assertNoError(expired.error);
  const candidates = await admin.rpc("get_identity_cleanup_candidates", { p_limit: 250 });
  assertNoError(candidates.error);
  const candidateSchema = z.object({ reference_id: z.uuid(), cleanup_kind: z.string() });
  const candidate = candidateSchema.array().parse(candidates.data)
    .find((row) => row.reference_id === identityId);
  if (candidate?.cleanup_kind !== "reference") throw new Error("Expired identity was not due");
  const replay = await admin.rpc("prepare_identity_reference", {
    p_user_id: userId, p_operation_key: operationId, p_mime_type: "image/jpeg",
    p_consent_confirmed: true, p_consent_version: "dream-self-v1",
  });
  assertNoError(replay.error);
  const claimToken = crypto.randomUUID();
  const claimed = await admin.rpc("claim_identity_normalization", {
    p_reference_id: identityId, p_user_id: userId, p_claim_token: claimToken,
  });
  assertNoError(claimed.error);
  if (claimed.data !== true) throw new Error("Renewed identity could not be claimed");
  const cleanup = await admin.rpc("begin_identity_cleanup", {
    p_reference_id: identityId, p_user_id: userId, p_cleanup_kind: "reference",
  });
  assertNoError(cleanup.error);
  if (z.array(z.unknown()).parse(cleanup.data).length !== 0) {
    throw new Error("Stale cleanup claim deleted a renewed identity");
  }
}

async function prepareIdentity(
  admin: AdminClient,
  userId: string,
  identityPaths: string[],
): Promise<string> {
  const result = await admin.rpc("prepare_identity_reference", {
    p_user_id: userId,
    p_operation_key: crypto.randomUUID(),
    p_mime_type: "image/jpeg",
    p_consent_confirmed: true,
    p_consent_version: "dream-self-v1",
  });
  assertNoError(result.error);
  const preparation = preparationSchema.array().min(1).parse(result.data)[0];
  identityPaths.push(preparation.source_path);
  const upload = await admin.storage.from("identity-references").upload(
    preparation.source_path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    { contentType: "image/jpeg", upsert: false },
  );
  assertNoError(upload.error);
  return preparation.reference_id;
}

async function completeIdentity(
  admin: AdminClient,
  userId: string,
  identityId: string,
  identityPaths: string[],
): Promise<void> {
  const claimToken = crypto.randomUUID();
  const competingToken = crypto.randomUUID();
  const claimed = await admin.rpc("claim_identity_normalization", {
    p_reference_id: identityId, p_user_id: userId, p_claim_token: claimToken,
  });
  assertNoError(claimed.error);
  if (claimed.data !== true) throw new Error("identity normalization claim was not acquired");
  const competing = await admin.rpc("claim_identity_normalization", {
    p_reference_id: identityId, p_user_id: userId, p_claim_token: competingToken,
  });
  assertNoError(competing.error);
  if (competing.data !== false) throw new Error("competing identity normalization claim was accepted");
  const path = `${userId}/identity/${identityId}/reference.png`;
  identityPaths.push(path);
  const upload = await admin.storage.from("identity-references").upload(path, ONE_PIXEL_PNG, {
    contentType: "image/png", upsert: false,
  });
  assertNoError(upload.error);
  const result = await admin.rpc("complete_identity_reference", {
    p_reference_id: identityId,
    p_user_id: userId,
    p_claim_token: claimToken,
    p_storage_path: path,
    p_size_bytes: ONE_PIXEL_PNG.length,
    p_width: 256,
    p_height: 256,
    p_content_sha256: CONTENT_HASH,
  });
  assertNoError(result.error);
}

async function prepareIdentityDream(
  admin: AdminClient,
  userId: string,
  identityId: string,
): Promise<string> {
  const prepared = await admin.rpc("prepare_text_dream", {
    p_user_id: userId,
    p_operation_key: crypto.randomUUID(),
    p_transcript: "I crossed a moonlit bridge carrying a scarlet compass.",
    p_identity_reference_id: identityId,
    p_visual_style: "watercolor-memory",
  });
  assertNoError(prepared.error);
  const dreamId = z.uuid().parse(prepared.data);
  const transitioned = await admin.rpc("transition_dream_state", {
    p_dream_id: dreamId,
    p_expected: "DRAFT",
    p_next: "PLANNING",
  });
  assertNoError(transitioned.error);
  return dreamId;
}

async function applyOneScenePlan(admin: AdminClient, dreamId: string): Promise<string> {
  const plan: Json = {
    title: "The Scarlet Compass",
    summary: "A quiet crossing under moonlight.",
    visual_bible: "Watercolor paper, indigo night, one scarlet compass.",
    mood: ["wonder"],
    motifs: [{ label: "scarlet compass", kind: "object" }],
    scenes: [{ caption: "The crossing", prompt: "The dreamer crosses a moonlit bridge." }],
  };
  const applied = await admin.rpc("apply_dream_plan", {
    p_dream_id: dreamId, p_plan: plan, p_plan_hash: PLAN_HASH,
  });
  assertNoError(applied.error);
  const scene = await admin.from("scenes").select("id").eq("dream_id", dreamId).single();
  assertNoError(scene.error);
  const inserted = await admin.from("scene_versions").insert({
    scene_id: idSchema.parse(scene.data).id,
    model: "black-forest-labs/FLUX.1-Kontext-dev",
    seed: 7,
  }).select("id").single();
  assertNoError(inserted.error);
  return idSchema.parse(inserted.data).id;
}

async function completeIdentityScene(
  admin: AdminClient,
  userId: string,
  dreamId: string,
  versionId: string,
  imagePath: string,
): Promise<void> {
  const claimed = await admin.rpc("claim_generation_job", {
    p_user_id: userId,
    p_dream_id: dreamId,
    p_scene_version_id: versionId,
    p_stage: "identity_scene",
    p_operation_key: `identity-scene:${crypto.randomUUID()}`,
    p_model: "black-forest-labs/FLUX.1-Kontext-dev",
    p_endpoint_id: FIXTURE_ENDPOINT,
    p_request_hash: "d".repeat(64),
  });
  assertNoError(claimed.error);
  const jobId = claimSchema.array().min(1).parse(claimed.data)[0].job_id;
  const recorded = await admin.rpc("record_generation_submission", {
    p_job_id: jobId, p_external_id: `fixture-${crypto.randomUUID()}`,
  });
  assertNoError(recorded.error);
  const upload = await admin.storage.from("dream-images").upload(imagePath, ONE_PIXEL_PNG, {
    contentType: "image/png", upsert: false,
  });
  assertNoError(upload.error);
  const completed = await admin.rpc("complete_generation_job", {
    p_job_id: jobId,
    p_storage_path: imagePath,
    p_cost_usd: null,
    p_cost_source: "unavailable",
  });
  assertNoError(completed.error);
  const finalized = await admin.rpc("finalize_dream", { p_dream_id: dreamId });
  assertNoError(finalized.error);
}

async function assertReadyDream(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").select("status").eq("id", dreamId).single();
  assertNoError(result.error);
  z.object({ status: z.literal("READY") }).parse(result.data);
}

async function deleteIdentity(
  admin: AdminClient,
  userId: string,
  identityId: string,
  identityPaths: string[],
): Promise<void> {
  const begun = await admin.rpc("begin_identity_deletion", {
    p_reference_id: identityId, p_user_id: userId,
  });
  assertNoError(begun.error);
  const removed = await admin.storage.from("identity-references").remove(identityPaths);
  assertNoError(removed.error);
  const completed = await admin.rpc("complete_identity_deletion", {
    p_reference_id: identityId, p_user_id: userId,
  });
  assertNoError(completed.error);
  const result = await admin.from("identity_references").select("status")
    .eq("id", identityId).single();
  assertNoError(result.error);
  z.object({ status: z.literal("DELETED") }).parse(result.data);
}
