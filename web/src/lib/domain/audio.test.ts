import { describe, expect, it } from "vitest";
import { normalizeAudioMimeType } from "@/lib/domain/audio";

describe("audio input", () => {
  it("normalizes MediaRecorder codec parameters", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("rejects unsupported containers", () => {
    expect(() => normalizeAudioMimeType("audio/wav")).toThrow();
  });
});
