import "server-only";
import { StorageApiError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  IDENTITY_CONSENT_VERSION,
  identityMimeTypeSchema,
  identityStatusSchema,
  MAX_IDENTITY_IMAGE_BYTES,
  type IdentityMimeType,
} from "@/lib/domain/identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  parseDatabaseRow,
  parseDatabaseRows,
  throwIfDatabaseError,
} from "@/lib/database/errors";
import { uuidSchema } from "@/lib/database/schemas";
import type { NormalizedIdentityImage } from "@/lib/images/normalizeIdentity";

const IDENTITY_BUCKET = "identity-references";
const IDENTITY_PREVIEW_URL_SECONDS = 3_600;
const IDENTITY_PROVIDER_URL_SECONDS = 900;
const IDENTITY_CLEANUP_BATCH_SIZE = 10;
const MISSING_OBJECT_STATUSES = new Set([400, 404]);
const signedUploadSchema = z.object({
  path: z.string().min(1),
  token: z.string().min(1),
}).passthrough();
const signedUrlSchema = z.object({ signedUrl: z.url() }).passthrough();
const preparationSchema = z.object({
  reference_id: uuidSchema,
  reference_status: identityStatusSchema,
  source_path: z.string().min(1).nullable(),
}).strict();
const deletionSchema = z.object({
  source_path: z.string().nullable(),
  reference_path: z.string().nullable(),
}).strict();
const cleanupCandidateSchema = z.object({
  reference_id: uuidSchema,
  user_id: uuidSchema,
  cleanup_kind: z.enum(["source", "reference", "tombstone"]),
}).strict();
const cleanupHealthSchema = z.object({
  due_count: z.coerce.number().int().nonnegative(),
  oldest_due_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const identityReferenceSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  status: identityStatusSchema,
  source_mime_type: identityMimeTypeSchema,
  upload_path: z.string().nullable(),
  storage_path: z.string().nullable(),
  size_bytes: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  content_sha256: z.string().length(64).nullable(),
  is_active: z.boolean(),
  upload_expires_at: z.iso.datetime({ offset: true }).nullable(),
  ready_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
}).strict();

export type IdentityReference = z.infer<typeof identityReferenceSchema>;

export interface IdentityUpload {
  readonly status: "upload";
  readonly identityId: string;
  readonly path: string;
  readonly token: string;
}

export interface ExistingIdentityUpload {
  readonly status: "stored" | "ready";
  readonly identityId: string;
}

export type IdentityUploadPreparation = IdentityUpload | ExistingIdentityUpload;

export async function prepareIdentityUpload(
  userId: string,
  operationId: string,
  mimeType: IdentityMimeType,
  consentConfirmed: true,
): Promise<IdentityUploadPreparation> {
  const client = createSupabaseAdminClient();
  const prepared = await client.rpc("prepare_identity_reference", {
    p_user_id: userId,
    p_operation_key: operationId,
    p_mime_type: mimeType,
    p_consent_confirmed: consentConfirmed,
    p_consent_version: IDENTITY_CONSENT_VERSION,
  });
  throwIfDatabaseError(prepared.error);
  const row = parseDatabaseRows(preparationSchema, prepared.data)[0];
  if (!row) throw new IdentityPreparationError("Photo upload could not be prepared");
  if (row.reference_status === "READY") {
    return { status: "ready", identityId: row.reference_id };
  }
  if (!row.source_path) throw new IdentityPreparationError("Photo upload source is missing");
  const existing = await client.storage.from(IDENTITY_BUCKET).exists(row.source_path);
  if (existing.data) return { status: "stored", identityId: row.reference_id };
  if (existing.error && !isMissingObjectError(existing.error)) {
    throwIfDatabaseError(existing.error);
  }
  const signed = await client.storage.from(IDENTITY_BUCKET)
    .createSignedUploadUrl(row.source_path, { upsert: false });
  throwIfDatabaseError(signed.error);
  const upload = signedUploadSchema.parse(signed.data);
  return {
    status: "upload",
    identityId: row.reference_id,
    path: upload.path,
    token: upload.token,
  };
}

