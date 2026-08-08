import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanupExpiredAudioStep,
  completeAudioCleanupWorkflowStep,
  expireStaleAudioProcessingStep,
  getAudioCleanupDeadlineStep,
} from "@/workflows/steps/audio-cleanup";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), complete: vi.fn(), expire: vi.fn(), cancel: vi.fn(),
  getJob: vi.fn(), cancelJob: vi.fn(), transitionJob: vi.fn(),
  deleteDream: vi.fn(), deleteDraft: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({
  getRun: () => ({
    exists: Promise.resolve(true), status: Promise.resolve("running"), cancel: mocks.cancel,
  }),
}));
vi.mock("@/lib/database/dreams", () => ({
  completeAudioCleanupWorkflow: mocks.complete,
  expireStaleAudioProcessing: mocks.expire,
  getProcessingDreamOrNull: mocks.get,
  recordAudioCleanupWorkflow: vi.fn(),
  releaseAudioCleanupExecution: vi.fn(),
}));
vi.mock("@/lib/database/storage", () => ({
  deleteDreamAudio: mocks.deleteDream,
  deleteExpiredDraftAudio: mocks.deleteDraft,
}));
vi.mock("@/lib/database/jobs", () => ({
  getActiveTranscriptionJob: mocks.getJob,
  transitionGenerationJob: mocks.transitionJob,
}));
vi.mock("@/workflows/steps/cancel", () => ({ cancelGenerationJobStep: mocks.cancelJob }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

it("treats a previously deleted draft as complete", async () => {
  mocks.get.mockResolvedValue(null);
  await expect(cleanupExpiredAudioStep("dream", "user")).resolves.toBe("done");
  await expect(getAudioCleanupDeadlineStep("dream", "user")).resolves.toBeNull();
  expect(mocks.deleteDraft).not.toHaveBeenCalled();
});

it("deletes an expired draft", async () => {
  mocks.get.mockResolvedValue(dream({ status: "DRAFT" }));
  mocks.deleteDraft.mockResolvedValue(true);
  await expect(cleanupExpiredAudioStep("dream", "user")).resolves.toBe("done");
  expect(mocks.deleteDraft).toHaveBeenCalledWith("dream", "user");
});

it("defers cleanup while transcription owns the source", async () => {
  mocks.get.mockResolvedValue(dream({ status: "TRANSCRIBING" }));
  await expect(cleanupExpiredAudioStep("dream", "user")).resolves.toBe("defer");
  expect(mocks.deleteDream).not.toHaveBeenCalled();
});

it("records final cleanup completion", async () => {
  mocks.complete.mockResolvedValue(undefined);
  await completeAudioCleanupWorkflowStep("dream", "run");
  expect(mocks.complete).toHaveBeenCalledWith("dream", "run");
});

it("expires and cancels abandoned audio processing", async () => {
  mocks.expire.mockResolvedValue("transcription-run");
  mocks.cancel.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue(dream({ status: "FAILED", error_code: "audio_processing_expired" }));
  mocks.getJob.mockResolvedValue({ id: "provider-job", status: "RUNNING" });
  mocks.cancelJob.mockResolvedValue("cancelled");
  await expireStaleAudioProcessingStep("dream", "user");
  expect(mocks.expire).toHaveBeenCalledWith("dream", "user");
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.cancelJob).toHaveBeenCalledWith("provider-job");
});

it("terminalizes a stale provider job that completed too late", async () => {
  mocks.expire.mockResolvedValue(null);
  mocks.get.mockResolvedValue(dream({ status: "FAILED", error_code: "audio_processing_expired" }));
  mocks.getJob.mockResolvedValue({ id: "provider-job", status: "QUEUED" });
  mocks.cancelJob.mockResolvedValue("completed");
  await expireStaleAudioProcessingStep("dream", "user");
  expect(mocks.transitionJob).toHaveBeenCalledWith("provider-job", "QUEUED", "FAILED", {
    p_error_code: "STALE_TRANSCRIPTION_COMPLETED_UNPERSISTED",
  });
});

function dream(overrides: Record<string, unknown>) {
  return {
    id: "dream", user_id: "user", status: "READY", input_mode: "audio",
    transcript: "transcript", audio_storage_path: "user/dream/source.webm",
    audio_mime_type: "audio/webm", audio_upload_expires_at: new Date().toISOString(),
    retain_audio: false, visual_bible: "bible", plan_hash: "hash", error_code: null, ...overrides,
  };
}
