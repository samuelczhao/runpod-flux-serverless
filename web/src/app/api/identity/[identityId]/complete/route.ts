import { z } from "zod";
import { AuthenticationError, requireUserId } from "@/lib/auth/user";
import {
  beginIdentityDeletion,
  completeIdentityDeletion,
  completeIdentityReference,
  createIdentityImageUrl,
  deleteIdentityObjects,
  downloadIdentitySource,
  getIdentityReference,
  markIdentitySourceDeleted,
  storeNormalizedIdentity,
  type IdentityReference,
} from "@/lib/database/identity";
import { DatabaseOperationError } from "@/lib/database/errors";
import {
  IdentityImageError,
  normalizeIdentityImage,
} from "@/lib/images/normalizeIdentity";

interface RouteContext {
  readonly params: Promise<{ identityId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  let identityId: string | null = null;
  let userId: string | null = null;
  try {
    identityId = z.uuid().parse((await context.params).identityId);
    userId = await requireUserId();
    const reference = await requireReference(userId, identityId);
    if (reference.status === "READY") return completeReplay(reference);
    if (reference.status !== "PENDING" || !reference.upload_path) {
      return Response.json({ error: "This photo upload is no longer active" }, { status: 409 });
    }
    const normalized = await normalizeIdentityImage(
      await downloadIdentitySource(reference.upload_path),
      reference.source_mime_type,
    );
    const path = await storeNormalizedIdentity(userId, identityId, normalized);
    try {
      await completeIdentityReference(userId, identityId, path, normalized);
    } catch (error: unknown) {
      const reconciliation = await reconcileCompletion(userId, identityId, path, normalized);
      if (reconciliation === "rejected") await deleteIdentityObjects([path]);
      if (reconciliation !== "committed") throw error;
    }
    await deleteSource(userId, identityId, reference.upload_path);
    return previewResponse(identityId, path);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return errorResponse("Invalid photo reference", 400);
    if (error instanceof AuthenticationError) return errorResponse(error.message, 401);
    if (error instanceof IdentityImageError) {
      await discardInvalidReference(userId, identityId);
      return errorResponse("Use a clear JPEG, PNG, or WebP photo under 8 MB", 400);
    }
    if (error instanceof DatabaseOperationError && error.code === "P0002") {
      return errorResponse("The uploaded photo was not found", 404);
    }
    console.error("Dream Self completion failed", safeError(error));
    return errorResponse("Your photo could not be prepared", 503);
  }
}

async function reconcileCompletion(
  userId: string,
  identityId: string,
  path: string,
  image: Awaited<ReturnType<typeof normalizeIdentityImage>>,
): Promise<"committed" | "rejected" | "unknown"> {
  let reference: IdentityReference | null;
  try {
    reference = await getIdentityReference(userId, identityId);
  } catch {
    return "unknown";
  }
  if (!reference) return "rejected";
  return completionMatches(reference, path, image) ? "committed" : "rejected";
}

function completionMatches(
  reference: IdentityReference,
  path: string,
  image: Awaited<ReturnType<typeof normalizeIdentityImage>>,
): boolean {
  return reference.status === "READY" && reference.storage_path === path
    && reference.size_bytes === image.bytes.length && reference.width === image.width
    && reference.height === image.height && reference.content_sha256 === image.sha256;
}

async function requireReference(userId: string, identityId: string): Promise<IdentityReference> {
  const reference = await getIdentityReference(userId, identityId);
  if (!reference) throw new DatabaseOperationError({ code: "P0002", message: "identity_not_found" });
  return reference;
}

async function completeReplay(reference: IdentityReference): Promise<Response> {
  if (!reference.storage_path) throw new Error("Ready Dream Self is missing its image");
  if (reference.upload_path) {
    await deleteSource(reference.user_id, reference.id, reference.upload_path);
  }
  return previewResponse(reference.id, reference.storage_path);
}

async function deleteSource(userId: string, identityId: string, path: string): Promise<void> {
  await deleteIdentityObjects([path]);
  await markIdentitySourceDeleted(userId, identityId, path);
}

async function previewResponse(identityId: string, path: string): Promise<Response> {
  return Response.json({ identity: {
    id: identityId,
    previewUrl: await createIdentityImageUrl(path),
  } });
}

async function discardInvalidReference(userId: string | null, identityId: string | null): Promise<void> {
  if (!userId || !identityId) return;
  try {
    const paths = await beginIdentityDeletion(userId, identityId);
    await deleteIdentityObjects(paths);
    await completeIdentityDeletion(userId, identityId);
  } catch (error: unknown) {
    console.error("Invalid Dream Self cleanup failed", safeError(error));
  }
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function safeError(error: unknown): Readonly<Record<string, string>> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError" };
}
