"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SECONDS } from "@/lib/domain/audio";
import { createRecordingBlob, disposeMediaRecorder, stopMediaStream } from "@/lib/domain/recorder";

export interface AudioUpload {
  readonly dreamId: string;
  readonly path: string;
  readonly token: string;
}

export type RecorderPhase = "ready" | "starting" | "recording" | "recorded" | "uploading";

export interface UploadAttempt {
  readonly upload: AudioUpload;
  readonly attempted: boolean;
  readonly stored: boolean;
}

interface RecorderState {
  readonly phase: RecorderPhase;
  readonly seconds: number;
  readonly blob: Blob | null;
  readonly audioUrl: string | null;
  readonly error: string | null;
  readonly uploadAttempt: UploadAttempt | null;
  readonly uploadOperationId: string;
  readonly setPhase: React.Dispatch<React.SetStateAction<RecorderPhase>>;
  readonly setSeconds: React.Dispatch<React.SetStateAction<number>>;
  readonly setBlob: React.Dispatch<React.SetStateAction<Blob | null>>;
  readonly setAudioUrl: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setError: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setUploadAttempt: React.Dispatch<React.SetStateAction<UploadAttempt | null>>;
  readonly setUploadOperationId: React.Dispatch<React.SetStateAction<string>>;
}

export interface DreamRecorder {
  readonly phase: RecorderPhase;
  readonly seconds: number;
  readonly blob: Blob | null;
  readonly audioUrl: string | null;
  readonly error: string | null;
  readonly uploadAttempt: UploadAttempt | null;
  readonly uploadOperationId: string;
  readonly start: () => void;
  readonly stop: () => void;
  readonly reset: () => void;
  readonly setUploading: () => void;
  readonly setRecorded: () => void;
  readonly rememberUpload: (upload: AudioUpload) => void;
  readonly markUploadAttempted: () => void;
  readonly markUploadStored: () => void;
  readonly setError: (value: string) => void;
  readonly isMounted: () => boolean;
}

export function useDreamRecorder(): DreamRecorder {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const state = useRecorderState();
  useRecordingTimer(state.phase, recorderRef, state.setSeconds);
  useRecorderResources(recorderRef, mountedRef, state.audioUrl);
  const recordingActions = useRecordingActions(recorderRef, chunksRef, startingRef, mountedRef, state);
  return {
    phase: state.phase, seconds: state.seconds, blob: state.blob, audioUrl: state.audioUrl,
    error: state.error, uploadAttempt: state.uploadAttempt, uploadOperationId: state.uploadOperationId,
    ...recordingActions,
    setUploading: () => { state.setError(null); state.setPhase("uploading"); },
    setRecorded: () => state.setPhase("recorded"),
    rememberUpload: (upload) => state.setUploadAttempt({ upload, attempted: false, stored: false }),
    markUploadAttempted: () => state.setUploadAttempt((value) => value && { ...value, attempted: true }),
    markUploadStored: () => state.setUploadAttempt((value) => value && { ...value, stored: true }),
    setError: (value) => state.setError(value),
    isMounted: () => mountedRef.current,
  };
}

function useRecorderState(): RecorderState {
  const [phase, setPhase] = useState<RecorderPhase>("ready");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadAttempt, setUploadAttempt] = useState<UploadAttempt | null>(null);
  const [uploadOperationId, setUploadOperationId] = useState(() => crypto.randomUUID());
  return { phase, setPhase, seconds, setSeconds, blob, setBlob, audioUrl, setAudioUrl,
    error, setError, uploadAttempt, setUploadAttempt, uploadOperationId, setUploadOperationId };
}

function useRecorderResources(
  recorderRef: React.MutableRefObject<MediaRecorder | null>,
  mountedRef: React.MutableRefObject<boolean>,
  audioUrl: string | null,
): void {
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; disposeRecorderRef(recorderRef); };
  }, [mountedRef, recorderRef]);
}

