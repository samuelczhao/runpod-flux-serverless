import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldReleaseWorkflow } from "@/workflows/run-recovery";
import { BranchAccessError, startBranchGeneration } from "@/workflows/start-branch";
import { generateBranchWorkflow } from "@/workflows/generate-branch";

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
vi.mock("@/lib/database/scenes", () => ({
  claimBranchWorkflow: mocks.claim,
  releaseBranchWorkflowExecution: mocks.release,
}));
vi.mock("@/workflows/generate-branch", () => ({ generateBranchWorkflow: vi.fn() }));

const VERSION_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";

beforeEach(() => {
  mocks.claim.mockReset(); mocks.release.mockReset(); mocks.start.mockReset();
  mocks.randomUUID.mockReset(); mocks.runs.clear();
});

describe("branch workflow recovery", () => {
  it.each(["missing", "failed", "cancelled"] as const)("releases a %s run", (status) => {
    expect(shouldReleaseWorkflow(status)).toBe(true);
  });

  it.each(["pending", "running", "completed"] as const)("preserves a %s run", (status) => {
    expect(shouldReleaseWorkflow(status)).toBe(false);
  });
});

it("releases a failed run, reclaims ownership, and starts once", async () => {
    configureRecovery("failed");
    const result = await startBranchGeneration(VERSION_ID, USER_ID);
    expect(result).toEqual({ runId: "replacement-run", started: true });
    expect(mocks.release).toHaveBeenCalledWith(VERSION_ID, "inspect-token", "old-run");
    expect(mocks.start).toHaveBeenCalledWith(generateBranchWorkflow, [VERSION_ID, "start-token"]);
    expect(mocks.start).toHaveBeenCalledOnce();
});

it("reclaims a missing run", async () => {
    configureRecovery("missing", false);
    await startBranchGeneration(VERSION_ID, USER_ID);
    expect(mocks.release).toHaveBeenCalledWith(VERSION_ID, "inspect-token", "old-run");
    expect(mocks.start).toHaveBeenCalledOnce();
});

it("preserves a running workflow", async () => {
    mocks.randomUUID.mockReturnValue("inspect-token");
    mocks.claim.mockResolvedValue({ workflowId: "old-run", claimed: false });
    mocks.runs.set("old-run", { exists: true, status: "running" });
    await expect(startBranchGeneration(VERSION_ID, USER_ID))
      .resolves.toEqual({ runId: "old-run", started: false });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
});

it("releases an unrecorded claim when start fails", async () => {
    mocks.randomUUID.mockReturnValue("start-token");
    mocks.claim.mockResolvedValue({ workflowId: null, claimed: true });
    mocks.start.mockRejectedValue(new Error("world unavailable"));
    await expect(startBranchGeneration(VERSION_ID, USER_ID)).rejects.toThrow("world unavailable");
    expect(mocks.release).toHaveBeenCalledWith(VERSION_ID, "start-token", "start-token");
});

it("rejects a branch the user cannot access", async () => {
    mocks.randomUUID.mockReturnValue("access-token");
    mocks.claim.mockResolvedValue(null);
    await expect(startBranchGeneration(VERSION_ID, USER_ID)).rejects.toBeInstanceOf(BranchAccessError);
});

function configureRecovery(status: string, exists = true): void {
  mocks.randomUUID.mockReturnValueOnce("inspect-token").mockReturnValueOnce("start-token");
  mocks.claim.mockResolvedValueOnce({ workflowId: "old-run", claimed: false })
    .mockResolvedValueOnce({ workflowId: null, claimed: true });
  mocks.runs.set("old-run", { exists, status });
  mocks.start.mockResolvedValue({ runId: "replacement-run" });
}
