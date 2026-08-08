import { z } from "zod";
import {
  assertNoError,
  cleanup,
  createAdmin,
  createAnonymousUser,
  parseIntegrationEnv,
  type AdminClient,
} from "./branch-recovery-fixture.ts";

const dreamIdSchema = z.uuid();
const ACTIVE_LIMIT_CODE = "P4291";
const HOURLY_LIMIT_CODE = "P4292";
const STALE_DRAFT_AGE_MS = 16 * 60 * 1_000;

async function main(): Promise<void> {
  const env = parseIntegrationEnv();
  const admin = createAdmin(env);
  const userId = await createAnonymousUser(env);
  const globalBefore = await globalUsage(admin);
  try {
    await verifyQuotaLifecycle(admin, userId, globalBefore);
    console.log("dream_quotas status=COMPLETED");
  } finally {
    await cleanup(admin, userId, []);
  }
}

async function verifyQuotaLifecycle(
  admin: AdminClient,
  userId: string,
  globalBefore: number,
): Promise<void> {
  const stale = await prepareText(admin, userId, crypto.randomUUID(), "A stale silver train crossed the moon.");
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
  await assertCounters(admin, userId, globalBefore);
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
): Promise<void> {
  const hourly = await admin.from("dream_user_hourly_usage").select("used").eq("user_id", userId).single();
  assertNoError(hourly.error);
  const used = z.object({ used: z.number().int() }).parse(hourly.data).used;
  if (used !== 6) throw new Error(`Expected six hourly allocations, received ${used}`);
  const after = await globalUsage(admin);
  if (after < globalBefore + 6) throw new Error("Global quota did not record all allocations");
}

async function globalUsage(admin: AdminClient): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await admin.from("dream_global_daily_usage").select("used")
    .eq("bucket_date", today).maybeSingle();
  assertNoError(result.error);
  return result.data?.used ?? 0;
}

await main();