function useRecordingActions(
  recorderRef: React.MutableRefObject<MediaRecorder | null>,
  chunksRef: React.MutableRefObject<Blob[]>,
  startingRef: React.MutableRefObject<boolean>,
  mountedRef: React.MutableRefObject<boolean>,
  state: RecorderState,
): Pick<DreamRecorder, "start" | "stop" | "reset"> {
  const start = useCallback(() => startRecording(
    recorderRef, chunksRef, startingRef, state, () => mountedRef.current,
  ), [chunksRef, mountedRef, recorderRef, startingRef, state]);
  const stop = useCallback(() => recorderRef.current?.stop(), [recorderRef]);
  const reset = useCallback(() => resetRecording(recorderRef, state), [recorderRef, state]);
  return { start, stop, reset };
}

function startRecording(
  recorder: React.MutableRefObject<MediaRecorder | null>,
  chunks: React.MutableRefObject<Blob[]>,
  starting: React.MutableRefObject<boolean>,
  state: RecorderState,
  isMounted: () => boolean,
): void {
  if (starting.current) return;
  starting.current = true;
  state.setPhase("starting");
  void beginRecording(recorder, chunks, state, isMounted)
    .finally(() => { starting.current = false; });
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
  state: RecorderState,
  isMounted: () => boolean,
): Promise<void> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!isMounted()) return stopMediaStream(stream);
    activateRecorder(recorderRef, chunks, stream, state);
  } catch {
    cleanupFailedRecording(recorderRef, stream);
    if (isMounted()) {
      state.setPhase("ready");
      state.setError("Microphone access failed. You can type the dream instead.");
    }
  }
}

function activateRecorder(
  recorderRef: React.MutableRefObject<MediaRecorder | null>,
  chunks: React.MutableRefObject<Blob[]>,
  stream: MediaStream,
  state: RecorderState,
): void {
  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
  recorderRef.current = recorder;
  configureRecorder(recorderRef, recorder, chunks, stream, state);
  state.setError(null); state.setSeconds(0);
  recorder.start(1_000); state.setPhase("recording");
}

function configureRecorder(
  recorderRef: React.MutableRefObject<MediaRecorder | null>,
  recorder: MediaRecorder,
  chunks: React.MutableRefObject<Blob[]>,
  stream: MediaStream,
  state: RecorderState,
): void {
  chunks.current = [];
  recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
  recorder.onstop = () => finishRecording(recorderRef, recorder, chunks.current, stream, state);
}

function finishRecording(
  recorderRef: React.MutableRefObject<MediaRecorder | null>,
  recorder: MediaRecorder,
  chunks: readonly Blob[],
  stream: MediaStream,
  state: RecorderState,
): void {
  const recording = createRecordingBlob(chunks, recorder.mimeType);
  if (recorderRef.current === recorder) recorderRef.current = null;
  stopMediaStream(stream);
  if (!recording) {
    state.setError("No audio was captured. Check the microphone and try again.");
    state.setPhase("ready");
    return;
  }
  state.setBlob(recording);
  state.setAudioUrl(URL.createObjectURL(recording));
  state.setPhase("recorded");
}

function resetRecording(
  recorder: React.MutableRefObject<MediaRecorder | null>,
  state: RecorderState,
): void {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  disposeRecorderRef(recorder);
  state.setUploadOperationId(crypto.randomUUID());
  state.setUploadAttempt(null);
  state.setPhase("ready"); state.setSeconds(0); state.setBlob(null);
  state.setAudioUrl(null); state.setError(null);
}

function cleanupFailedRecording(
  recorder: React.MutableRefObject<MediaRecorder | null>,
  stream: MediaStream | null,
): void {
  if (recorder.current) disposeMediaRecorder(recorder.current);
  if (stream) stopMediaStream(stream);
  recorder.current = null;
}

function disposeRecorderRef(recorder: React.MutableRefObject<MediaRecorder | null>): void {
  disposeMediaRecorder(recorder.current);
  recorder.current = null;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") throw new Error("Recording is not supported");
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  const match = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!match) throw new Error("No supported recording format");
  return match;
}
