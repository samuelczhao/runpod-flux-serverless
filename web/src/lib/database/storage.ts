import "server-only";
import { z } from "zod";
import type { FetchLike } from "@/lib/runpod/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { throwIfDatabaseError } from "@/lib/database/errors";
import { uuidSchema } from "@/lib/database/schemas";

const IMAGE_BUCKET = "dream-images";
const MAX_IMAGE_BYTES = 10_000_000;
const SIGNED_URL_SECONDS = 600;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const uploadSchema = z.object({ path: z.string().min(1) }).passthrough();
const signedUrlSchema = z.object({ signedUrl: z.url() }).passthrough();

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
  const response = await fetcher(requireHttps(url));
  if (!response.ok) throw new Error(`Provider image download failed with HTTP ${response.status}`);
  rejectOversizedHeader(response.headers.get("content-length"));
  const bytes = Buffer.from(await response.arrayBuffer());
  validatePng(bytes);
  return bytes;
}

function imagePath(userId: string, dreamId: string, versionId: string): string {
  return `${uuidSchema.parse(userId)}/${uuidSchema.parse(dreamId)}/${uuidSchema.parse(versionId)}.png`;
}

function requireHttps(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Provider image URL must use HTTPS");
  return url.toString();
}

function rejectOversizedHeader(value: string | null): void {
  if (value && Number(value) > MAX_IMAGE_BYTES) throw new Error("Provider image exceeds the size limit");
}

function validatePng(bytes: Buffer): void {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("PNG exceeds the size limit");
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Image payload is not a PNG");
  }
}
