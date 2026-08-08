"use client";

import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  IDENTITY_CONSENT_VERSION,
  identityMimeTypeSchema,
  MAX_IDENTITY_IMAGE_BYTES,
  type IdentityMimeType,
} from "@/lib/domain/identity";

const uploadSchema = z.object({
  status: z.literal("upload"), identityId: z.uuid(),
  path: z.string().min(1), token: z.string().min(1),
}).strict().or(z.object({
  status: z.enum(["stored", "ready"]), identityId: z.uuid(),
}).strict());
const identitySchema = z.object({
  id: z.uuid(),
  previewUrl: z.url(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  createdAt: z.string().optional(),
}).strict();
const currentSchema = z.object({ identity: identitySchema.nullable() }).strict();

export type DreamSelf = z.infer<typeof identitySchema>;

class DreamSelfError extends Error {}

export async function loadDreamSelf(): Promise<DreamSelf | null> {
  const response = await fetch("/api/identity", { cache: "no-store" });
  if (!response.ok) throw new Error("Dream Self could not be loaded");
  return currentSchema.parse(await response.json() as unknown).identity;
}

export async function uploadDreamSelf(file: File, operationId: string): Promise<DreamSelf> {
  try {
    const mimeType = validateFile(file);
    const upload = await requestUpload(operationId, mimeType, file.size);
    if (upload.status === "upload") {
      const stored = await createSupabaseBrowserClient().storage.from("identity-references")
        .uploadToSignedUrl(upload.path, upload.token, file, { contentType: mimeType });
      if (stored.error) throw new DreamSelfError("Photo upload was interrupted. Try again.");
    }
    const response = await fetch(`/api/identity/${upload.identityId}/complete`, { method: "POST" });
    if (!response.ok) throw new DreamSelfError(await responseError(response, "Photo could not be prepared"));
    const identity = currentSchema.parse(await response.json() as unknown).identity;
    if (!identity) throw new DreamSelfError("Prepared photo was missing");
    return identity;
  } catch (error: unknown) {
    if (error instanceof DreamSelfError) throw error;
    throw new DreamSelfError("Your photo could not be prepared. Try again.");
  }
}

export async function deleteDreamSelf(identityId: string): Promise<void> {
  try {
    const response = await fetch(`/api/identity/${identityId}`, { method: "DELETE" });
    if (!response.ok) throw new DreamSelfError(await responseError(response, "Photo could not be removed"));
  } catch (error: unknown) {
    if (error instanceof DreamSelfError) throw error;
    throw new DreamSelfError("Your photo could not be removed. Try again.");
  }
}

function validateFile(file: File): IdentityMimeType {
  const mimeType = identityMimeTypeSchema.safeParse(file.type);
  if (!mimeType.success) throw new DreamSelfError("Choose a JPEG, PNG, or WebP photo");
  if (file.size < 1 || file.size > MAX_IDENTITY_IMAGE_BYTES) {
    throw new DreamSelfError("Choose a photo under 8 MB");
  }
  return mimeType.data;
}

async function requestUpload(
  operationId: string,
  mimeType: IdentityMimeType,
  sizeBytes: number,
): Promise<z.infer<typeof uploadSchema>> {
  const response = await fetch("/api/identity/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationId,
      mimeType,
      sizeBytes,
      consentConfirmed: true,
      consentVersion: IDENTITY_CONSENT_VERSION,
    }),
  });
  if (!response.ok) throw new DreamSelfError(await responseError(response, "Photo upload could not start"));
  return uploadSchema.parse(await response.json() as unknown);
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = z.object({ error: z.string() }).safeParse(await response.json() as unknown);
    return payload.success ? payload.data.error : fallback;
  } catch {
    return fallback;
  }
}
