import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { audioUploadRequestSchema } from "@/lib/domain/audio";
import { createDreamAudioUpload } from "@/lib/database/storage";
import { prepareAudioDream } from "@/lib/database/dreams";
import { startAudioCleanup } from "@/workflows/start-audio-cleanup";
import {
  DEFAULT_VISUAL_STYLE,
  visualStyleSchema,
} from "@/lib/domain/identity";
import { dreamQuotaResponse } from "@/app/api/dreams/quota";

const requestSchema = audioUploadRequestSchema.extend({
  identityReferenceId: z.uuid().nullable().default(null),
  visualStyle: visualStyleSchema.default(DEFAULT_VISUAL_STYLE),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const input = requestSchema.parse(await request.json() as unknown);
    const client = await createSupabaseServerClient();
    const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) return unauthorized();
    const dreamId = await prepareAudioDream(
      auth.data.user.id,
      input.operationId,
      input.mimeType,
      input.identityReferenceId,
      input.visualStyle,
    );
    await startAudioCleanup(dreamId, auth.data.user.id);
    const upload = await createDreamAudioUpload(auth.data.user.id, dreamId, input.mimeType);
    return Response.json({ dreamId, ...upload }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return Response.json({ error: "Unsupported audio format" }, { status: 400 });
    const quotaResponse = dreamQuotaResponse(error);
    if (quotaResponse) return quotaResponse;
    return Response.json({ error: "Audio capture could not be prepared" }, { status: 503 });
  }
}

function unauthorized(): Response {
  return Response.json({ error: "Sign in before recording a dream" }, { status: 401 });
}
