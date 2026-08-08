import { AuthenticationError, requireUserId } from "@/lib/auth/user";
import {
  createIdentityImageUrl,
  getActiveIdentityReference,
  type IdentityReference,
} from "@/lib/database/identity";

export async function GET(): Promise<Response> {
  try {
    const reference = await getActiveIdentityReference(await requireUserId());
    return noStore(Response.json({ identity: await identityPayload(reference) }));
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      return noStore(Response.json({ error: error.message }, { status: 401 }));
    }
    console.error("Dream Self lookup failed", safeError(error));
    return noStore(Response.json({ error: "Your photo could not be loaded" }, { status: 503 }));
  }
}

export async function identityPayload(reference: IdentityReference | null): Promise<unknown> {
  if (!reference?.storage_path) return null;
  return {
    id: reference.id,
    previewUrl: await createIdentityImageUrl(reference.storage_path),
    width: reference.width,
    height: reference.height,
    createdAt: reference.created_at,
  };
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function safeError(error: unknown): Readonly<Record<string, string>> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError" };
}
