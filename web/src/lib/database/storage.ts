import "server-only";
import { z } from "zod";
import type { FetchLike } from "@/lib/runpod/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { throwIfDatabaseError } from "@/lib/database/errors";
import { uuidSchema } from "@/lib/database/schemas";

const IMAGE_BUCKET = "dream-images";
const AUDIO_BUCKET = "dream-audio";
const MAX_IMAGE_BYTES = 10_000_000;
const MAX_PROVIDER_REDIRECTS = 3;
const SIGNED_URL_SECONDS = 600;
const AUDIO_SIGNED_URL_SECONDS = 3_600;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PROVIDER_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const uploadSchema = z.object({ path: z.string().min(1) }).passthrough();
const signedUrlSchema = z.object({ signedUrl: z.url() }).passthrough();
const signedUploadSchema = z.object({ path: z.string().min(1), token: z.string().min(1) }).passthrough();

export type DreamAudioMimeType = "audio/webm" | "audio/mp4" | "audio/ogg";

export interface DreamAudioUpload {
  readonly path: string;
  readonly token: string;
}

export class ProviderArtifactError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProviderArtifactError";
  }
}

export async function createDreamAudioUpload(
  userId: string,
  dreamId: string,
  mimeType: DreamAudioMimeType,
): Promise<DreamAudioUpload> {
  const path = audioPath(userId, dreamId, mimeType);
  const result = await createSupabaseAdminClient().storage.from(AUDIO_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  throwIfDatabaseError(result.error);
  const upload = signedUploadSchema.parse(result.data);
  return { path: upload.path, token: upload.token };
}

export async function createDreamAudioUrl(path: string): Promise<string> {
  const result = await createSupabaseAdminClient().storage.from(AUDIO_BUCKET)
    .createSignedUrl(path, AUDIO_SIGNED_URL_SECONDS);
  throwIfDatabaseError(result.error);
  return signedUrlSchema.parse(result.data).signedUrl;
}

export async function deleteDreamAudio(dreamId: string, path: string): Promise<void> {
  const client = createSupabaseAdminClient();
  const prepared = await client.rpc("prepare_audio_deletion", { p_dream_id: dreamId });
  throwIfDatabaseError(prepared.error);
  if (prepared.data === null) return;
  if (prepared.data !== path) throw new Error("Audio deletion path changed");
  const removal = await client.storage.from(AUDIO_BUCKET).remove([prepared.data]);
  throwIfDatabaseError(removal.error);
  const update = await client.rpc("mark_audio_deleted", {
    p_dream_id: dreamId, p_storage_path: prepared.data,
  });
  throwIfDatabaseError(update.error);
}

export async function deleteExpiredDraftAudio(dreamId: string, userId: string): Promise<boolean> {
  const client = createSupabaseAdminClient();
  const prepared = await client.rpc("prepare_expired_audio_draft_cleanup", {
    p_dream_id: dreamId, p_user_id: userId,
  });
  throwIfDatabaseError(prepared.error);
  if (prepared.data === null) return false;
  const path = z.string().min(1).parse(prepared.data);
  const removal = await client.storage.from(AUDIO_BUCKET).remove([path]);
  throwIfDatabaseError(removal.error);
  const completed = await client.rpc("complete_expired_audio_draft_cleanup", {
    p_dream_id: dreamId, p_user_id: userId, p_storage_path: path,
  });
  throwIfDatabaseError(completed.error);
  return true;
}

export async function storeDreamPng(
  userId: string,
  dreamId: string,
  versionId: string,
  bytes: Buffer,
): Promise<string> {
  validatePng(bytes);
  const path = imagePath(userId, dreamId, versionId);
  const result = await createSupabaseAdminClient().storage.from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  throwIfDatabaseError(result.error);
  return uploadSchema.parse(result.data).path;
}

export async function createDreamImageUrl(path: string): Promise<string> {
  const result = await createSupabaseAdminClient().storage.from(IMAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  throwIfDatabaseError(result.error);
  return signedUrlSchema.parse(result.data).signedUrl;
}

export async function downloadProviderPng(url: string, fetcher: FetchLike = fetch): Promise<Buffer> {
  const response = await fetchProviderArtifact(url, fetcher);
  if (!response.ok) throw downloadError(response.status);
  rejectOversizedHeader(response.headers.get("content-length"));
  const bytes = await readBoundedBody(response);
  validatePng(bytes);
  return bytes;
}

async function fetchProviderArtifact(url: string, fetcher: FetchLike): Promise<Response> {
  let current = requireProviderArtifactUrl(url);
  for (let redirect = 0; redirect <= MAX_PROVIDER_REDIRECTS; redirect += 1) {
    const response = await fetcher(current, { redirect: "manual" });
    if (!PROVIDER_REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new ProviderArtifactError("Provider image redirect has no destination");
    if (redirect === MAX_PROVIDER_REDIRECTS) {
      throw new ProviderArtifactError("Provider image exceeded the redirect limit");
    }
    current = requireProviderArtifactUrl(new URL(location, current).toString());
  }
  throw new ProviderArtifactError("Provider image redirect failed");
}

function downloadError(status: number): Error {
  const message = `Provider image download failed with HTTP ${status}`;
  const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return permanent ? new ProviderArtifactError(message) : new Error(message);
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new ProviderArtifactError("Provider image response was empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) return Buffer.concat(chunks, byteCount);
    byteCount += result.value.byteLength;
    if (byteCount > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderArtifactError("PNG exceeds the size limit");
    }
    chunks.push(result.value);
  }
}

function imagePath(userId: string, dreamId: string, versionId: string): string {
  return `${uuidSchema.parse(userId)}/${uuidSchema.parse(dreamId)}/${uuidSchema.parse(versionId)}.png`;
}

function audioPath(userId: string, dreamId: string, mimeType: DreamAudioMimeType): string {
  const extension = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg" }[mimeType];
  return `${uuidSchema.parse(userId)}/${uuidSchema.parse(dreamId)}/source.${extension}`;
}

function requireProviderArtifactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderArtifactError("Provider image URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === "image.runpod.ai" || host.endsWith(".cloudfront.net");
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed) {
    throw new ProviderArtifactError("Provider image URL is not an approved artifact host");
  }
  return url.toString();
}

function rejectOversizedHeader(value: string | null): void {
  if (value && Number(value) > MAX_IMAGE_BYTES) {
    throw new ProviderArtifactError("Provider image exceeds the size limit");
  }
}

function validatePng(bytes: Buffer): void {
  if (bytes.length > MAX_IMAGE_BYTES) throw new ProviderArtifactError("PNG exceeds the size limit");
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ProviderArtifactError("Image payload is not a PNG");
  }
}
