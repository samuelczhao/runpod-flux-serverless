import { expect, it, vi } from "vitest";
import { createRecordingBlob, disposeMediaRecorder, stopMediaStream } from "@/lib/domain/recorder";

it("stops every track in a media stream", () => {
  const first = { stop: vi.fn() };
  const second = { stop: vi.fn() };
  stopMediaStream({ getTracks: () => [first, second] } as unknown as MediaStream);
  expect(first.stop).toHaveBeenCalledOnce();
  expect(second.stop).toHaveBeenCalledOnce();
});

it("disarms and stops an active recorder", () => {
  const track = { stop: vi.fn() };
  const stop = vi.fn();
  const recorder = {
    state: "recording", stop, stream: { getTracks: () => [track] },
    ondataavailable: vi.fn(), onstop: vi.fn(),
  } as unknown as MediaRecorder;
  disposeMediaRecorder(recorder);
  expect(stop).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(recorder.ondataavailable).toBeNull();
  expect(recorder.onstop).toBeNull();
});

it("does not stop an already inactive recorder twice", () => {
  const stop = vi.fn();
  const recorder = {
    state: "inactive", stop, stream: { getTracks: () => [] },
    ondataavailable: null, onstop: null,
  } as unknown as MediaRecorder;
  disposeMediaRecorder(recorder);
  expect(stop).not.toHaveBeenCalled();
});

it("rejects an empty recording", () => {
  expect(createRecordingBlob([], "audio/webm")).toBeNull();
});

it("preserves non-empty audio", () => {
  const recording = createRecordingBlob([new Blob(["audio"])], "audio/webm");
  expect(recording?.size).toBe(5);
  expect(recording?.type).toBe("audio/webm");
});
