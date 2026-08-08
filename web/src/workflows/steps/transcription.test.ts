import { beforeEach, expect, it, vi } from "vitest";
import {
  inspectTranscriptionStep,
  persistTranscriptionStep,
} from "@/workflows/steps/transcription";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(), getJob: vi.fn(), getStatus: vi.fn(), transition: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getRunpodEnv: () => ({ apiKey: "key" }) }));
vi.mock("@/lib/database/jobs", () => ({
  claimGenerationJob: vi.fn(),
  completeTranscriptionJob: mocks.complete,
  getGenerationJob: mocks.getJob,
  recordGenerationSubmission: vi.fn(),
  transitionGenerationJob: mocks.transition,
}));
vi.mock("@/lib/database/dreams", () => ({ getProcessingDream: vi.fn() }));
vi.mock("@/lib/database/storage", () => ({ createDreamAudioUrl: vi.fn() }));
vi.mock("@/lib/runpod/queue", () => ({ getQueueStatus: mocks.getStatus, submitQueueJob: vi.fn() }));
vi.mock("@/lib/runpod/submission", () => ({ recordSubmissionFailure: vi.fn() }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

it("terminalizes malformed completed Whisper output", async () => {
  mocks.getJob.mockResolvedValue(job("RUNNING"));
  mocks.getStatus.mockResolvedValue({
    id: "external", status: "COMPLETED", output: { transcription: "" },
    delayTime: 12, executionTime: 34,
  });

  await expect(persistTranscriptionStep("job")).rejects.toThrow("invalid transcription");
  expect(mocks.transition).toHaveBeenCalledWith("job", "RUNNING", "FAILED", {
    p_delay_ms: 12, p_execution_ms: 34, p_error_code: "INVALID_PROVIDER_OUTPUT",
  });
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("does not poll a locally terminal transcription again", async () => {
  mocks.getJob.mockResolvedValue(job("FAILED"));
  await expect(inspectTranscriptionStep("job")).resolves.toBe("failed");
  expect(mocks.getStatus).not.toHaveBeenCalled();
});

function job(status: "RUNNING" | "FAILED") {
  return {
    id: "job", user_id: "user", dream_id: "dream", scene_version_id: null,
    stage: "transcription", model: "model", endpoint_id: "endpoint", external_job_id: "external",
    status, request_hash: "a".repeat(64),
  };
}
