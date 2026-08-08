import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/dreams/route";
import { DatabaseOperationError } from "@/lib/database/errors";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn(), getUser: vi.fn() }));
const DREAM_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";
const OPERATION_ID = "ff5f82ba-3c73-4b3d-bd85-39004f7a645f";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/database/dreams", () => ({ prepareTextDream: mocks.prepare }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/workflows/start", () => ({
  DreamAccessError: class DreamAccessError extends Error {},
  startDreamGeneration: mocks.start,
}));

beforeEach(() => {
  mocks.prepare.mockReset(); mocks.start.mockReset(); mocks.getUser.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.prepare.mockResolvedValue(DREAM_ID);
  mocks.start.mockResolvedValue({ runId: "run-1", started: true });
});

it("uses the client operation ID to prepare and start a text dream", async () => {
  const response = await POST(createRequest());
  expect(response.status).toBe(202);
  expect(mocks.prepare).toHaveBeenCalledWith(
    USER_ID,
    OPERATION_ID,
    "A moonlit library under water",
    null,
    "watercolor-memory",
  );
  expect(mocks.start).toHaveBeenCalledWith(DREAM_ID, USER_ID);
  await expect(response.json()).resolves.toEqual({ dreamId: DREAM_ID, runId: "run-1" });
});

it("binds the selected Dream Self and style to the operation", async () => {
  const identityId = "2d318f63-c0c2-4ed6-a33c-e7fcd51f08c8";
  const response = await POST(new Request("https://dreamtrace.test/api/dreams", {
    method: "POST",
    body: JSON.stringify({
      operationId: OPERATION_ID,
      transcript: "A moonlit library under water",
      identityReferenceId: identityId,
      visualStyle: "watercolor-memory",
    }),
  }));
  expect(response.status).toBe(202);
  expect(mocks.prepare).toHaveBeenCalledWith(
    USER_ID,
    OPERATION_ID,
    "A moonlit library under water",
    identityId,
    "watercolor-memory",
  );
});

it("rejects a missing operation ID before allocating work", async () => {
  const response = await POST(new Request("https://dreamtrace.test/api/dreams", {
    method: "POST", body: JSON.stringify({ transcript: "A moonlit library under water" }),
  }));
  expect(response.status).toBe(400);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("requires an authenticated journal", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
  const response = await POST(createRequest());
  expect(response.status).toBe(401);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it.each([
  ["P4291", "Two dreams are already being made"],
  ["P4292", "hourly demo limit"],
  ["P4293", "today’s demo limit"],
])("returns 429 for quota code %s without starting work", async (code, message) => {
  mocks.prepare.mockRejectedValue(new DatabaseOperationError({ code, message: "quota" }));
  const response = await POST(createRequest());
  expect(response.status).toBe(429);
  await expect(response.json()).resolves.toEqual({ error: expect.stringContaining(message) });
  expect(mocks.start).not.toHaveBeenCalled();
});

it("keeps unknown database failures unavailable", async () => {
  mocks.prepare.mockRejectedValue(new DatabaseOperationError({ code: "XX000", message: "database" }));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await POST(createRequest());
  expect(response.status).toBe(503);
  expect(mocks.start).not.toHaveBeenCalled();
  log.mockRestore();
});

function createRequest(): Request {
  return new Request("https://dreamtrace.test/api/dreams", {
    method: "POST",
    body: JSON.stringify({
      operationId: OPERATION_ID,
      transcript: "A moonlit library under water",
    }),
  });
}
