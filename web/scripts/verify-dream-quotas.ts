import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  assertNoError,
  cleanup,
  createAdmin,
  fixtureFetch,
  parseIntegrationEnv,
  type AdminClient,
  type Env,
} from "./branch-recovery-fixture.ts";
import type { Database } from "../src/lib/database/types.ts";

const dreamIdSchema = z.uuid();
const ACTIVE_LIMIT_CODE = "P4291";
const HOURLY_LIMIT_CODE = "P4292";
const BRANCH_HOURLY_LIMIT_CODE = "P4294";
const IDENTITY_HOURLY_LIMIT_CODE = "P4295";
const BRANCH_HOURLY_LIMIT = 12;
const IDENTITY_HOURLY_LIMIT = 6;
const STALE_DRAFT_AGE_MS = 16 * 60 * 1_000;

async function main(): Promise<void> {
  const env = parseIntegrationEnv();
  const admin = createAdmin(env);
  const session = await createAnonymousSession(env);
  const userId = session.userId;
  await runWithCleanup(async () => {
    await assertDirectInsertBlocked(session.client, userId);
    const globalBefore = await globalUsage(admin);
    const identityGlobalBefore = await identityGlobalUsage(admin);
    await verifyQuotaLifecycle(admin, userId, globalBefore, identityGlobalBefore);
    console.log("dream_quotas status=COMPLETED");
  }, () => cleanup(admin, userId, []));
}

async function runWithCleanup(
  work: () => Promise<void>,
  cleanupWork: () => Promise<void>,
): Promise<void> {
  let primaryError: unknown;
  try { await work(); } catch (error: unknown) { primaryError = error; }
  try { await cleanupWork(); } catch (cleanupError: unknown) {
    if (primaryError) throw new AggregateError([primaryError, cleanupError], "Fixture and cleanup failed");
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}

async function verifyQuotaLifecycle(
  admin: AdminClient,
  userId: string,
  globalBefore: number,
  identityGlobalBefore: number,
): Promise<void> {
  const legacyOperation = crypto.randomUUID();
  const stale = await insertUnreservedDream(admin, userId, legacyOperation);
  const reserved = await prepareText(
    admin, userId, legacyOperation, "A stale silver train crossed the moon.",
  );
  if (reserved !== stale) throw new Error("Legacy reservation changed the dream ID");
  await assertDreamReserved(admin, stale);
  await ageDream(admin, stale);
  const textOperation = crypto.randomUUID();
  const audioOperation = crypto.randomUUID();
  const [text, audio] = await Promise.all([
    prepareText(admin, userId, textOperation, "A blue forest opened around a quiet lake."),
    prepareAudio(admin, userId, audioOperation),
  ]);
  await assertReplayAndConflict(admin, userId, textOperation, text);
  await expectQuotaCode(claimDream(admin, stale, userId), ACTIVE_LIMIT_CODE);
  await expectQuotaCode(prepareTextResult(admin, userId, crypto.randomUUID(), "A third active dream."), ACTIVE_LIMIT_CODE);

  await closeDreams(admin, [stale, text, audio]);
  await closeDreams(admin, await preparePair(admin, userId));
  const sixth = await prepareAudio(admin, userId, crypto.randomUUID());
  await closeDreams(admin, [sixth]);
  await expectQuotaCode(
    prepareTextResult(admin, userId, crypto.randomUUID(), "A seventh dream reached the horizon."),
    HOURLY_LIMIT_CODE,
  );
  await verifyBranchQuota(admin, userId);
  await verifyIdentityQuota(admin, userId);
  await assertCounters(admin, userId, globalBefore, identityGlobalBefore);
}

async function verifyIdentityQuota(admin: AdminClient, userId: string): Promise<void> {
  const firstOperation = crypto.randomUUID();
  const firstId = await prepareIdentity(admin, userId, firstOperation);
  const replayId = await prepareIdentity(admin, userId, firstOperation);
  if (replayId !== firstId) throw new Error("Identity quota replay changed the reference ID");
  await failIdentity(admin, firstId);
  for (let attempt = 1; attempt < IDENTITY_HOURLY_LIMIT; attempt += 1) {
    await failIdentity(admin, await prepareIdentity(admin, userId, crypto.randomUUID()));
  }
  await expectQuotaCode(
    prepareIdentityResult(admin, userId, crypto.randomUUID()),
    IDENTITY_HOURLY_LIMIT_CODE,
  );
}

async function prepareIdentity(
  admin: AdminClient,
  userId: string,
  operationId: string,
): Promise<string> {
  const result = await prepareIdentityResult(admin, userId, operationId);
  assertNoError(result.error);
  return z.object({ reference_id: z.uuid() }).array().min(1).parse(result.data)[0]!.reference_id;
}

function prepareIdentityResult(admin: AdminClient, userId: string, operationId: string) {
  return admin.rpc("prepare_identity_reference", {
    p_user_id: userId,
    p_operation_key: operationId,
    p_mime_type: "image/jpeg",
    p_consent_confirmed: true,
    p_consent_version: "dream-self-v1",
  });
}

async function failIdentity(admin: AdminClient, identityId: string): Promise<void> {
  const result = await admin.from("identity_references").update({ status: "FAILED" }).eq("id", identityId);
  assertNoError(result.error);
}

async function createAnonymousSession(env: Env): Promise<{
  readonly client: SupabaseClient<Database>;
  readonly userId: string;
}> {
  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fixtureFetch },
  });
  const result = await client.auth.signInAnonymously();
  assertNoError(result.error);
  if (!result.data.user) throw new Error("Anonymous quota fixture returned no user");
  return { client, userId: result.data.user.id };
}

