"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_SECONDS,
  normalizeAudioMimeType,
  type AudioMimeType,
} from "@/lib/domain/audio";

const uploadSchema = z.object({ dreamId: z.uuid(), path: z.string().min(1), token: z.string().min(1) }).strict();
type RecorderPhase = "ready" | "recording" | "recorded" | "uploading";

export function AudioCapture({
  ready,
  onComplete,
}: {
  readonly ready: boolean;
  readonly onComplete: (dreamId: string) => void;
}) {
  const recorder = useDreamRecorder();
  const submit = () => void uploadDreamRecording(recorder, onComplete);
  return <AudioCaptureCard ready={ready} recorder={recorder} submit={submit} />;
}

function AudioCaptureCard({
  ready,
  recorder,
  submit,
}: {
  readonly ready: boolean;
  readonly recorder: DreamRecorder;
  readonly submit: () => void;
}) {
  return (
    <section className="capture-card audio-capture" aria-live="polite">
      <AudioHeader phase={recorder.phase} seconds={recorder.seconds} />
      {recorder.audioUrl ? <audio controls src={recorder.audioUrl}>Audio playback is not supported.</audio> : null}
      {recorder.error ? <p className="form-error" role="alert">{recorder.error}</p> : null}
      <AudioActions ready={ready} recorder={recorder} submit={submit} />
      <p className="audio-note">Up to three minutes. The recording is deleted after transcription by default.</p>
    </section>
  );
}

function AudioActions({ ready, recorder, submit }: {
  readonly ready: boolean; readonly recorder: DreamRecorder; readonly submit: () => void;
}) {
  return <div className="audio-actions">
    {recorder.phase === "ready" ? <button className="record-button" disabled={!ready}
      onClick={recorder.start} type="button"><span aria-hidden="true" />Record dream</button> : null}
    {recorder.phase === "recording" ? <button className="button primary" onClick={recorder.stop}
      type="button">Stop recording</button> : null}
    {recorder.phase === "recorded" ? <><button className="button ghost" onClick={recorder.reset}
      type="button">Record again</button><button className="button primary" onClick={submit}
      type="button">Transcribe recording</button></> : null}
    {recorder.phase === "uploading" ? <button className="button primary" disabled type="button">
      Sending to private transcription…</button> : null}
  </div>;
}

interface DreamRecorder {
  readonly phase: RecorderPhase;
  readonly seconds: number;
  readonly blob: Blob | null;
  readonly audioUrl: string | null;
  readonly error: string | null;
  readonly start: () => void;
  readonly stop: () => void;
  readonly reset: () => void;
  readonly setUploading: () => void;
  readonly setError: (value: string) => void;
}

function useDreamRecorder(): DreamRecorder {
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<RecorderPhase>("ready");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useRecordingTimer(phase, mediaRecorder, setSeconds);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const start = () => void beginRecording(mediaRecorder, chunks, setPhase, setBlob, setAudioUrl, setError);
  const reset = () => resetRecording(audioUrl, setPhase, setSeconds, setBlob, setAudioUrl, setError);
  return { phase, seconds, blob, audioUrl, error, start, stop: () => mediaRecorder.current?.stop(), reset,
    setUploading: () => setPhase("uploading"), setError };
}

function useRecordingTimer(
  phase: RecorderPhase,
  recorder: React.RefObject<MediaRecorder | null>,
  setSeconds: React.Dispatch<React.SetStateAction<number>>,
): void {
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setSeconds((value) => {
      if (value + 1 >= MAX_RECORDING_SECONDS) recorder.current?.stop();
      return Math.min(value + 1, MAX_RECORDING_SECONDS);
    }), 1_000);
    return () => window.clearInterval(timer);
  }, [phase, recorder, setSeconds]);
}

async function beginRecording(
  recorderRef: React.MutableRefObject<MediaRecorder | null>,
  chunks: React.MutableRefObject<Blob[]>,
  setPhase: (phase: RecorderPhase) => void,
  setBlob: (blob: Blob | null) => void,
  setAudioUrl: (url: string | null) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
    configureRecorder(recorder, chunks, stream, setPhase, setBlob, setAudioUrl);
    recorderRef.current = recorder;
    setError(null);
    recorder.start(1_000);
    setPhase("recording");
  } catch {
    setError("Microphone access failed. You can type the dream instead.");
  }
}

function configureRecorder(
  recorder: MediaRecorder,
  chunks: React.MutableRefObject<Blob[]>,
  stream: MediaStream,
  setPhase: (phase: RecorderPhase) => void,
  setBlob: (blob: Blob | null) => void,
  setAudioUrl: (url: string | null) => void,
): void {
  chunks.current = [];
  recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
  recorder.onstop = () => {
    const recording = new Blob(chunks.current, { type: recorder.mimeType });
    stream.getTracks().forEach((track) => track.stop());
    setBlob(recording);
    setAudioUrl(URL.createObjectURL(recording));
    setPhase("recorded");
  };
}

function resetRecording(
  audioUrl: string | null,
  setPhase: (phase: RecorderPhase) => void,
  setSeconds: (seconds: number) => void,
  setBlob: (blob: Blob | null) => void,
  setAudioUrl: (url: string | null) => void,
  setError: (error: string | null) => void,
): void {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  setPhase("ready"); setSeconds(0); setBlob(null); setAudioUrl(null); setError(null);
}

async function uploadDreamRecording(
  recorder: DreamRecorder,
  onComplete: (dreamId: string) => void,
): Promise<void> {
  if (!recorder.blob) return recorder.setError("Record a dream first.");
  if (recorder.blob.size > MAX_AUDIO_BYTES) return recorder.setError("Recording exceeds the 10 MB limit.");
  recorder.setUploading();
  try {
    const mimeType = normalizeAudioMimeType(recorder.blob.type);
    const upload = await requestUpload(mimeType);
    await uploadBlob(upload.path, upload.token, recorder.blob, mimeType);
    await completeUpload(upload.dreamId, upload.path, mimeType, recorder.blob.size);
    onComplete(upload.dreamId);
  } catch {
    recorder.setError("The recording could not be uploaded. Record again or use text.");
  }
}

async function requestUpload(mimeType: AudioMimeType) {
  const response = await fetch("/api/dreams/audio", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mimeType }),
  });
  if (!response.ok) throw new Error("Audio upload preparation failed");
  return uploadSchema.parse(await response.json() as unknown);
}

async function uploadBlob(path: string, token: string, blob: Blob, mimeType: AudioMimeType): Promise<void> {
  const result = await createSupabaseBrowserClient().storage.from("dream-audio")
    .uploadToSignedUrl(path, token, blob, { contentType: mimeType });
  if (result.error) throw result.error;
}

async function completeUpload(
  dreamId: string,
  path: string,
  mimeType: AudioMimeType,
  sizeBytes: number,
): Promise<void> {
  const response = await fetch(`/api/dreams/${dreamId}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, mimeType, sizeBytes }),
  });
  if (!response.ok) throw new Error("Audio upload completion failed");
}

function AudioHeader({ phase, seconds }: { readonly phase: RecorderPhase; readonly seconds: number }) {
  const label = phase === "recording" ? `Recording · ${formatDuration(seconds)}`
    : phase === "recorded" ? "Recording ready" : "Speak what you remember";
  return <div className="audio-header"><span className={phase === "recording" ? "live-dot" : ""} />
    <h2>{label}</h2></div>;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") throw new Error("Recording is not supported");
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  const match = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!match) throw new Error("No supported recording format");
  return match;
}

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
