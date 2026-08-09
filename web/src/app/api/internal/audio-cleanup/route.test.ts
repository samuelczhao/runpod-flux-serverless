import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/internal/audio-cleanup/route";

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), identities: vi.fn(), start: vi.fn() }));
const ORIGINAL_ENV = { ...process.env };
const SECRET = "s".repeat(32);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/database/dreams", () => ({
  getExpiredAudioCleanupCandidates: mocks.candidates,
}));
vi.mock("@/workflows/start-audio-cleanup", () => ({ startAudioCleanup: mocks.start }));
vi.mock("@/lib/database/identity", () => ({ cleanupIdentityCandidates: mocks.identities }));

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, CRON_SECRET: SECRET };
  mocks.candidates.mockReset(); mocks.identities.mockReset(); mocks.start.mockReset();
  mocks.identities.mockResolvedValue({
    inspected: 0, failed: 0, remaining: 0, oldestDueAt: null,
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

it("rejects requests without the cron secret", async () => {
  const response = await GET(new Request("https://dreamtrace.test/api/internal/audio-cleanup"));
  expect(response.status).toBe(401);
  expect(mocks.candidates).not.toHaveBeenCalled();
});

it("reconciles every expired audio cleanup", async () => {
  const candidates = [candidate("dream-1"), candidate("dream-2")];
  mocks.candidates.mockResolvedValue(candidates); mocks.start.mockResolvedValue(undefined);
  const response = await GET(authorizedRequest());
  expect(response.status).toBe(200);
  expect(mocks.candidates).toHaveBeenCalledWith(100);
  expect(mocks.identities).toHaveBeenCalledWith(250);
  expect(mocks.start).toHaveBeenCalledTimes(2);
});

it("reports partial reconciliation failures", async () => {
  mocks.candidates.mockResolvedValue([candidate("dream-1")]);
  mocks.start.mockRejectedValue(new Error("workflow unavailable"));
  const response = await GET(authorizedRequest());
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    inspected: 1, failed: 1, identityBacklog: 0, oldestIdentityDueAt: null,
  });
});

it("reports a cleanup backlog after a full sweep", async () => {
  mocks.candidates.mockResolvedValue([]);
  mocks.identities.mockResolvedValue({
    inspected: 100,
    failed: 0,
    remaining: 3,
    oldestDueAt: "2026-08-08T10:00:00.000Z",
  });

  const response = await GET(authorizedRequest());

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ identityBacklog: 3 });
});

function authorizedRequest(): Request {
  return new Request("https://dreamtrace.test/api/internal/audio-cleanup", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function candidate(dreamId: string) {
  return { dreamId, userId: "user-1" };
}
