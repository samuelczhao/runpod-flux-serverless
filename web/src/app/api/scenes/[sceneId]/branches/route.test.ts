import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/scenes/[sceneId]/branches/route";
import { DatabaseOperationError } from "@/lib/database/errors";

const mocks = vi.hoisted(() => ({
  createBranch: vi.fn(), getOwned: vi.fn(), getVersion: vi.fn(), getUser: vi.fn(), start: vi.fn(),
}));
const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";
const DREAM_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const SCENE_ID = "5deefbe0-2003-4af4-b75e-0bd9c22bed60";
const VERSION_ID = "2d318f63-c0c2-4ed6-a33c-e7fcd51f08c8";
const OPERATION_ID = "ff5f82ba-3c73-4b3d-bd85-39004f7a645f";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  getRunpodEnv: () => ({ kontextEndpointId: "endpoint-1" }),
}));
vi.mock("@/lib/database/scenes", () => ({
  createSceneBranch: mocks.createBranch,
  getOwnedSceneVersion: mocks.getOwned,
  getSceneVersion: mocks.getVersion,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/workflows/start-branch", () => ({
  BranchAccessError: class BranchAccessError extends Error {},
  startBranchGeneration: mocks.start,
}));

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.getOwned.mockResolvedValue({
    id: VERSION_ID, scene_id: SCENE_ID, storage_path: "user/dream/original.png", status: "COMPLETED",
  });
});

it.each([
  ["P4293", "today’s demo limit"],
  ["P4294", "hourly scene-edit limit"],
])("returns 429 for branch quota code %s without starting work", async (code, message) => {
  mocks.createBranch.mockRejectedValue(new DatabaseOperationError({ code, message: "quota" }));
  const response = await POST(createRequest(), context());
  expect(response.status).toBe(429);
  await expect(response.json()).resolves.toEqual({ error: expect.stringContaining(message) });
  expect(mocks.start).not.toHaveBeenCalled();
});

function createRequest(): Request {
  return new Request("https://dreamtrace.test/api/scenes/scene/branches", {
    method: "POST",
    body: JSON.stringify({
      dreamId: DREAM_ID,
      parentVersionId: VERSION_ID,
      instruction: "Turn the moon into a doorway",
      operationId: OPERATION_ID,
    }),
  });
}

function context() {
  return { params: Promise.resolve({ sceneId: SCENE_ID }) };
}
