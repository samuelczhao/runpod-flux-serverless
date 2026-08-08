import { z } from "zod";
import { AuthenticationError, requireUserId } from "@/lib/auth/user";
import {
  IdentityPreparationError,
  prepareIdentityUpload,
} from "@/lib/database/identity";
import {
  IDENTITY_CONSENT_VERSION,
  identityMimeTypeSchema,
  MAX_IDENTITY_IMAGE_BYTES,
} from "@/lib/domain/identity";

const requestSchema = z.object({
  operationId: z.uuid(),
  mimeType: identityMimeTypeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_IDENTITY_IMAGE_BYTES),
  consentConfirmed: z.literal(true),
  consentVersion: z.literal(IDENTITY_CONSENT_VERSION),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const input = requestSchema.parse(await request.json() as unknown);
    const upload = await prepareIdentityUpload(
      await requireUserId(),
      input.operationId,
      input.mimeType,
      input.consentConfirmed,
    );
    return Response.json(upload, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return errorResponse("Choose a JPEG, PNG, or WebP under 8 MB", 400);
    if (error instanceof AuthenticationError) return errorResponse(error.message, 401);
    if (error instanceof IdentityPreparationError) return errorResponse(error.message, 409);
    console.error("Dream Self upload preparation failed", safeError(error));
    return errorResponse("Your photo upload could not be prepared", 503);
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