export async function getActiveIdentityReference(userId: string): Promise<IdentityReference | null> {
  const result = await createSupabaseAdminClient().from("identity_references")
    .select(IDENTITY_FIELDS).eq("user_id", userId).eq("status", "READY")
    .eq("is_active", true).gt("retention_expires_at", new Date().toISOString()).maybeSingle();
  throwIfDatabaseError(result.error);
  return result.data === null ? null : parseDatabaseRow(identityReferenceSchema, result.data);
}

export async function getIdentityReference(
  userId: string,
  identityId: string,
): Promise<IdentityReference | null> {
  const result = await createSupabaseAdminClient().from("identity_references")
    .select(IDENTITY_FIELDS).eq("id", identityId).eq("user_id", userId).maybeSingle();
  throwIfDatabaseError(result.error);
  return result.data === null ? null : parseDatabaseRow(identityReferenceSchema, result.data);
}

export async function downloadIdentitySource(path: string): Promise<Buffer> {
  const result = await createSupabaseAdminClient().storage.from(IDENTITY_BUCKET).download(path);
  throwIfDatabaseError(result.error);
  if (!result.data || result.data.size === 0 || result.data.size > MAX_IDENTITY_IMAGE_BYTES) {
    throw new IdentityPreparationError("Uploaded photo is empty or exceeds 8 MB");
  }
  return Buffer.from(await result.data.arrayBuffer());
}

export async function storeNormalizedIdentity(
  userId: string,
  identityId: string,
  image: NormalizedIdentityImage,
): Promise<string> {
  const path = identityPath(userId, identityId);
  const bucket = createSupabaseAdminClient().storage.from(IDENTITY_BUCKET);
  const result = await bucket.upload(path, image.bytes, {
    contentType: "image/png", upsert: false,
  });
  if (result.error) {
    const existing = await bucket.download(path);
    if (!existing.error && existing.data) {
      const bytes = Buffer.from(await existing.data.arrayBuffer());
      if (bytes.equals(image.bytes)) return path;
    }
    throwIfDatabaseError(result.error);
  }
  return z.object({ path: z.string().min(1) }).passthrough().parse(result.data).path;
}

export async function completeIdentityReference(
  userId: string,
  identityId: string,
  claimToken: string,
  path: string,
  image: NormalizedIdentityImage,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_identity_reference", {
    p_reference_id: identityId,
    p_user_id: userId,
    p_claim_token: claimToken,
    p_storage_path: path,
    p_size_bytes: image.bytes.length,
    p_width: image.width,
    p_height: image.height,
    p_content_sha256: image.sha256,
  });
  throwIfDatabaseError(result.error);
}

export async function claimIdentityNormalization(
  userId: string,
  identityId: string,
  claimToken: string,
): Promise<boolean> {
  const result = await createSupabaseAdminClient().rpc("claim_identity_normalization", {
    p_reference_id: identityId,
    p_user_id: userId,
    p_claim_token: claimToken,
  });
  throwIfDatabaseError(result.error);
  return z.boolean().parse(result.data);
}

export async function releaseIdentityNormalization(
  userId: string,
  identityId: string,
  claimToken: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("release_identity_normalization", {
    p_reference_id: identityId,
    p_user_id: userId,
    p_claim_token: claimToken,
  });
  throwIfDatabaseError(result.error);
}

export async function createIdentityImageUrl(path: string): Promise<string> {
  const result = await createSupabaseAdminClient().storage.from(IDENTITY_BUCKET)
    .createSignedUrl(path, IDENTITY_PREVIEW_URL_SECONDS);
  throwIfDatabaseError(result.error);
  return signedUrlSchema.parse(result.data).signedUrl;
}

export async function createIdentityProviderUrl(path: string): Promise<string> {
  const result = await createSupabaseAdminClient().storage.from(IDENTITY_BUCKET)
    .createSignedUrl(path, IDENTITY_PROVIDER_URL_SECONDS);
  throwIfDatabaseError(result.error);
  return signedUrlSchema.parse(result.data).signedUrl;
}

export async function beginIdentityDeletion(
  userId: string,
  identityId: string,
): Promise<readonly string[]> {
  const result = await createSupabaseAdminClient().rpc("begin_identity_deletion", {
    p_reference_id: identityId,
    p_user_id: userId,
  });
  throwIfDatabaseError(result.error);
  const row = parseDatabaseRows(deletionSchema, result.data)[0];
  if (!row) return [];
  return [...new Set([
    row.source_path,
    row.reference_path,
    identityPath(userId, identityId),
  ].filter(isString))];
}

