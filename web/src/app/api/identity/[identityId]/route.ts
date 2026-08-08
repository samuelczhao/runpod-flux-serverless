import { z } from "zod";
import { AuthenticationError, requireUserId } from "@/lib/auth/user";
import {
  beginIdentityDeletion,
  completeIdentityDeletion,
  deleteIdentityObjects,
} from "@/lib/database/identity";
import { DatabaseOperationError } from "@/lib/database/errors";

interface RouteContext {
  readonly params: Promise<{ identityId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const identityId = z.uuid().parse((await context.params).identityId);
    const userId = await requireUserId();
    const paths = await beginIdentityDeletion(userId, identityId);
    await deleteIdentityObjects(paths);
    await completeIdentityDeletion(userId, identityId);
    return new Response(null, { status: 204 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return errorResponse("Invalid photo reference", 400);
    if (error instanceof AuthenticationError) return errorResponse(error.message, 401);
    if (error instanceof DatabaseOperationError && error.code === "55006") {
      return errorResponse("This photo is still being used to create a story. Try again when it finishes.", 409);
    }
    console.error("Dream Self deletion failed", safeError(error));
    return errorResponse("Your photo could not be removed", 503);
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
