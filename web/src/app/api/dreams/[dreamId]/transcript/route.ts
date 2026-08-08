import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DreamAccessError, startAudioGeneration } from "@/workflows/start";

const requestSchema = z.object({ transcript: z.string().trim().min(10).max(12_000) }).strict();

interface RouteContext {
  readonly params: Promise<{ dreamId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const dreamId = z.uuid().parse((await context.params).dreamId);
    const input = requestSchema.parse(await request.json() as unknown);
    const userId = await requireUserId();
    const run = await startAudioGeneration(dreamId, userId, input.transcript);
    return Response.json({ dreamId, runId: run.runId }, { status: 202 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid transcript" }, { status: 400 });
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
    if (error instanceof DreamAccessError) return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ error: "Dream generation could not be started" }, { status: 503 });
  }
}

async function requireUserId(): Promise<string> {
  const client = await createSupabaseServerClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw new AuthenticationError();
  return auth.data.user.id;
}

class AuthenticationError extends Error {
  public constructor() {
    super("Sign in before confirming a transcript");
  }
}
