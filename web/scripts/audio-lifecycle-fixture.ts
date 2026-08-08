import { z } from "zod";
import { assertNoError, serviceHeaders, type AdminClient, type Env } from "./branch-recovery-fixture.ts";

const dreamIdSchema = z.uuid();
const AUDIO_MIME = "audio/webm";
const STALE_AUDIO_AGE_MS = 7 * 60 * 60 * 1_000;

export async function assertAudioPreparation(
  env: Env,
  admin: AdminClient,
  userId: string,
): Promise<void> {
  const operationId = crypto.randomUUID();
  const args = audioPreparationArgs(userId, operationId, AUDIO_MIME);
  const dreamId = await assertPreparationReplay(admin, args);
  await assertMimeConflict(admin, args);
  await assertNullOperationRejected(env, userId);
  await assertNullMimeRejected(env, userId);
  await assertTerminalReplayRejected(admin, dreamId, args);
  await assertExpiredDraftCleanup(env, admin, userId);
  await assertCleanupOwnership(env, admin, userId);
  await assertStaleProcessingExpires(admin, userId);
}

async function assertPreparationReplay(
  admin: AdminClient,
  args: ReturnType<typeof audioPreparationArgs>,
): Promise<string> {
  const first = await admin.rpc("prepare_audio_dream", args);
  const replay = await admin.rpc("prepare_audio_dream", args);
  assertNoError(first.error); assertNoError(replay.error);
  const dreamId = dreamIdSchema.parse(first.data);
  if (dreamId !== dreamIdSchema.parse(replay.data)) {
    throw new Error("Audio preparation replay created a second dream");
  }
  return dreamId;
}

async function assertNullMimeRejected(env: Env, userId: string): Promise<void> {
  const body = { p_user_id: userId, p_operation_key: crypto.randomUUID(), p_mime_type: null };
  await expectAudioRpcFailure(env, "prepare_audio_dream", body);
}

function audioPreparationArgs(userId: string, operationId: string, mimeType: string) {
  return {
    p_user_id: userId,
    p_operation_key: operationId,
    p_mime_type: mimeType,
    p_identity_reference_id: null,
    p_visual_style: "dream-cinema" as const,
  };
}

async function assertMimeConflict(
  admin: AdminClient,
  args: ReturnType<typeof audioPreparationArgs>,
): Promise<void> {
  const conflict = await admin.rpc("prepare_audio_dream", { ...args, p_mime_type: "audio/mp4" });
  if (!conflict.error) throw new Error("Audio operation accepted a changed MIME type");
}

async function assertNullOperationRejected(env: Env, userId: string): Promise<void> {
  const body = { p_user_id: userId, p_operation_key: null, p_mime_type: AUDIO_MIME };
  await expectAudioRpcFailure(env, "prepare_audio_dream", body);
}

async function assertTerminalReplayRejected(
  admin: AdminClient,
  dreamId: string,
  args: ReturnType<typeof audioPreparationArgs>,
): Promise<void> {
  const updated = await admin.from("dreams").update({ status: "DELETING" }).eq("id", dreamId);
  assertNoError(updated.error);
  const replay = await admin.rpc("prepare_audio_dream", args);
  if (!replay.error) throw new Error("Audio preparation replayed after leaving DRAFT");
}

async function assertExpiredDraftCleanup(env: Env, admin: AdminClient, userId: string): Promise<void> {
  const dreamId = await prepareAudio(admin, userId);
  await expireAudio(admin, dreamId);
  const prepared = await admin.rpc("prepare_expired_audio_draft_cleanup", {
    p_dream_id: dreamId, p_user_id: userId,
  });
  assertNoError(prepared.error);
  const path = z.string().min(1).parse(prepared.data);
  await assertNullCleanupPathRejected(env, dreamId, userId);
  const completed = await admin.rpc("complete_expired_audio_draft_cleanup", {
    p_dream_id: dreamId, p_user_id: userId, p_storage_path: path,
  });
  assertNoError(completed.error);
  await assertDreamDeleted(admin, dreamId);
}

async function assertCleanupOwnership(env: Env, admin: AdminClient, userId: string): Promise<void> {
  const dreamId = await prepareAudio(admin, userId);
  await makeRetainedDreamReady(admin, dreamId);
  const token = crypto.randomUUID();
  const first = await claimCleanup(admin, dreamId, userId, token);
  const duplicate = await claimCleanup(admin, dreamId, userId, crypto.randomUUID());
  if (!first.claimed || duplicate.claimed) throw new Error("Audio cleanup claim was not exclusive");
  await assertNullRecordClaimRejected(env, dreamId);
  const runId = `cleanup-${crypto.randomUUID()}`;
  await recordCleanup(admin, dreamId, token, runId);
  await assertStaleCleanupReleaseProtected(admin, dreamId, userId, token, runId);
  await completeCleanup(admin, dreamId, runId);
  await completeCleanup(admin, dreamId, runId);
  await assertCleanupCleared(admin, dreamId);
}

