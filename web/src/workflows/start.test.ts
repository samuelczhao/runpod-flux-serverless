import { beforeEach, describe, expect, it, vi } from "vitest";
import { startDreamGeneration } from "@/workflows/start";
import { generateDreamWorkflow } from "@/workflows/generate-dream";

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
  claimDreamWorkflow: mocks.claim,
  claimAudioPlanWorkflow: vi.fn(),
  releaseDreamWorkflowExecution: mocks.release,
}));
vi.mock("@/workflows/generate-dream", () => ({ generateDreamWorkflow: vi.fn() }));
vi.mock("@/workflows/transcribe-dream", () => ({ transcribeDreamWorkflow: vi.fn() }));

const DREAM_ID = "72fd8df7-c72d-4131-b673-d489aa02c42f";
const USER_ID = "ad06b483-1eea-4829-9ae8-68ba88eb9398";

beforeEach(() => {
  mocks.claim.mockReset(); mocks.release.mockReset(); mocks.start.mockReset();
  mocks.randomUUID.mockReset(); mocks.runs.clear();
});

describe("dream workflow recovery", () => {
  it.each(["failed", "cancelled"] as const)("replaces a %s run", async (status) => {
    configureRecovery(status, true);
    await expect(startDreamGeneration(DREAM_ID, USER_ID))
      .resolves.toEqual({ runId: "replacement-run", started: true });
    expect(mocks.release).toHaveBeenCalledWith(DREAM_ID, "inspect-token", "old-run");
    expect(mocks.start).toHaveBeenCalledWith(generateDreamWorkflow, [DREAM_ID, "start-token"]);
  });

  it("replaces a missing run", async () => {
    configureRecovery("missing", false);
    await startDreamGeneration(DREAM_ID, USER_ID);
    expect(mocks.release).toHaveBeenCalledWith(DREAM_ID, "inspect-token", "old-run");
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it.each(["pending", "running", "completed"] as const)("preserves a %s run", async (status) => {
    mocks.randomUUID.mockReturnValue("inspect-token");
    mocks.claim.mockResolvedValue({ workflowId: "old-run", claimed: false });
    mocks.runs.set("old-run", { exists: true, status });
    await expect(startDreamGeneration(DREAM_ID, USER_ID))
      .resolves.toEqual({ runId: "old-run", started: false });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("returns safely while another start is recording its run", async () => {
    mocks.randomUUID.mockReturnValue("inspect-token");
    mocks.claim.mockResolvedValue({ workflowId: null, claimed: false });
    await expect(startDreamGeneration(DREAM_ID, USER_ID))
      .resolves.toEqual({ runId: null, started: false });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("releases an unrecorded claim when workflow start fails", async () => {
    mocks.randomUUID.mockReturnValue("start-token");
    mocks.claim.mockResolvedValue({ workflowId: null, claimed: true });
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));
    await expect(startDreamGeneration(DREAM_ID, USER_ID)).rejects.toThrow("workflow unavailable");
    expect(mocks.release).toHaveBeenCalledWith(DREAM_ID, "start-token", "start-token");
  });
});

function configureRecovery(status: string, exists: boolean): void {
  mocks.randomUUID.mockReturnValueOnce("inspect-token").mockReturnValueOnce("start-token");
  mocks.claim.mockResolvedValueOnce({ workflowId: "old-run", claimed: false })
    .mockResolvedValueOnce({ workflowId: null, claimed: true });
  mocks.runs.set("old-run", { exists, status });
  mocks.start.mockResolvedValue({ runId: "replacement-run" });
}
