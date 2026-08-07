import { describe, expect, it } from "vitest";
import { buildWhisperInput, normalizeWhisperOutput } from "@/lib/runpod/whisper";

describe("Faster Whisper contract", () => {
  it("builds a URL-based turbo transcription request", () => {
    expect(buildWhisperInput("https://storage.test/audio.webm")).toEqual({
      audio: "https://storage.test/audio.webm",
      model: "turbo",
      transcription: "plain_text",
      translate: false,
      enable_vad: true,
      word_timestamps: false,
    });
  });

  it("normalizes the official worker output", () => {
    expect(normalizeWhisperOutput({ transcription: "A silver train", detected_language: "en" }))
      .toEqual({ transcript: "A silver train", language: "en" });
  });

  it("rejects unsafe audio URLs and empty output", () => {
    expect(() => buildWhisperInput("http://storage.test/audio.webm")).toThrow("HTTPS");
    expect(() => normalizeWhisperOutput({ transcription: "" })).toThrow();
  });
});
