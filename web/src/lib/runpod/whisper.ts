import { z } from "zod";

const whisperOutputSchema = z.object({
  transcription: z.string().trim().min(1).max(12_000),
  detected_language: z.string().min(1).optional(),
}).passthrough();

export interface WhisperOutput {
  readonly transcript: string;
  readonly language: string | undefined;
}

export function buildWhisperInput(audioUrl: string): Readonly<Record<string, unknown>> {
  return {
    audio: requireHttpsUrl(audioUrl),
    model: "turbo",
    transcription: "plain_text",
    translate: false,
    enable_vad: true,
    word_timestamps: false,
  };
}

export function normalizeWhisperOutput(output: unknown): WhisperOutput {
  const parsed = whisperOutputSchema.parse(output);
  return { transcript: parsed.transcription, language: parsed.detected_language };
}

function requireHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Runpod audio URL must use HTTPS");
  return url.toString();
}
