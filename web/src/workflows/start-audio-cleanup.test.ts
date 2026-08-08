import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldReleaseAudioCleanup } from "@/workflows/audio-cleanup-recovery";
import { startAudioCleanup } from "@/workflows/start-audio-cleanup";
import { cleanupAudioWorkflow } from "@/workflows/cleanup-audio";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), release: vi.fn(), start: vi.fn(), randomUUID: vi.fn(),
  runs: new Map<string, { exists: boolean; status: string }>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:crypto", () => ({ randomUUID: mocks.randomUUID }));
vi.mock("workflow/api", () => ({
  getRun: (runId: string) => {
    const run = mocks.runs.get(runId) ?? { exists: false, status: "missing" };
    return { exists: Promise.resolve(run.exists), status: Promise.resolve(run.status) };
  },
  start: mocks.start,
}));
vi.mock("@/lib/database/dreams", () => ({
  claimAudioCleanupWorkflow: mocks.claim,
  releaseAudioCleanupExecution: mocks.release,
}));
vi.mock("@/workflows/cleanup-audio", () => ({ cleanupAudioWorkflow: vi.fn() }));

beforeEach(() => {
  mocks.claim.mockReset(); mocks.release.mockReset(); mocks.start.mockReset();
  mocks.randomUUID.mockReset(); mocks.runs.clear();
});

describe("audio cleanup recovery", () => {
  it.each(["missing", "completed", "failed", "cancelled"] as const)("releases a %s run", (status) => {
    expect(shouldReleaseAudioCleanup(status)).toBe(true);
  });

  it.each(["pending", "running"] as const)("preserves a %s run", (status) => {
    expect(shouldReleaseAudioCleanup(status)).toBe(false);
  });
});

it("replaces a completed run whose cleanup remains due", async () => {
  configureRecovery("completed");
  await startAudioCleanup("dream", "user");
  expect(mocks.release).toHaveBeenCalledWith("dream", "inspect-token", "old-run");
  expect(mocks.start).toHaveBeenCalledWith(cleanupAudioWorkflow, ["dream", "user", "start-token"]);
});

it("preserves a running cleanup", async () => {
  mocks.randomUUID.mockReturnValue("inspect-token");
  mocks.claim.mockResolvedValue({ workflowId: "old-run", claimed: false });
  mocks.runs.set("old-run", { exists: true, status: "running" });
  await startAudioCleanup("dream", "user");
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});

function configureRecovery(status: string): void {
  mocks.randomUUID.mockReturnValueOnce("inspect-token").mockReturnValueOnce("start-token");
  mocks.claim.mockResolvedValueOnce({ workflowId: "old-run", claimed: false })
    .mockResolvedValueOnce({ workflowId: null, claimed: true });
  mocks.runs.set("old-run", { exists: true, status });
  mocks.start.mockResolvedValue({ runId: "replacement-run" });
}
