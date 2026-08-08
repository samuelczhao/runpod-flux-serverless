import { describe, expect, it } from "vitest";
import { audioUploadRequestSchema, normalizeAudioMimeType } from "@/lib/domain/audio";

describe("audio input", () => {
  it("normalizes MediaRecorder codec parameters", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("rejects unsupported containers", () => {
    expect(() => normalizeAudioMimeType("audio/wav")).toThrow();
  });

  it("requires an idempotency key for audio preparation", () => {
    expect(() => audioUploadRequestSchema.parse({ mimeType: "audio/webm" })).toThrow();
    const request = audioUploadRequestSchema.parse({
      mimeType: "audio/webm", operationId: "5deefbe0-2003-4af4-b75e-0bd9c22bed60",
    });
    expect(request.operationId).toBe("5deefbe0-2003-4af4-b75e-0bd9c22bed60");
  });
});
