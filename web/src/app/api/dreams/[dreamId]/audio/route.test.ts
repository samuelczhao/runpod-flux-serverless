import { beforeEach, expect, it, vi } from "vitest";
import { POST, shouldStartTranscription } from "@/app/api/dreams/[dreamId]/audio/route";
import { DatabaseOperationError } from "@/lib/database/errors";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), get: vi.fn(), start: vi.fn() }));
const DREAM_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/database/dreams", () => ({
  completeAudioUpload: mocks.complete,
  getProcessingDream: mocks.get,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
  }),
}));
vi.mock("@/workflows/start", () => ({
  DreamAccessError: class DreamAccessError extends Error {},
  startDreamTranscription: mocks.start,
}));

beforeEach(() => {
  mocks.complete.mockReset(); mocks.get.mockReset(); mocks.start.mockReset();
  mocks.complete.mockResolvedValue(undefined); mocks.start.mockResolvedValue({ runId: "run-1" });
});

it("starts transcription after the first upload completion", async () => {
  mocks.get.mockResolvedValue({ status: "UPLOADED" });
  const response = await POST(uploadRequest(), routeContext());
  expect(response.status).toBe(202);
  expect(mocks.start).toHaveBeenCalledWith(DREAM_ID, USER_ID);
  await expect(response.json()).resolves.toEqual({ dreamId: DREAM_ID, runId: "run-1" });
});

it.each(["PLANNING", "GENERATING_ANCHOR", "GENERATING_SCENES", "READY"] as const)(
  "accepts a completion replay after reaching %s",
  async (status) => {
    mocks.get.mockResolvedValue({ status });
    const response = await POST(uploadRequest(), routeContext());
    expect(response.status).toBe(202);
    expect(mocks.start).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ dreamId: DREAM_ID, runId: null });
  },
);

it("accepts a replay when transcription advances during its claim", async () => {
  mocks.get.mockResolvedValueOnce({ status: "UPLOADED" }).mockResolvedValueOnce({ status: "PLANNING" });
  mocks.start.mockRejectedValue(new DatabaseOperationError({
    code: "23514", message: "dream_not_ready",
  }));
  const response = await POST(uploadRequest(), routeContext());
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toEqual({ dreamId: DREAM_ID, runId: null });
});

it("only starts transcription from upload states", () => {
  expect(shouldStartTranscription("UPLOADED")).toBe(true);
  expect(shouldStartTranscription("TRANSCRIBING")).toBe(true);
  expect(shouldStartTranscription("READY")).toBe(false);
});

function uploadRequest(): Request {
  return new Request(`https://dreamtrace.test/api/dreams/${DREAM_ID}/audio`, {
    method: "POST", body: JSON.stringify({
      path: `${USER_ID}/${DREAM_ID}/source.webm`, mimeType: "audio/webm", sizeBytes: 1,
    }),
  });
}

function routeContext() {
  return { params: Promise.resolve({ dreamId: DREAM_ID }) };
}
