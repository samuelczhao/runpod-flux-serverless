import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../src/lib/database/types.ts";
import {
  FIXTURE_ENDPOINT,
  FIXTURE_MODEL,
  REQUEST_HASH,
  assertNoError,
  branchRpcArgs,
  cleanup,
  createAdmin,
  createAnonymousUser,
  createFixture,
  parseIntegrationEnv,
  serviceHeaders,
  uploadArtifact,
  type AdminClient,
  type Env,
  type Fixture,
} from "./branch-recovery-fixture.ts";
import { assertAudioPreparation } from "./audio-lifecycle-fixture.ts";

const workflowClaimSchema = z.object({ workflow_id: z.string().nullable(), claimed: z.boolean() });
const stateSchema = z.object({ status: z.string() });
const endpointSchema = z.object({ endpoint_id: z.string() });
const workflowStateSchema = z.object({
  workflow_claim_token: z.string().nullable(), workflow_run_id: z.string().nullable(),
});

async function main(): Promise<void> {
  const env = parseIntegrationEnv();
  const admin = createAdmin(env);
  const userId = await createAnonymousUser(env);
  const storagePaths: string[] = [];
  try {
    await verifyFixture(env, admin, userId, storagePaths);
  } catch (error: unknown) {
    await cleanupAfterFailure(admin, userId, storagePaths, error);
  }
  await cleanup(admin, userId, storagePaths);
}

async function verifyFixture(
  env: Env,
  admin: AdminClient,
  userId: string,
  storagePaths: string[],
): Promise<void> {
  await assertAudioPreparation(env, admin, userId);
  await assertTextWorkflowRecovery(admin, userId);
  const fixture = await createFixture(admin, userId, storagePaths);
  await assertNullGuards(env, fixture);
  await assertSingleBranchInvariant(env, admin, fixture);
  await assertGenerationIdentity(admin, fixture);
  await assertWorkflowClaiming(admin, fixture);
  await assertForeignVersionHidden(env, admin, fixture.versionId);
  await verifyRecovery(admin, fixture);
  console.log("branch_recovery status=COMPLETED");
}

async function assertTextWorkflowRecovery(admin: AdminClient, userId: string): Promise<void> {
  const operationId = crypto.randomUUID();
  const transcript = "A moonlit library floated over a quiet ocean.";
  const args = { p_user_id: userId, p_operation_key: operationId, p_transcript: transcript };
  const first = await admin.rpc("prepare_text_dream", args);
  const replay = await admin.rpc("prepare_text_dream", args);
  assertNoError(first.error); assertNoError(replay.error);
  const dreamId = z.uuid().parse(first.data);
  if (dreamId !== z.uuid().parse(replay.data)) {
    throw new Error("Text preparation replay created a second dream");
  }
  const conflict = await admin.rpc("prepare_text_dream", {
    ...args, p_transcript: "A different dream cannot reuse the same operation identity.",
  });
  if (!conflict.error) throw new Error("Text operation accepted a changed transcript");
  await assertDreamWorkflowRecovery(admin, dreamId, userId);
}