async function assertStaleProcessingExpires(admin: AdminClient, userId: string): Promise<void> {
  const dreamId = await prepareAudio(admin, userId);
  const path = `${userId}/${dreamId}/source.webm`;
  try {
    await uploadFixtureAudio(admin, path);
    await completeFixtureAudio(admin, dreamId, userId, path);
    await setAudioExpiry(admin, dreamId, STALE_AUDIO_AGE_MS);
    const expired = await admin.rpc("expire_stale_audio_processing", {
      p_dream_id: dreamId, p_user_id: userId,
    });
    assertNoError(expired.error);
    const result = await admin.from("dreams").select("status,error_code").eq("id", dreamId).single();
    assertNoError(result.error);
    const state = z.object({ status: z.literal("FAILED"), error_code: z.literal("audio_processing_expired") });
    state.parse(result.data);
  } finally {
    const removed = await admin.storage.from("dream-audio").remove([path]);
    assertNoError(removed.error);
  }
}

async function uploadFixtureAudio(admin: AdminClient, path: string): Promise<void> {
  const result = await admin.storage.from("dream-audio").upload(path, Buffer.from([1, 2, 3]), {
    contentType: AUDIO_MIME, upsert: false,
  });
  assertNoError(result.error);
}

async function completeFixtureAudio(
  admin: AdminClient,
  dreamId: string,
  userId: string,
  path: string,
): Promise<void> {
  const result = await admin.rpc("complete_audio_upload", {
    p_dream_id: dreamId, p_user_id: userId, p_storage_path: path,
    p_mime_type: AUDIO_MIME, p_size_bytes: 3,
  });
  assertNoError(result.error);
}

async function setAudioExpiry(admin: AdminClient, dreamId: string, ageMs: number): Promise<void> {
  const result = await admin.from("dreams").update({
    audio_upload_expires_at: new Date(Date.now() - ageMs).toISOString(),
  }).eq("id", dreamId);
  assertNoError(result.error);
}

async function prepareAudio(admin: AdminClient, userId: string): Promise<string> {
  const result = await admin.rpc("prepare_audio_dream", audioPreparationArgs(
    userId, crypto.randomUUID(), AUDIO_MIME,
  ));
  assertNoError(result.error);
  return dreamIdSchema.parse(result.data);
}

async function expireAudio(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").update({
    audio_upload_expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq("id", dreamId);
  assertNoError(result.error);
}

async function makeRetainedDreamReady(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").update({
    status: "READY", retain_audio: true, audio_mime_type: null, transcript: "Fixture transcript",
    audio_upload_expires_at: new Date(Date.now() - 60_000).toISOString(),
  }).eq("id", dreamId);
  assertNoError(result.error);
}

async function claimCleanup(admin: AdminClient, dreamId: string, userId: string, token: string) {
  const result = await admin.rpc("claim_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_claim_token: token,
  });
  assertNoError(result.error);
  return z.object({ workflow_id: z.string().nullable(), claimed: z.boolean() })
    .array().min(1).parse(result.data)[0];
}

async function recordCleanup(
  admin: AdminClient,
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await admin.rpc("record_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  assertNoError(result.error);
}

async function assertStaleCleanupReleaseProtected(
  admin: AdminClient,
  dreamId: string,
  userId: string,
  token: string,
  runId: string,
): Promise<void> {
  const released = await admin.rpc("release_audio_cleanup_execution", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: `stale-${runId}`,
  });
  assertNoError(released.error);
  const replay = await claimCleanup(admin, dreamId, userId, crypto.randomUUID());
  if (replay.workflow_id !== runId) throw new Error("Stale cleanup release cleared the active run");
}

async function completeCleanup(admin: AdminClient, dreamId: string, runId: string): Promise<void> {
  const result = await admin.rpc("complete_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_run_id: runId,
  });
  assertNoError(result.error);
}

async function assertCleanupCleared(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").select("audio_upload_expires_at,audio_cleanup_run_id")
    .eq("id", dreamId).single();
  assertNoError(result.error);
  z.object({
    audio_upload_expires_at: z.null(), audio_cleanup_run_id: z.null(),
  }).parse(result.data);
}

async function assertDreamDeleted(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").select("id").eq("id", dreamId).maybeSingle();
  assertNoError(result.error);
  if (result.data) throw new Error("Expired audio draft was not deleted");
}

async function assertNullCleanupPathRejected(env: Env, dreamId: string, userId: string): Promise<void> {
  await expectAudioRpcFailure(env, "complete_expired_audio_draft_cleanup", {
    p_dream_id: dreamId, p_user_id: userId, p_storage_path: null,
  });
}

async function assertNullRecordClaimRejected(env: Env, dreamId: string): Promise<void> {
  await expectAudioRpcFailure(env, "record_audio_cleanup_workflow", {
    p_dream_id: dreamId, p_claim_token: null, p_run_id: `cleanup-${crypto.randomUUID()}`,
  });
}

async function expectAudioRpcFailure(
  env: Env,
  name: string,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: serviceHeaders(env), body: JSON.stringify(body),
  });
  if (response.ok) throw new Error(`${name} unexpectedly accepted invalid audio input`);
}
