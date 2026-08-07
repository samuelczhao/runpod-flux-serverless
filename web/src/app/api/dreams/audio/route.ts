import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { throwIfDatabaseError } from "@/lib/database/errors";
import { audioMimeTypeSchema } from "@/lib/domain/audio";
import { createDreamAudioUpload } from "@/lib/database/storage";

const requestSchema = z.object({ mimeType: audioMimeTypeSchema }).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const input = requestSchema.parse(await request.json() as unknown);
    const client = await createSupabaseServerClient();
    const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) return unauthorized();
    const dreamId = await insertAudioDream(client, auth.data.user.id);
    const upload = await createDreamAudioUpload(auth.data.user.id, dreamId, input.mimeType);
    return Response.json({ dreamId, ...upload }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return Response.json({ error: "Unsupported audio format" }, { status: 400 });
    return Response.json({ error: "Audio capture could not be prepared" }, { status: 503 });
  }
}

async function insertAudioDream(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<string> {
  const result = await client.from("dreams").insert({
    user_id: userId, input_mode: "audio", transcript: null,
  }).select("id").single();
  throwIfDatabaseError(result.error);
  return z.object({ id: z.uuid() }).parse(result.data).id;
}

function unauthorized(): Response {
  return Response.json({ error: "Sign in before recording a dream" }, { status: 401 });
}
