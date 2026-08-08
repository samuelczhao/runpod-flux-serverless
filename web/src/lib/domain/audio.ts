import { z } from "zod";

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 180;

export const audioMimeTypeSchema = z.enum(["audio/webm", "audio/mp4", "audio/ogg"]);
export type AudioMimeType = z.infer<typeof audioMimeTypeSchema>;

export const audioUploadRequestSchema = z.object({
  mimeType: audioMimeTypeSchema,
  operationId: z.uuid(),
}).strict();

export function normalizeAudioMimeType(value: string): AudioMimeType {
  return audioMimeTypeSchema.parse(value.toLowerCase().split(";", 1)[0]);
}
