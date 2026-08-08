import { beforeEach, expect, it, vi } from "vitest";
import { ProviderArtifactError } from "@/lib/database/storage";
import { persistImageStep } from "@/workflows/steps/status";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(), download: vi.fn(), getJob: vi.fn(), getStatus: vi.fn(),
  getVersion: vi.fn(), store: vi.fn(), transition: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getRunpodEnv: () => ({ apiKey: "key" }) }));
vi.mock("@/lib/database/jobs", () => ({
  completeImageJob: mocks.complete,
  getGenerationJob: mocks.getJob,
  transitionGenerationJob: mocks.transition,
}));
vi.mock("@/lib/database/scenes", () => ({ getSceneVersion: mocks.getVersion }));
vi.mock("@/lib/database/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database/storage")>(),
  downloadProviderPng: mocks.download,
  storeDreamPng: mocks.store,
}));
vi.mock("@/lib/runpod/queue", () => ({ getQueueStatus: mocks.getStatus }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

it("terminalizes a completed provider job with an invalid image artifact", async () => {
  mocks.getJob.mockResolvedValue(job());
  mocks.getStatus.mockResolvedValue({
    id: "external", status: "COMPLETED", output: { image_url: "https://images.example/result.png" },
    delayTime: 10, executionTime: 20,
  });
  mocks.getVersion.mockResolvedValue({ id: "version" });
  mocks.download.mockRejectedValue(new ProviderArtifactError("not a PNG"));

  await expect(persistImageStep("job")).rejects.toThrow("invalid image artifact");
  expect(mocks.transition).toHaveBeenCalledWith("job", "RUNNING", "FAILED", {
    p_delay_ms: 10, p_execution_ms: 20, p_error_code: "INVALID_PROVIDER_OUTPUT",
  });
  expect(mocks.store).not.toHaveBeenCalled();
});

function job() {
  return {
    id: "job", user_id: "user", dream_id: "dream", scene_version_id: "version",
    stage: "branch", model: "model", endpoint_id: "endpoint", external_job_id: "external",
    status: "RUNNING", request_hash: "a".repeat(64),
  };
}