export async function deleteIdentityObjects(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const result = await createSupabaseAdminClient().storage.from(IDENTITY_BUCKET).remove([...paths]);
  throwIfDatabaseError(result.error);
}

export async function completeIdentityDeletion(userId: string, identityId: string): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_identity_deletion", {
    p_reference_id: identityId,
    p_user_id: userId,
  });
  throwIfDatabaseError(result.error);
}

export async function completeIdentityTombstoneCleanup(
  userId: string,
  identityId: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("complete_identity_tombstone_cleanup", {
    p_reference_id: identityId,
    p_user_id: userId,
  });
  throwIfDatabaseError(result.error);
}

export async function markIdentitySourceDeleted(
  userId: string,
  identityId: string,
  sourcePath: string,
): Promise<void> {
  const result = await createSupabaseAdminClient().rpc("mark_identity_source_deleted", {
    p_reference_id: identityId,
    p_user_id: userId,
    p_source_path: sourcePath,
  });
  throwIfDatabaseError(result.error);
}

export async function cleanupIdentityCandidates(limit: number): Promise<{
  readonly inspected: number;
  readonly failed: number;
  readonly remaining: number;
  readonly oldestDueAt: string | null;
}> {
  const client = createSupabaseAdminClient();
  const result = await client.rpc("get_identity_cleanup_candidates", {
    p_limit: z.number().int().min(1).max(250).parse(limit),
  });
  throwIfDatabaseError(result.error);
  const candidates = parseDatabaseRows(cleanupCandidateSchema, result.data);
  const failed = await cleanupIdentityBatches(candidates);
  const health = await client.rpc("get_identity_cleanup_health");
  throwIfDatabaseError(health.error);
  const snapshot = parseDatabaseRows(cleanupHealthSchema, health.data)[0];
  if (!snapshot) throw new IdentityPreparationError("Photo cleanup health is unavailable");
  return {
    inspected: candidates.length,
    failed,
    remaining: snapshot.due_count,
    oldestDueAt: snapshot.oldest_due_at,
  };
}

async function cleanupIdentityBatches(
  candidates: readonly z.infer<typeof cleanupCandidateSchema>[],
): Promise<number> {
  let failed = 0;
  for (let index = 0; index < candidates.length; index += IDENTITY_CLEANUP_BATCH_SIZE) {
    const batch = candidates.slice(index, index + IDENTITY_CLEANUP_BATCH_SIZE);
    const outcomes = await Promise.allSettled(batch.map(cleanupIdentityCandidate));
    failed += outcomes.filter((outcome) => outcome.status === "rejected").length;
  }
  return failed;
}

async function cleanupIdentityCandidate(
  candidate: z.infer<typeof cleanupCandidateSchema>,
): Promise<void> {
  if (candidate.cleanup_kind === "tombstone") {
    await deleteIdentityObjects([identityPath(candidate.user_id, candidate.reference_id)]);
    await completeIdentityTombstoneCleanup(candidate.user_id, candidate.reference_id);
    return;
  }
  if (candidate.cleanup_kind === "reference") {
    const paths = await beginIdentityDeletion(candidate.user_id, candidate.reference_id);
    await deleteIdentityObjects(paths);
    await completeIdentityDeletion(candidate.user_id, candidate.reference_id);
    return;
  }
  const reference = await getIdentityReference(candidate.user_id, candidate.reference_id);
  if (!reference?.upload_path) return;
  await deleteIdentityObjects([reference.upload_path]);
  await markIdentitySourceDeleted(candidate.user_id, candidate.reference_id, reference.upload_path);
}

function identityPath(userId: string, identityId: string): string {
  return `${uuidSchema.parse(userId)}/identity/${uuidSchema.parse(identityId)}/reference.png`;
}

function isString(value: string | null): value is string {
  return value !== null;
}

function isMissingObjectError(error: unknown): boolean {
  return error instanceof StorageApiError && MISSING_OBJECT_STATUSES.has(error.status);
}

export class IdentityPreparationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IdentityPreparationError";
  }
}

const IDENTITY_FIELDS = "id,user_id,status,source_mime_type,upload_path,storage_path,size_bytes,"
  + "width,height,content_sha256,is_active,upload_expires_at,ready_at,created_at";