async function assertDreamWorkflowRecovery(
  admin: AdminClient,
  dreamId: string,
  userId: string,
): Promise<void> {
  const token = crypto.randomUUID();
  const first = await claimDreamWorkflow(admin, dreamId, userId, token);
  const duplicate = await claimDreamWorkflow(admin, dreamId, userId, crypto.randomUUID());
  if (!first.claimed || duplicate.claimed) throw new Error("Dream workflow claim was not exclusive");
  const runId = `dream-run-${crypto.randomUUID()}`;
  const recorded = await admin.rpc("record_dream_workflow", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  assertNoError(recorded.error);
  await releaseDreamExecution(admin, dreamId, crypto.randomUUID(), `wrong-${runId}`);
  const protectedReplay = await claimDreamWorkflow(admin, dreamId, userId, crypto.randomUUID());
  if (protectedReplay.workflow_id !== runId) throw new Error("A stale run cleared dream ownership");
  await releaseDreamExecution(admin, dreamId, token, runId);
  const recoveryToken = crypto.randomUUID();
  const recovery = await claimDreamWorkflow(admin, dreamId, userId, recoveryToken);
  if (!recovery.claimed) throw new Error("A terminal dream workflow could not be reclaimed");
  await releaseDreamExecution(admin, dreamId, recoveryToken, recoveryToken);
}

async function claimDreamWorkflow(
  admin: AdminClient,
  dreamId: string,
  userId: string,
  token: string,
) {
  const result = await admin.rpc("claim_dream_workflow", {
    p_dream_id: dreamId, p_user_id: userId, p_claim_token: token,
  });
  assertNoError(result.error);
  return workflowClaimSchema.array().min(1).parse(result.data)[0];
}

async function releaseDreamExecution(
  admin: AdminClient,
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await admin.rpc("release_dream_workflow_execution", {
    p_dream_id: dreamId, p_claim_token: token, p_run_id: runId,
  });
  assertNoError(result.error);
}

async function assertSingleBranchInvariant(env: Env, admin: AdminClient, fixture: Fixture): Promise<void> {
  const parentId = await parentIdForFixture(env, fixture.versionId);
  const duplicate = await admin.rpc("create_scene_branch", branchRpcArgs(
    fixture.userId, fixture.dreamId, parentId,
  ));
  if (!duplicate.error) throw new Error("A scene accepted more than one generated branch");
}

async function cleanupAfterFailure(
  admin: AdminClient,
  userId: string,
  storagePaths: readonly string[],
  error: unknown,
): Promise<never> {
  try {
    await cleanup(admin, userId, storagePaths);
  } catch (cleanupError: unknown) {
    throw new AggregateError([error, cleanupError], "Fixture assertions and cleanup both failed");
  }
  throw error;
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
  await recordWorkflow(admin, fixture.versionId, firstToken, runId);
  await assertRunReplay(admin, fixture, runId);
  await assertRunRelease(admin, fixture, firstToken, runId);
  await assertClaimRelease(admin, fixture);
}

async function recordWorkflow(
  admin: AdminClient,
  versionId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await admin.rpc("record_branch_workflow", {
    p_version_id: versionId, p_claim_token: token, p_run_id: runId,
  });
  assertNoError(result.error);
}

async function assertRunReplay(admin: AdminClient, fixture: Fixture, runId: string): Promise<void> {
  const replay = await claimWorkflow(admin, fixture, crypto.randomUUID());
  if (replay.claimed || replay.workflow_id !== runId) throw new Error("Branch workflow replay diverged");
}

async function assertRunRelease(
  admin: AdminClient,
  fixture: Fixture,
  token: string,
  runId: string,
): Promise<void> {
  await releaseWorkflowExecution(admin, fixture.versionId, token, `wrong-${runId}`);
  const protectedReplay = await claimWorkflow(admin, fixture, crypto.randomUUID());
  if (protectedReplay.workflow_id !== runId) throw new Error("A stale run cleared the active workflow");
  await releaseWorkflowExecution(admin, fixture.versionId, token, runId);
}

async function assertClaimRelease(admin: AdminClient, fixture: Fixture): Promise<void> {
  const recoveryToken = crypto.randomUUID();
  const recovery = await claimWorkflow(admin, fixture, recoveryToken);
  if (!recovery.claimed) throw new Error("A failed branch workflow could not be reclaimed");
  await releaseWorkflowExecution(admin, fixture.versionId, crypto.randomUUID(), crypto.randomUUID());
  const protectedClaim = await claimWorkflow(admin, fixture, crypto.randomUUID());
  if (protectedClaim.claimed) throw new Error("A stale token cleared a newer workflow claim");
  await releaseWorkflowExecution(admin, fixture.versionId, recoveryToken, crypto.randomUUID());
  await assertWorkflowStateCleared(admin, fixture.versionId);
}

async function releaseWorkflowExecution(
  admin: AdminClient,
  versionId: string,
  token: string,
  runId: string,
): Promise<void> {
  const result = await admin.rpc("release_branch_workflow_execution", {
    p_version_id: versionId, p_claim_token: token, p_run_id: runId,
  });
  assertNoError(result.error);
}

async function assertWorkflowStateCleared(admin: AdminClient, versionId: string): Promise<void> {
  const result = await admin.from("scene_versions")
    .select("workflow_claim_token,workflow_run_id").eq("id", versionId).single();
  assertNoError(result.error);
  const state = workflowStateSchema.parse(result.data);
  if (state.workflow_claim_token || state.workflow_run_id) {
    throw new Error("Branch workflow recovery left stale ownership state");
  }
}

async function assertGenerationIdentity(admin: AdminClient, fixture: Fixture): Promise<void> {
  const stored = await admin.from("generation_jobs").select("endpoint_id").eq("id", fixture.jobId).single();
  assertNoError(stored.error);
  if (endpointSchema.parse(stored.data).endpoint_id !== FIXTURE_ENDPOINT) {
    throw new Error("Generation job did not persist its endpoint identity");
  }
  const conflict = await admin.rpc("claim_generation_job", {
    p_user_id: fixture.userId, p_dream_id: fixture.dreamId,
    p_scene_version_id: fixture.versionId, p_stage: "branch",
    p_operation_key: fixture.jobOperationKey, p_model: FIXTURE_MODEL,
    p_endpoint_id: "different-endpoint", p_request_hash: REQUEST_HASH,
  });
  if (!conflict.error) throw new Error("Generation identity accepted a changed endpoint");
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

await main();
