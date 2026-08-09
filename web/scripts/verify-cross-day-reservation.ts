import { z } from "zod";
import {
  assertNoError,
  cleanup,
  createAdmin,
  createAnonymousUser,
  parseIntegrationEnv,
  type AdminClient,
} from "./branch-recovery-fixture.ts";

const STORY_SLOT_RESERVATION = 8;
const usageSchema = z.object({ used: z.number().int().nonnegative() }).nullable();

async function main(): Promise<void> {
  const env = parseIntegrationEnv();
  const admin = createAdmin(env);
  const userId = await createAnonymousUser(env);
  try {
    await assertCrossDayPreparation(admin, userId);
    await assertCrossDayWorkflowClaim(admin, userId, "UPLOADED", "audio");
    await assertCrossDayWorkflowClaim(admin, userId, "TRANSCRIBING", "audio");
    await assertCrossDayWorkflowClaim(admin, userId, "PLANNING", "text");
    await assertOwnedWorkflowNotRecharged(admin, userId);
    console.log("cross_day_reservation status=COMPLETED");
  } finally {
    await cleanup(admin, userId, []);
  }
}

async function assertCrossDayPreparation(admin: AdminClient, userId: string): Promise<void> {
  const operationId = crypto.randomUUID();
  const previousDay = new Date(Date.now() - 86_400_000).toISOString();
  const inserted = await admin.from("dreams").insert({
    user_id: userId, input_mode: "audio", status: "DRAFT",
    audio_operation_key: operationId, audio_mime_type: "audio/webm",
    audio_upload_expires_at: previousDay, visual_style: "dream-cinema",
    quota_reserved_at: previousDay,
  }).select("id").single();
  assertNoError(inserted.error);
  const dreamId = z.object({ id: z.uuid() }).parse(inserted.data).id;
  const before = await currentUsage(admin);
  const args = {
    p_user_id: userId, p_operation_key: operationId, p_mime_type: "audio/webm",
    p_identity_reference_id: null, p_visual_style: "dream-cinema" as const,
  };
  const first = await admin.rpc("prepare_audio_dream", args);
  const replay = await admin.rpc("prepare_audio_dream", args);
  assertNoError(first.error); assertNoError(replay.error);
  if (first.data !== dreamId || replay.data !== dreamId) throw new Error("Replay changed dream ID");
  const after = await currentUsage(admin);
  if (after - before !== STORY_SLOT_RESERVATION) {
    throw new Error(`Cross-day replay reserved ${after - before} slots instead of 8`);
  }
  const row = await admin.from("dreams").select("quota_reserved_at,audio_upload_expires_at")
    .eq("id", dreamId).single();
  assertNoError(row.error);
  const timestamps = z.object({
    quota_reserved_at: z.iso.datetime({ offset: true }),
    audio_upload_expires_at: z.iso.datetime({ offset: true }),
  }).parse(row.data);
  if (timestamps.quota_reserved_at.slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
    throw new Error("Dream reservation did not move to the current UTC bucket");
  }
  const closed = await admin.from("dreams").update({
    status: "FAILED", audio_mime_type: null, audio_upload_expires_at: null,
  }).eq("id", dreamId);
  assertNoError(closed.error);
}

async function assertCrossDayWorkflowClaim(
  admin: AdminClient,
  userId: string,
  status: "UPLOADED" | "TRANSCRIBING" | "PLANNING",
  inputMode: "audio" | "text",
): Promise<void> {
  const dreamId = crypto.randomUUID();
  const previousDay = new Date(Date.now() - 86_400_000).toISOString();
  const storagePath = `${userId}/${dreamId}/source.webm`;
  const audio = {
    audio_storage_path: storagePath, audio_mime_type: "audio/webm",
    audio_size_bytes: 1, audio_uploaded_at: previousDay,
    audio_upload_expires_at: previousDay,
  } as const;
  const inserted = await admin.from("dreams").insert({
    id: dreamId, user_id: userId, input_mode: inputMode, status,
    transcript: inputMode === "text" ? "A retry crossed the midnight horizon." : null,
    ...(inputMode === "audio" ? audio : {}),
    visual_style: "dream-cinema", quota_reserved_at: previousDay,
  });
  assertNoError(inserted.error);
  const before = await currentUsage(admin);
  const claimToken = crypto.randomUUID();
  const args = { p_dream_id: dreamId, p_user_id: userId, p_claim_token: claimToken };
  const claimed = await admin.rpc("claim_dream_workflow", args);
  const replay = await admin.rpc("claim_dream_workflow", args);
  assertNoError(claimed.error); assertNoError(replay.error);
  const claimSchema = z.object({ workflow_id: z.string(), claimed: z.literal(true) });
  claimSchema.array().length(1).parse(claimed.data);
  claimSchema.array().length(1).parse(replay.data);
  const after = await currentUsage(admin);
  if (after - before !== STORY_SLOT_RESERVATION) {
    throw new Error(`${status} retry reserved ${after - before} slots instead of 8`);
  }
  const closed = await admin.from("dreams").update({
    status: "FAILED", workflow_claim_token: null, workflow_claimed_at: null,
  }).eq("id", dreamId);
  assertNoError(closed.error);
}

async function assertOwnedWorkflowNotRecharged(admin: AdminClient, userId: string): Promise<void> {
  const previousDay = new Date(Date.now() - 86_400_000).toISOString();
  const runId = `existing-${crypto.randomUUID()}`;
  const inserted = await admin.from("dreams").insert({
    user_id: userId, input_mode: "text", status: "PLANNING",
    transcript: "An existing workflow kept its original reservation.",
    visual_style: "dream-cinema", quota_reserved_at: previousDay, workflow_run_id: runId,
  }).select("id").single();
  assertNoError(inserted.error);
  const dreamId = z.object({ id: z.uuid() }).parse(inserted.data).id;
  const before = await currentUsage(admin);
  const result = await admin.rpc("claim_dream_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_claim_token: crypto.randomUUID(),
  });
  assertNoError(result.error);
  const row = z.object({ workflow_id: z.literal(runId), claimed: z.literal(false) })
    .array().length(1).parse(result.data)[0];
  if (!row || await currentUsage(admin) !== before) {
    throw new Error("Existing workflow was charged a second daily reservation");
  }
}

async function currentUsage(admin: AdminClient): Promise<number> {
  const date = new Date().toISOString().slice(0, 10);
  const result = await admin.from("dream_global_daily_usage").select("used")
    .eq("bucket_date", date).maybeSingle();
  assertNoError(result.error);
  return usageSchema.parse(result.data)?.used ?? 0;
}

await main();
