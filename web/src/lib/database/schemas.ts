import { z } from "zod";
import { dreamStatusSchema } from "@/lib/domain/dream";

export const uuidSchema = z.uuid();

export const jobStatusSchema = z.enum([
  "PENDING",
  "SUBMITTING",
  "SUBMIT_UNKNOWN",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const processingDreamSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  status: dreamStatusSchema,
  input_mode: z.enum(["audio", "text"]),
  transcript: z.string().nullable(),
  audio_storage_path: z.string().nullable(),
  audio_mime_type: z.string().nullable(),
  audio_upload_expires_at: z.iso.datetime().nullable(),
  retain_audio: z.boolean(),
  visual_bible: z.string().nullable(),
  plan_hash: z.string().nullable(),
  error_code: z.string().nullable(),
}).strict();

export const sceneSchema = z.object({
  id: uuidSchema,
  dream_id: uuidSchema,
  ordinal: z.number().int().min(1).max(3),
  caption: z.string(),
  prompt: z.string(),
}).strict();

export const sceneVersionSchema = z.object({
  id: uuidSchema,
  scene_id: uuidSchema,
  parent_version_id: uuidSchema.nullable(),
  storage_path: z.string().nullable(),
  edit_instruction: z.string().nullable(),
  seed: z.coerce.number().int().nonnegative().nullable(),
  model: z.string().min(1),
  status: jobStatusSchema,
  is_selected: z.boolean(),
  operation_key: z.string().nullable(),
  request_hash: z.string().nullable(),
}).strict();

export const jobSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  dream_id: uuidSchema,
  scene_version_id: uuidSchema.nullable(),
  stage: z.string().min(1),
  model: z.string().min(1),
  endpoint_id: z.string().min(1).nullable(),
  external_job_id: z.string().nullable(),
  status: jobStatusSchema,
  request_hash: z.string().length(64),
}).strict();

export type GenerationJob = z.infer<typeof jobSchema>;
export type ProcessingDream = z.infer<typeof processingDreamSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type SceneVersion = z.infer<typeof sceneVersionSchema>;
