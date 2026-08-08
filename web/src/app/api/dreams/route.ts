import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prepareTextDream } from "@/lib/database/dreams";
import { DreamAccessError, startDreamGeneration } from "@/workflows/start";

const createDreamSchema = z.object({
  operationId: z.uuid(),
  transcript: z.string().trim().min(10).max(12_000),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const input = createDreamSchema.parse(await request.json() as unknown);
    const client = await createSupabaseServerClient();
    const user = await requireUser(client);
    const dreamId = await prepareTextDream(user.id, input.operationId, input.transcript);
    const run = await startDreamGeneration(dreamId, user.id);
    return Response.json({ dreamId, runId: run.runId }, { status: 202 });
  } catch (error: unknown) {
    return createErrorResponse(error);
  }
}

async function requireUser(client: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const result = await client.auth.getUser();
  if (result.error || !result.data.user) throw new AuthenticationError();
  return result.data.user;
}

function createErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return Response.json({ error: "Invalid dream text" }, { status: 400 });
  if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof DreamAccessError) return Response.json({ error: error.message }, { status: 404 });
  console.error("Dream generation start failed", safeError(error));
  return Response.json({ error: "Dream generation could not be started" }, { status: 503 });
}

function safeError(error: unknown): Readonly<Record<string, string>> {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" };
}

class AuthenticationError extends Error {
  public constructor() {
    super("Sign in before creating a dream");
    this.name = "AuthenticationError";
  }
}
