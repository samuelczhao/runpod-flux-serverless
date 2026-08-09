import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/dreams/audio/route";
import { DatabaseOperationError } from "@/lib/database/errors";
import { DEFAULT_VISUAL_STYLE } from "@/lib/domain/identity";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), cleanup: vi.fn(), upload: vi.fn(), getUser: vi.fn(),
}));
const DREAM_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";
const OPERATION_ID = "ff5f82ba-3c73-4b3d-bd85-39004f7a645f";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/database/dreams", () => ({ prepareAudioDream: mocks.prepare }));
vi.mock("@/lib/database/storage", () => ({ createDreamAudioUpload: mocks.upload }));
vi.mock("@/workflows/start-audio-cleanup", () => ({ startAudioCleanup: mocks.cleanup }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.prepare.mockResolvedValue(DREAM_ID);
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({ path: "audio/source.webm", token: "signed-token" });
});

it("prepares cleanup and a signed audio upload", async () => {
  const response = await POST(createRequest());
  expect(response.status).toBe(201);
  expect(mocks.prepare).toHaveBeenCalledWith(
    USER_ID, OPERATION_ID, "audio/webm", null, DEFAULT_VISUAL_STYLE,
  );
  expect(mocks.cleanup).toHaveBeenCalledWith(DREAM_ID, USER_ID);
  expect(mocks.upload).toHaveBeenCalledWith(USER_ID, DREAM_ID, "audio/webm");
});

it.each(["P4291", "P4292", "P4293"])(
  "returns 429 for quota code %s without creating downstream work",
  async (code) => {
    mocks.prepare.mockRejectedValue(new DatabaseOperationError({ code, message: "quota" }));
    const response = await POST(createRequest());
    expect(response.status).toBe(429);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  },
);

it("keeps unknown database failures unavailable", async () => {
  mocks.prepare.mockRejectedValue(new DatabaseOperationError({ code: "XX000", message: "database" }));
  const response = await POST(createRequest());
  expect(response.status).toBe(503);
  expect(mocks.cleanup).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

function createRequest(): Request {
  return new Request("https://dreamtrace.test/api/dreams/audio", {
    method: "POST", body: JSON.stringify({ operationId: OPERATION_ID, mimeType: "audio/webm" }),
  });
}
