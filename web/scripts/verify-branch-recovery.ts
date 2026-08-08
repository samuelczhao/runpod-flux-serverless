import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../src/lib/database/types.ts";

const envSchema = z.object({
  DREAMTRACE_DB_INTEGRATION: z.literal("1"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});
const idSchema = z.object({ id: z.uuid() });
const claimSchema = z.object({ job_id: z.uuid() });
const workflowClaimSchema = z.object({ workflow_id: z.string().nullable(), claimed: z.boolean() });
const stateSchema = z.object({ status: z.string() });
const REQUEST_HASH = "a".repeat(64);
const FIXTURE_MODEL = "integration-fixture";
const FIXTURE_ENDPOINT = "integration-endpoint";
const FIXTURE_SEED = 7;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type AdminClient = SupabaseClient<Database>;
type Env = z.infer<typeof envSchema>;

interface Fixture {
  readonly userId: string;
  readonly dreamId: string;
  readonly versionId: string;
  readonly jobId: string;
  readonly storagePath: string;
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const admin = createAdmin(env);
  const userId = await createAnonymousUser(env);
  const storagePaths: string[] = [];
  try {
    const fixture = await createFixture(admin, userId, storagePaths);
    await assertNullGuards(env, fixture);
    await assertWorkflowClaiming(admin, fixture);
    await assertForeignVersionHidden(env, admin, fixture.versionId);
    await verifyRecovery(admin, fixture);
    console.log("branch_recovery status=COMPLETED");
  } finally {
    await cleanup(admin, userId, storagePaths);
  }
}

function createAdmin(env: Env): AdminClient {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createAnonymousUser(env: Env): Promise<string> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const result = await client.auth.signInAnonymously();
  assertNoError(result.error);
  if (!result.data.user) throw new Error("Anonymous user creation returned no user");
  return result.data.user.id;
}

async function createFixture(
  admin: AdminClient,
  userId: string,
  storagePaths: string[],
): Promise<Fixture> {
  const dreamId = await insertDream(admin, userId);
  const sceneId = await insertScene(admin, dreamId);
  const parentId = await insertInitialVersion(admin, sceneId);
  const parentPath = `${userId}/${dreamId}/${parentId}.png`;
  storagePaths.push(parentPath);
  await uploadArtifact(admin, parentPath);
  await completeParent(admin, parentId, parentPath);
  const versionId = await createBranchVersion(admin, userId, dreamId, parentId);
  const storagePath = `${userId}/${dreamId}/${versionId}.png`;
  storagePaths.push(storagePath);
  const jobId = await claimBranchJob(admin, userId, dreamId, versionId);
  return { userId, dreamId, versionId, jobId, storagePath };
}

async function insertDream(admin: AdminClient, userId: string): Promise<string> {
  const result = await admin.from("dreams").insert({
    user_id: userId, input_mode: "text", transcript: "Integration fixture", status: "READY",
  }).select("id").single();
  assertNoError(result.error);
  return idSchema.parse(result.data).id;
}

async function insertScene(admin: AdminClient, dreamId: string): Promise<string> {
  const result = await admin.from("scenes").insert({
    dream_id: dreamId, ordinal: 2, caption: "Fixture scene", prompt: "Fixture prompt",
  }).select("id").single();
  assertNoError(result.error);
  return idSchema.parse(result.data).id;
}

async function insertInitialVersion(admin: AdminClient, sceneId: string): Promise<string> {
  const result = await admin.from("scene_versions").insert({
    scene_id: sceneId, model: FIXTURE_MODEL, seed: FIXTURE_SEED, status: "PENDING",
  }).select("id").single();
  assertNoError(result.error);
  return idSchema.parse(result.data).id;
}

async function completeParent(admin: AdminClient, id: string, storagePath: string): Promise<void> {
  const result = await admin.from("scene_versions").update({
    storage_path: storagePath, status: "COMPLETED", is_selected: true,
  }).eq("id", id);
  assertNoError(result.error);
}

async function createBranchVersion(
  admin: AdminClient,
  userId: string,
  dreamId: string,
  parentId: string,
): Promise<string> {
  const result = await admin.rpc("create_scene_branch", branchRpcArgs(userId, dreamId, parentId));
  assertNoError(result.error);
  return z.object({ version_id: z.uuid() }).array().min(1).parse(result.data)[0].version_id;
}

async function claimBranchJob(
  admin: AdminClient,
  userId: string,
  dreamId: string,
  versionId: string,
): Promise<string> {
  const result = await admin.rpc("claim_generation_job", {
    p_user_id: userId, p_dream_id: dreamId, p_scene_version_id: versionId,
    p_stage: "branch", p_operation_key: crypto.randomUUID(),
    p_model: FIXTURE_MODEL, p_endpoint_id: FIXTURE_ENDPOINT, p_request_hash: REQUEST_HASH,
  });
  assertNoError(result.error);
  const claim = claimSchema.array().min(1).parse(result.data)[0];
  return claim.job_id;
}

async function verifyRecovery(admin: AdminClient, fixture: Fixture): Promise<void> {
  await transitionToUnknown(admin, fixture.jobId);
  await assertVersionState(admin, fixture.versionId, "SUBMIT_UNKNOWN");
  await recordRecovery(admin, fixture.jobId);
  await assertVersionState(admin, fixture.versionId, "PENDING");
  await uploadArtifact(admin, fixture.storagePath);
  await completeJob(admin, fixture);
  await assertVersionState(admin, fixture.versionId, "COMPLETED");
  await assertJobState(admin, fixture.jobId, "COMPLETED");
}

async function transitionToUnknown(admin: AdminClient, jobId: string): Promise<void> {
  const result = await admin.rpc("update_generation_job", {
    p_job_id: jobId, p_expected: "SUBMITTING", p_next: "SUBMIT_UNKNOWN",
    p_error_code: "integration_ambiguous",
  });
  assertNoError(result.error);
}

async function recordRecovery(admin: AdminClient, jobId: string): Promise<void> {
  const result = await admin.rpc("record_generation_submission", {
    p_job_id: jobId, p_external_id: `integration-${crypto.randomUUID()}`,
  });
  assertNoError(result.error);
}

async function uploadArtifact(admin: AdminClient, storagePath: string): Promise<void> {
  const result = await admin.storage.from("dream-images").upload(storagePath, ONE_PIXEL_PNG, {
    contentType: "image/png", upsert: false,
  });
  assertNoError(result.error);
}

async function completeJob(admin: AdminClient, fixture: Fixture): Promise<void> {
  const result = await admin.rpc("complete_generation_job", {
    p_job_id: fixture.jobId, p_storage_path: fixture.storagePath,
    p_cost_usd: null, p_cost_source: "unavailable",
  });
  assertNoError(result.error);
}

async function assertVersionState(admin: AdminClient, id: string, expected: string): Promise<void> {
  const result = await admin.from("scene_versions").select("status").eq("id", id).single();
  assertNoError(result.error);
  if (stateSchema.parse(result.data).status !== expected) throw new Error(`Version did not reach ${expected}`);
}

async function assertJobState(admin: AdminClient, id: string, expected: string): Promise<void> {
  const result = await admin.from("generation_jobs").select("status").eq("id", id).single();
  assertNoError(result.error);
  if (stateSchema.parse(result.data).status !== expected) throw new Error(`Job did not reach ${expected}`);
}

async function cleanup(admin: AdminClient, userId: string, storagePaths: readonly string[]): Promise<void> {
  if (storagePaths.length) {
    const storage = await admin.storage.from("dream-images").remove([...storagePaths]);
    assertNoError(storage.error);
  }
  const auth = await admin.auth.admin.deleteUser(userId);
  assertNoError(auth.error);
}

async function assertNullGuards(env: Env, fixture: Fixture): Promise<void> {
  const base = branchRpcArgs(fixture.userId, fixture.dreamId, await parentIdForFixture(env, fixture.versionId));
  await expectRpcFailure(env, "create_scene_branch", { ...base, p_seed: null });
  await expectRpcFailure(env, "create_scene_branch", { ...base, p_request_hash: null });
  await expectRpcFailure(env, "claim_generation_job", {
    p_user_id: fixture.userId, p_dream_id: fixture.dreamId,
    p_scene_version_id: fixture.versionId, p_stage: "branch",
    p_operation_key: crypto.randomUUID(), p_model: FIXTURE_MODEL,
    p_endpoint_id: FIXTURE_ENDPOINT, p_request_hash: null,
  });
}

async function assertWorkflowClaiming(admin: AdminClient, fixture: Fixture): Promise<void> {
  const firstToken = crypto.randomUUID();
  const first = await claimWorkflow(admin, fixture, firstToken);
  const duplicate = await claimWorkflow(admin, fixture, crypto.randomUUID());
  if (!first.claimed || duplicate.claimed) throw new Error("Branch workflow claim was not exclusive");
  const runId = `integration-run-${crypto.randomUUID()}`;
  const recorded = await admin.rpc("record_branch_workflow", {
    p_version_id: fixture.versionId, p_claim_token: firstToken, p_run_id: runId,
  });
  assertNoError(recorded.error);
  const replay = await claimWorkflow(admin, fixture, crypto.randomUUID());
  if (replay.claimed || replay.workflow_id !== runId) throw new Error("Branch workflow replay diverged");
}

async function claimWorkflow(admin: AdminClient, fixture: Fixture, token: string) {
  const result = await admin.rpc("claim_branch_workflow", {
    p_user_id: fixture.userId, p_version_id: fixture.versionId, p_claim_token: token,
  });
  assertNoError(result.error);
  return workflowClaimSchema.array().min(1).parse(result.data)[0];
}

async function assertForeignVersionHidden(env: Env, admin: AdminClient, versionId: string): Promise<void> {
  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const auth = await client.auth.signInAnonymously();
  assertNoError(auth.error);
  if (!auth.data.user) throw new Error("Foreign anonymous user creation returned no user");
  try {
    const result = await client.from("scene_versions").select("id").eq("id", versionId).maybeSingle();
    assertNoError(result.error);
    if (result.data) throw new Error("RLS exposed a foreign scene version");
  } finally {
    const deleted = await admin.auth.admin.deleteUser(auth.data.user.id);
    assertNoError(deleted.error);
  }
}

async function parentIdForFixture(env: Env, versionId: string): Promise<string> {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/scene_versions?id=eq.${versionId}&select=parent_version_id`, {
    headers: serviceHeaders(env),
  });
  if (!response.ok) throw new Error(`Fixture parent lookup failed with HTTP ${response.status}`);
  const rows = z.object({ parent_version_id: z.uuid() }).array().min(1).parse(await response.json());
  return rows[0].parent_version_id;
}

async function expectRpcFailure(
  env: Env,
  functionName: string,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST", headers: serviceHeaders(env), body: JSON.stringify(body),
  });
  if (response.ok) throw new Error(`${functionName} unexpectedly accepted a NULL identity`);
}

function branchRpcArgs(userId: string, dreamId: string, parentId: string) {
  return {
    p_user_id: userId, p_dream_id: dreamId, p_parent_version_id: parentId,
    p_instruction: "Turn the fixture moon into a doorway", p_model: FIXTURE_MODEL,
    p_seed: FIXTURE_SEED, p_operation_key: `integration:${crypto.randomUUID()}`,
    p_request_hash: REQUEST_HASH,
  };
}

function serviceHeaders(env: Env): Readonly<Record<string, string>> {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

function assertNoError(error: { readonly message: string } | null): void {
  if (error) throw new Error(error.message);
}

await main();
