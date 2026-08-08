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
const FIXTURE_MOOD = ["wonder"] as const;
const FIXTURE_SEED = 7;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const REQUEST_HASH = "a".repeat(64);
export const FIXTURE_MODEL = "integration-fixture";
export const FIXTURE_ENDPOINT = "integration-endpoint";

export type AdminClient = SupabaseClient<Database>;
export type Env = z.infer<typeof envSchema>;

export interface Fixture {
  readonly userId: string;
  readonly dreamId: string;
  readonly versionId: string;
  readonly jobId: string;
  readonly jobOperationKey: string;
  readonly storagePath: string;
}

export interface BranchRpcArgs {
  readonly p_user_id: string;
  readonly p_dream_id: string;
  readonly p_parent_version_id: string;
  readonly p_instruction: string;
  readonly p_model: string;
  readonly p_seed: number;
  readonly p_operation_key: string;
  readonly p_request_hash: string;
}

export function parseIntegrationEnv(): Env {
  return envSchema.parse(process.env);
}

export function createAdmin(env: Env): AdminClient {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function createAnonymousUser(env: Env): Promise<string> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const result = await client.auth.signInAnonymously();
  assertNoError(result.error);
  if (!result.data.user) throw new Error("Anonymous user creation returned no user");
  return result.data.user.id;
}

export async function createFixture(
  admin: AdminClient,
  userId: string,
  storagePaths: string[],
): Promise<Fixture> {
  const dreamId = await insertDream(admin, userId);
  const sceneId = await insertScene(admin, dreamId);
  const parentId = await insertInitialVersion(admin, sceneId);
  await prepareParent(admin, userId, dreamId, parentId, storagePaths);
  const versionId = await createBranchVersion(admin, userId, dreamId, parentId);
  const storagePath = `${userId}/${dreamId}/${versionId}.png`;
  storagePaths.push(storagePath);
  const jobOperationKey = `integration-job:${crypto.randomUUID()}`;
  const jobId = await claimBranchJob(admin, userId, dreamId, versionId, jobOperationKey);
  return { userId, dreamId, versionId, jobId, jobOperationKey, storagePath };
}

async function prepareParent(
  admin: AdminClient,
  userId: string,
  dreamId: string,
  parentId: string,
  storagePaths: string[],
): Promise<void> {
  const parentPath = `${userId}/${dreamId}/${parentId}.png`;
  storagePaths.push(parentPath);
  await uploadArtifact(admin, parentPath);
  const result = await admin.from("scene_versions").update({
    storage_path: parentPath, status: "COMPLETED", is_selected: true,
  }).eq("id", parentId);
  assertNoError(result.error);
}

async function insertDream(admin: AdminClient, userId: string): Promise<string> {
  const result = await admin.from("dreams").insert({
    user_id: userId, input_mode: "text", transcript: "Integration fixture",
    mood: [...FIXTURE_MOOD], status: "READY",
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
  operationKey: string,
): Promise<string> {
  const result = await admin.rpc("claim_generation_job", {
    p_user_id: userId, p_dream_id: dreamId, p_scene_version_id: versionId,
    p_stage: "branch", p_operation_key: operationKey,
    p_model: FIXTURE_MODEL, p_endpoint_id: FIXTURE_ENDPOINT, p_request_hash: REQUEST_HASH,
  });
  assertNoError(result.error);
  return claimSchema.array().min(1).parse(result.data)[0].job_id;
}

export async function uploadArtifact(admin: AdminClient, storagePath: string): Promise<void> {
  const result = await admin.storage.from("dream-images").upload(storagePath, ONE_PIXEL_PNG, {
    contentType: "image/png", upsert: false,
  });
  assertNoError(result.error);
}

export async function cleanup(
  admin: AdminClient,
  userId: string,
  storagePaths: readonly string[],
): Promise<void> {
  const failures: unknown[] = [];
  await captureFailure(removeArtifacts(admin, storagePaths), failures);
  await captureFailure(deleteUser(admin, userId), failures);
  if (failures.length) throw new AggregateError(failures, "Fixture cleanup failed");
}

async function removeArtifacts(admin: AdminClient, paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  const result = await admin.storage.from("dream-images").remove([...paths]);
  assertNoError(result.error);
}

async function deleteUser(admin: AdminClient, userId: string): Promise<void> {
  const result = await admin.auth.admin.deleteUser(userId);
  assertNoError(result.error);
}

async function captureFailure(operation: Promise<void>, failures: unknown[]): Promise<void> {
  try { await operation; } catch (error: unknown) { failures.push(error); }
}

export function branchRpcArgs(userId: string, dreamId: string, parentId: string): BranchRpcArgs {
  return {
    p_user_id: userId, p_dream_id: dreamId, p_parent_version_id: parentId,
    p_instruction: "Turn the fixture moon into a doorway", p_model: FIXTURE_MODEL,
    p_seed: FIXTURE_SEED, p_operation_key: `integration:${crypto.randomUUID()}`,
    p_request_hash: REQUEST_HASH,
  };
}

export function serviceHeaders(env: Env): Readonly<Record<string, string>> {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

export function assertNoError(error: { readonly message: string } | null): void {
  if (error) throw new Error(error.message);
}