async function assertDirectInsertBlocked(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const result = await client.from("dreams").insert({
    user_id: userId,
    input_mode: "text",
    transcript: "A browser tried to bypass the admission boundary.",
    text_operation_key: crypto.randomUUID(),
    visual_style: "watercolor-memory",
  });
  if (!result.error) throw new Error("Authenticated browser inserted a dream directly");
}

async function insertUnreservedDream(
  admin: AdminClient,
  userId: string,
  operationId: string,
): Promise<string> {
  const result = await admin.from("dreams").insert({
    user_id: userId,
    input_mode: "text",
    transcript: "A stale silver train crossed the moon.",
    text_operation_key: operationId,
    visual_style: "watercolor-memory",
  }).select("id").single();
  assertNoError(result.error);
  return z.object({ id: z.uuid() }).parse(result.data).id;
}

async function assertDreamReserved(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").select("quota_reserved_at").eq("id", dreamId).single();
  assertNoError(result.error);
  z.object({ quota_reserved_at: z.iso.datetime({ offset: true }) }).parse(result.data);
}

async function verifyBranchQuota(admin: AdminClient, userId: string): Promise<void> {
  const parent = await createBranchParent(admin, userId);
  let firstArgs: ReturnType<typeof branchArgs> | null = null;
  let firstVersionId: string | null = null;
  for (let attempt = 0; attempt < BRANCH_HOURLY_LIMIT; attempt += 1) {
    const args = branchArgs(userId, parent.dreamId, parent.versionId);
    const result = await admin.rpc("create_scene_branch", args);
    assertNoError(result.error);
    const versionId = branchVersionId(result.data);
    if (attempt === 0) { firstArgs = args; firstVersionId = versionId; }
    await closeBranch(admin, versionId);
  }
  if (!firstArgs || !firstVersionId) throw new Error("Branch quota fixture created no branch");
  const replay = await admin.rpc("create_scene_branch", firstArgs);
  assertNoError(replay.error);
  if (branchVersionId(replay.data) !== firstVersionId) throw new Error("Branch replay changed version ID");
  await expectQuotaCode(
    admin.rpc("create_scene_branch", branchArgs(userId, parent.dreamId, parent.versionId)),
    BRANCH_HOURLY_LIMIT_CODE,
  );
}

async function createBranchParent(
  admin: AdminClient,
  userId: string,
): Promise<{ readonly dreamId: string; readonly versionId: string }> {
  const dream = await admin.from("dreams").insert({
    user_id: userId, input_mode: "text", transcript: "Branch quota fixture",
    status: "READY", mood: ["wonder"], quota_reserved_at: new Date().toISOString(),
  }).select("id").single();
  assertNoError(dream.error);
  const dreamId = z.object({ id: z.uuid() }).parse(dream.data).id;
  const scene = await admin.from("scenes").insert({
    dream_id: dreamId, ordinal: 1, caption: "Moon doorway", prompt: "A moon doorway",
  }).select("id").single();
  assertNoError(scene.error);
  const sceneId = z.object({ id: z.uuid() }).parse(scene.data).id;
  const version = await admin.from("scene_versions").insert({
    scene_id: sceneId, model: "integration-fixture", seed: 7,
    status: "COMPLETED", storage_path: `${userId}/${dreamId}/original.png`, is_selected: true,
  }).select("id").single();
  assertNoError(version.error);
  return { dreamId, versionId: z.object({ id: z.uuid() }).parse(version.data).id };
}

function branchArgs(userId: string, dreamId: string, parentVersionId: string) {
  return {
    p_user_id: userId, p_dream_id: dreamId, p_parent_version_id: parentVersionId,
    p_instruction: "Turn the fixture moon into a doorway", p_model: "integration-fixture",
    p_seed: 7, p_operation_key: `quota-branch:${crypto.randomUUID()}`,
    p_request_hash: "a".repeat(64),
  };
}

function branchVersionId(data: unknown): string {
  return z.object({ version_id: z.uuid() }).array().min(1).parse(data)[0]!.version_id;
}

async function closeBranch(admin: AdminClient, versionId: string): Promise<void> {
  const result = await admin.from("scene_versions").update({ status: "FAILED" }).eq("id", versionId);
  assertNoError(result.error);
}

