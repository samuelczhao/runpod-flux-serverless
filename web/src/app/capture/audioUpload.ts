"use client";

import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  MAX_AUDIO_BYTES,
  normalizeAudioMimeType,
  type AudioMimeType,
} from "@/lib/domain/audio";
import type { AudioUpload, DreamRecorder } from "@/app/capture/useDreamRecorder";
import {
  DEFAULT_VISUAL_STYLE,
  type DreamCaptureOptions,
} from "@/lib/domain/identity";

const uploadSchema = z.object({
  dreamId: z.uuid(), path: z.string().min(1), token: z.string().min(1),
}).strict();

interface StoredUpload {
  readonly upload: AudioUpload;
  readonly completed: boolean;
}

const DEFAULT_CAPTURE_OPTIONS: DreamCaptureOptions = {
  identityReferenceId: null,
  visualStyle: DEFAULT_VISUAL_STYLE,
};

export async function uploadDreamRecording(
  recorder: DreamRecorder,
  onComplete: (dreamId: string) => void,
  options: DreamCaptureOptions = DEFAULT_CAPTURE_OPTIONS,
): Promise<void> {
  const blob = validateRecording(recorder);
  if (!blob) return;
  recorder.setUploading();
  try {
    const dreamId = await persistRecording(recorder, blob, options);
    if (recorder.isMounted()) onComplete(dreamId);
  } catch (cause: unknown) {
    if (!recorder.isMounted()) return;
    recorder.setRecorded();
    recorder.setError(cause instanceof AudioPreparationError
      ? cause.message
      : "The recording could not be uploaded. Try again, record again, or use text.");
  }
}

function validateRecording(recorder: DreamRecorder): Blob | null {
  if (!recorder.blob) { recorder.setError("Record a dream first."); return null; }
  if (recorder.blob.size === 0) { recorder.setError("The recording is empty. Record it again."); return null; }
  if (recorder.blob.size > MAX_AUDIO_BYTES) {
    recorder.setError("Recording exceeds the 10 MB limit."); return null;
  }
  return recorder.blob;
}

async function persistRecording(
  recorder: DreamRecorder,
  blob: Blob,
  options: DreamCaptureOptions,
): Promise<string> {
  const mimeType = normalizeAudioMimeType(blob.type);
  const result = await ensureUploadStored(recorder, blob, mimeType, options);
  if (!result.completed) {
    await requireUploadCompletion(result.upload, mimeType, blob.size);
  }
  return result.upload.dreamId;
}

async function ensureUploadStored(
  recorder: DreamRecorder,
  blob: Blob,
  mimeType: AudioMimeType,
  options: DreamCaptureOptions,
): Promise<StoredUpload> {
  const attempt = recorder.uploadAttempt;
  if (attempt && !sameCaptureOptions(attempt.options, options)) {
    const upload = await requestUpload(mimeType, recorder.restartUpload(), options);
    return storeUpload(recorder, upload, blob, mimeType, options);
  }
  const operationOptions = attempt?.options ?? options;
  if (attempt?.stored) return { upload: attempt.upload, completed: false };
  if (attempt?.attempted) {
    const completed = await inspectUploadCompletion(attempt.upload, mimeType, blob.size);
    if (completed) return { upload: attempt.upload, completed: true };
  }
  const upload = attempt?.attempted
    ? await requestUpload(mimeType, recorder.uploadOperationId, operationOptions)
    : attempt?.upload ?? await requestUpload(mimeType, recorder.uploadOperationId, operationOptions);
  return storeUpload(recorder, upload, blob, mimeType, operationOptions);
}

function sameCaptureOptions(left: DreamCaptureOptions, right: DreamCaptureOptions): boolean {
  return left.identityReferenceId === right.identityReferenceId
    && left.visualStyle === right.visualStyle;
}

async function storeUpload(
  recorder: DreamRecorder,
  upload: AudioUpload,
  blob: Blob,
  mimeType: AudioMimeType,
  options: DreamCaptureOptions,
): Promise<StoredUpload> {
  recorder.rememberUpload(upload, options);
  recorder.markUploadAttempted();
  await uploadBlob(upload.path, upload.token, blob, mimeType);
  recorder.markUploadStored();
  return { upload, completed: false };
}

async function requestUpload(
  mimeType: AudioMimeType,
  operationId: string,
  options: DreamCaptureOptions,
): Promise<AudioUpload> {
  const response = await fetch("/api/dreams/audio", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType, operationId, ...options }),
  });
  if (!response.ok) throw new AudioPreparationError(await responseErrorMessage(response));
  return uploadSchema.parse(await response.json() as unknown);
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = "Audio upload preparation failed";
  try {
    const parsed = z.object({ error: z.string().min(1) }).safeParse(await response.json() as unknown);
    return parsed.success ? parsed.data.error : fallback;
  } catch {
    return fallback;
  }
}

class AudioPreparationError extends Error {}

async function uploadBlob(
  path: string,
  token: string,
  blob: Blob,
  mimeType: AudioMimeType,
): Promise<void> {
  const result = await createSupabaseBrowserClient().storage.from("dream-audio")
    .uploadToSignedUrl(path, token, blob, { contentType: mimeType });
  if (result.error) throw result.error;
}

async function inspectUploadCompletion(
  upload: AudioUpload,
  mimeType: AudioMimeType,
  sizeBytes: number,
): Promise<boolean> {
  const response = await completeUpload(upload, mimeType, sizeBytes);
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error("Audio upload completion could not be verified");
}

async function requireUploadCompletion(
  upload: AudioUpload,
  mimeType: AudioMimeType,
  sizeBytes: number,
): Promise<void> {
  if (!await inspectUploadCompletion(upload, mimeType, sizeBytes)) {
    throw new Error("Stored audio could not be found");
  }
}

function completeUpload(
  upload: AudioUpload,
  mimeType: AudioMimeType,
  sizeBytes: number,
): Promise<Response> {
  return fetch(`/api/dreams/${upload.dreamId}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: upload.path, mimeType, sizeBytes }),
  });
}
