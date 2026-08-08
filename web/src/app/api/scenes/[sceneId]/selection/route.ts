import { z } from "zod";
import { selectSceneVersion } from "@/lib/database/scenes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  expectedVersionId: z.uuid(),
  nextVersionId: z.uuid(),
}).strict();

interface RouteContext {
  readonly params: Promise<{ sceneId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const sceneId = z.uuid().parse((await context.params).sceneId);
    const input = requestSchema.parse(await request.json() as unknown);
    const userId = await requireUserId();
    await selectSceneVersion(userId, sceneId, input.expectedVersionId, input.nextVersionId);
    return Response.json({ selectedVersionId: input.nextVersionId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid scene selection" }, { status: 400 });
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
    return Response.json({ error: "Scene selection changed; refresh and try again" }, { status: 409 });
  }
}

async function requireUserId(): Promise<string> {
  const auth = await (await createSupabaseServerClient()).auth.getUser();
  if (auth.error || !auth.data.user) throw new AuthenticationError();
  return auth.data.user.id;
}

class AuthenticationError extends Error {
  public constructor() {
    super("Sign in before choosing a scene");
  }
}
