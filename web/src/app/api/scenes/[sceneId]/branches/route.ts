import { z } from "zod";
import { branchRequestHash, branchRequestSchema, branchSeed, KONTEXT_MODEL } from "@/lib/domain/branch";
import { getRunpodEnv } from "@/lib/config/env";
import { createSceneBranch, getOwnedSceneVersion, getSceneVersion } from "@/lib/database/scenes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BranchAccessError, startBranchGeneration } from "@/workflows/start-branch";

interface RouteContext {
  readonly params: Promise<{ sceneId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await handleBranchRequest(request, await context.params);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid scene edit" }, { status: 400 });
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: 401 });
    if (error instanceof BranchAccessError) return branchNotFound();
    return Response.json({ error: "Scene branch could not be started" }, { status: 503 });
  }
}

async function handleBranchRequest(
  request: Request,
  params: { readonly sceneId: string },
): Promise<Response> {
  const sceneId = z.uuid().parse(params.sceneId);
  const input = branchRequestSchema.parse(await request.json() as unknown);
  const client = await createSupabaseServerClient();
  const userId = await requireUserId(client);
  const parent = await getOwnedSceneVersion(client, input.parentVersionId);
  if (!parent || parent.scene_id !== sceneId || !parent.storage_path || parent.status !== "COMPLETED") {
    return branchNotFound();
  }
  const versionId = await claimBranch(userId, input, parent.storage_path);
  const version = await getSceneVersion(versionId);
  if (version.status === "COMPLETED") return Response.json({ versionId, runId: null }, { status: 200 });
  const run = await startBranchGeneration(versionId, userId);
  return Response.json({ versionId, runId: run.runId }, { status: 202 });
}

async function claimBranch(
  userId: string,
  input: z.infer<typeof branchRequestSchema>,
  parentStoragePath: string,
): Promise<string> {
  const seed = branchSeed(input.operationId);
  const provider = { endpointId: getRunpodEnv().kontextEndpointId, parentStoragePath };
  const claim = await createSceneBranch({
    userId, dreamId: input.dreamId, parentVersionId: input.parentVersionId,
    instruction: input.instruction, model: KONTEXT_MODEL, seed,
    operationKey: `branch:${userId}:${input.operationId}`,
    requestHash: branchRequestHash(input, seed, provider),
  });
  return claim.versionId;
}

async function requireUserId(client: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<string> {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw new AuthenticationError();
  return auth.data.user.id;
}

function branchNotFound(): Response {
  return Response.json({ error: "Scene branch not found" }, { status: 404 });
}

class AuthenticationError extends Error {
  public constructor() {
    super("Sign in before changing a scene");
  }
}
