import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readDreamStory } from "@/lib/database/story";

interface RouteContext {
  readonly params: Promise<{ dreamId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const dreamId = z.uuid().safeParse((await context.params).dreamId);
  if (!dreamId.success) return Response.json({ error: "Invalid dream ID" }, { status: 400 });
  const client = await createSupabaseServerClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const story = await readDreamStory(client, dreamId.data);
  if (!story) return Response.json({ error: "Dream not found" }, { status: 404 });
  return Response.json(story);
}
