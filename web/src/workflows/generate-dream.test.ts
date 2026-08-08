import { beforeEach, expect, it, vi } from "vitest";
import { generateDreamWorkflow } from "@/workflows/generate-dream";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(), fail: vi.fn(), finalize: vi.fn(), getStatus: vi.fn(), inspectImage: vi.fn(),
  inspectPlan: vi.fn(), persistImage: vi.fn(), persistPlan: vi.fn(), record: vi.fn(),
  release: vi.fn(), submitAnchor: vi.fn(), submitPlan: vi.fn(), submitScene: vi.fn(),
}));

vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "run-1" }), sleep: vi.fn(),
}));
vi.mock("@/workflows/steps/finalize", () => ({
  failDreamStep: mocks.fail, finalizeDreamStep: mocks.finalize,
}));
vi.mock("@/workflows/steps/images", () => ({
  submitAnchorStep: mocks.submitAnchor, submitSceneStep: mocks.submitScene,
}));
vi.mock("@/workflows/steps/planning", () => ({
  inspectPlanStep: mocks.inspectPlan,
  persistPlanStep: mocks.persistPlan,
  submitPlanStep: mocks.submitPlan,
}));
vi.mock("@/workflows/steps/status", () => ({
  inspectImageJobStep: mocks.inspectImage, persistImageStep: mocks.persistImage,
}));
vi.mock("@/workflows/steps/cancel", () => ({ cancelGenerationJobStep: mocks.cancel }));
vi.mock("@/workflows/steps/dream-workflow", () => ({
  getDreamWorkflowStatusStep: mocks.getStatus,
  recordDreamWorkflowStep: mocks.record,
  releaseDreamWorkflowExecutionStep: mocks.release,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.record.mockResolvedValue(undefined);
});

it("releases a claim without failing the dream when run recording fails", async () => {
  mocks.record.mockRejectedValue(new Error("database unavailable"));
  await expect(generateDreamWorkflow("dream", "claim")).rejects.toThrow("database unavailable");
  expect(mocks.release).toHaveBeenCalledWith("dream", "claim", "run-1");
  expect(mocks.fail).not.toHaveBeenCalled();
});

it("resumes from scene generation without repeating earlier GPU work", async () => {
  mocks.getStatus.mockResolvedValue("GENERATING_SCENES");
  mocks.submitScene.mockImplementation(async (_dreamId: string, ordinal: number) => `job-${ordinal}`);
  mocks.inspectImage.mockResolvedValue("completed");

  await expect(generateDreamWorkflow("dream", "claim"))
    .resolves.toEqual({ dreamId: "dream", status: "READY" });
  expect(mocks.submitPlan).not.toHaveBeenCalled();
  expect(mocks.submitAnchor).not.toHaveBeenCalled();
  expect(mocks.submitScene).toHaveBeenNthCalledWith(1, "dream", 2);
  expect(mocks.submitScene).toHaveBeenNthCalledWith(2, "dream", 3);
  expect(mocks.finalize).toHaveBeenCalledWith("dream");
});

it("treats an already ready dream as a successful replay", async () => {
  mocks.getStatus.mockResolvedValue("READY");
  await expect(generateDreamWorkflow("dream", "claim"))
    .resolves.toEqual({ dreamId: "dream", status: "READY" });
  expect(mocks.submitPlan).not.toHaveBeenCalled();
  expect(mocks.submitAnchor).not.toHaveBeenCalled();
  expect(mocks.submitScene).not.toHaveBeenCalled();
});