async function assertReplayAndConflict(
  admin: AdminClient,
  userId: string,
  operationId: string,
  expectedDreamId: string,
): Promise<void> {
  const replay = await prepareText(admin, userId, operationId, "A blue forest opened around a quiet lake.");
  if (replay !== expectedDreamId) throw new Error("Quota replay changed the dream ID");
  const conflict = prepareTextResult(admin, userId, operationId, "A changed dream reused the same operation key.");
  await expectQuotaCode(conflict, "23505");
}

async function preparePair(admin: AdminClient, userId: string): Promise<string[]> {
  const [text, audio] = await Promise.all([
    prepareText(admin, userId, crypto.randomUUID(), "A glass staircase curved through a warm cloud."),
    prepareAudio(admin, userId, crypto.randomUUID()),
  ]);
  return [text, audio];
}

async function prepareText(
  admin: AdminClient,
  userId: string,
  operationId: string,
  transcript: string,
): Promise<string> {
  const result = await prepareTextResult(admin, userId, operationId, transcript);
  assertNoError(result.error);
  return dreamIdSchema.parse(result.data);
}

function prepareTextResult(
  admin: AdminClient,
  userId: string,
  operationId: string,
  transcript: string,
) {
  return admin.rpc("prepare_text_dream", {
    p_user_id: userId, p_operation_key: operationId, p_transcript: transcript,
    p_identity_reference_id: null, p_visual_style: "watercolor-memory",
  });
}

async function prepareAudio(
  admin: AdminClient,
  userId: string,
  operationId: string,
): Promise<string> {
  const result = await admin.rpc("prepare_audio_dream", {
    p_user_id: userId, p_operation_key: operationId, p_mime_type: "audio/webm",
    p_identity_reference_id: null, p_visual_style: "watercolor-memory",
  });
  assertNoError(result.error);
  return dreamIdSchema.parse(result.data);
}

function claimDream(admin: AdminClient, dreamId: string, userId: string) {
  return admin.rpc("claim_dream_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_claim_token: crypto.randomUUID(),
  });
}

async function expectQuotaCode(
  operation: PromiseLike<{ readonly error: { readonly code?: string } | null }>,
  expectedCode: string,
): Promise<void> {
  const result = await operation;
  if (result.error?.code !== expectedCode) {
    throw new Error(`Expected database code ${expectedCode}, received ${result.error?.code ?? "success"}`);
  }
}

async function ageDream(admin: AdminClient, dreamId: string): Promise<void> {
  const result = await admin.from("dreams").update({
    created_at: new Date(Date.now() - STALE_DRAFT_AGE_MS).toISOString(),
  }).eq("id", dreamId);
  assertNoError(result.error);
}

async function closeDreams(admin: AdminClient, dreamIds: readonly string[]): Promise<void> {
  const result = await admin.from("dreams").update({ status: "DELETING" }).in("id", [...dreamIds]);
  assertNoError(result.error);
}

async function assertCounters(
  admin: AdminClient,
  userId: string,
  globalBefore: number,
  identityGlobalBefore: number,
): Promise<void> {
  const hourly = await admin.from("dream_user_hourly_usage").select("used").eq("user_id", userId).single();
  assertNoError(hourly.error);
  const used = z.object({ used: z.number().int() }).parse(hourly.data).used;
  if (used !== 6) throw new Error(`Expected six hourly allocations, received ${used}`);
  const branches = await admin.from("branch_user_hourly_usage").select("used")
    .eq("user_id", userId).single();
  assertNoError(branches.error);
  const branchUsed = z.object({ used: z.number().int() }).parse(branches.data).used;
  if (branchUsed !== BRANCH_HOURLY_LIMIT) {
    throw new Error(`Expected ${BRANCH_HOURLY_LIMIT} branch allocations, received ${branchUsed}`);
  }
  const identities = await admin.from("identity_user_hourly_usage").select("used")
    .eq("user_id", userId).single();
  assertNoError(identities.error);
  const identityUsed = z.object({ used: z.number().int() }).parse(identities.data).used;
  if (identityUsed !== IDENTITY_HOURLY_LIMIT) {
    throw new Error(`Expected ${IDENTITY_HOURLY_LIMIT} photo allocations, received ${identityUsed}`);
  }
  const after = await globalUsage(admin);
  if (after < globalBefore + 6 + BRANCH_HOURLY_LIMIT) {
    throw new Error("Global quota did not record all allocations");
  }
  const identityAfter = await identityGlobalUsage(admin);
  if (identityAfter < identityGlobalBefore + IDENTITY_HOURLY_LIMIT) {
    throw new Error("Global photo quota did not record all allocations");
  }
}

async function identityGlobalUsage(admin: AdminClient): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await admin.from("identity_global_daily_usage").select("used")
    .eq("bucket_date", today).maybeSingle();
  assertNoError(result.error);
  return result.data?.used ?? 0;
}

async function globalUsage(admin: AdminClient): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await admin.from("dream_global_daily_usage").select("used")
    .eq("bucket_date", today).maybeSingle();
  assertNoError(result.error);
  return result.data?.used ?? 0;
}

await main();
