import { z } from "zod";
import { completeAudioUpload, getProcessingDream } from "@/lib/database/dreams";
import { DatabaseOperationError } from "@/lib/database/errors";
import { audioMimeTypeSchema, MAX_AUDIO_BYTES } from "@/lib/domain/audio";
import type { DreamStatus } from "@/lib/domain/dream";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DreamAccessError, startDreamTranscription } from "@/workflows/start";

const requestSchema = z.object({
  path: z.string().min(1).max(300),
  mimeType: audioMimeTypeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_AUDIO_BYTES),
}).strict();

interface RouteContext {
  readonly params: Promise<{ dreamId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const dreamId = z.uuid().parse((await context.params).dreamId);
    const input = requestSchema.parse(await request.json() as unknown);
    const userId = await requireUserId();
    await completeAudioUpload(dreamId, userId, input.path, input.mimeType, input.sizeBytes);
    const runId = await startTranscriptionIfNeeded(dreamId, userId);
    return Response.json({ dreamId, runId }, { status: 202 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid audio upload" }, { status: 400 });
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
    if (error instanceof DreamAccessError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof DatabaseOperationError && error.code === "P0002") {
      return Response.json({ error: "Uploaded audio was not found" }, { status: 404 });
    }
    return Response.json({ error: "Transcription could not be started" }, { status: 503 });
  }
}

async function startTranscriptionIfNeeded(dreamId: string, userId: string): Promise<string | null> {
  const dream = await getProcessingDream(dreamId);
  if (!shouldStartTranscription(dream.status)) return null;
  try {
    return (await startDreamTranscription(dreamId, userId)).runId;
  } catch (error: unknown) {
    if (!(error instanceof DatabaseOperationError) || error.code !== "23514") throw error;
    const latest = await getProcessingDream(dreamId);
    if (!shouldStartTranscription(latest.status)) return null;
    throw error;
  }
}

export function shouldStartTranscription(status: DreamStatus): boolean {
  return status === "UPLOADED" || status === "TRANSCRIBING";
}

async function requireUserId(): Promise<string> {
  const client = await createSupabaseServerClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw new AuthenticationError();
  return auth.data.user.id;
}

class AuthenticationError extends Error {
  public constructor() {
    super("Sign in before uploading audio");
  }
}
