"use client";

import { useEffect, useRef, type ReactElement } from "react";
import {
  useDreamRecorder,
  type DreamRecorder,
  type RecorderPhase,
} from "@/app/capture/useDreamRecorder";
import { uploadDreamRecording } from "@/app/capture/audioUpload";

export function AudioCapture({
  ready,
  onComplete,
  onBusyChange,
}: {
  readonly ready: boolean;
  readonly onComplete: (dreamId: string) => void;
  readonly onBusyChange: (busy: boolean) => void;
}): ReactElement {
  const recorder = useDreamRecorder();
  useEffect(() => {
    onBusyChange(recorder.phase === "uploading");
    return () => onBusyChange(false);
  }, [onBusyChange, recorder.phase]);
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
    <section className="capture-card audio-capture">
      <AudioHeader phase={recorder.phase} seconds={recorder.seconds} />
      {recorder.audioUrl ? <audio controls src={recorder.audioUrl}>Audio playback is not supported.</audio> : null}
      {recorder.error ? <p className="form-error" role="alert">{recorder.error}</p> : null}
      <AudioActions ready={ready} recorder={recorder} submit={submit} />
      <p className="audio-note">Up to three minutes. The source recording is deleted after its private upload link expires.</p>
    </section>
  );
}

function AudioActions({ ready, recorder, submit }: {
  readonly ready: boolean; readonly recorder: DreamRecorder; readonly submit: () => void;
}) {
  const actionRef = useAudioActionFocus(recorder.phase);
  return <div className="audio-actions">
    {recorder.phase === "ready" ? <button className="record-button" disabled={!ready}
      onClick={recorder.start} ref={actionRef} type="button"><span aria-hidden="true" />Record dream</button> : null}
    {recorder.phase === "starting" ? <button className="record-button" disabled type="button">
      <span aria-hidden="true" />Opening microphone…</button> : null}
    {recorder.phase === "recording" ? <button className="button primary" onClick={recorder.stop} ref={actionRef}
      type="button">Stop recording</button> : null}
    {recorder.phase === "recorded" ? <><button className="button ghost" onClick={recorder.reset}
      type="button">Record again</button><button className="button primary" onClick={submit} ref={actionRef}
      type="button">Transcribe recording</button></> : null}
    {recorder.phase === "uploading" ? <button className="button primary" disabled type="button">
      Sending to private transcription…</button> : null}
  </div>;
}

function useAudioActionFocus(phase: RecorderPhase): React.RefObject<HTMLButtonElement | null> {
  const actionRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef<RecorderPhase>(phase);
  useEffect(() => {
    const returningFromCapture = phase === "ready" && previousPhase.current !== "ready";
    if (returningFromCapture || phase === "recording" || phase === "recorded") {
      actionRef.current?.focus();
    }
    previousPhase.current = phase;
  }, [phase]);
  return actionRef;
}

function AudioHeader({ phase, seconds }: { readonly phase: RecorderPhase; readonly seconds: number }) {
  const label = phase === "recording" ? "Recording"
    : phase === "starting" ? "Opening microphone"
    : phase === "recorded" ? "Recording ready"
      : phase === "uploading" ? "Sending for transcription" : "Speak what you remember";
  return <div className="audio-header"><span className={phase === "recording" ? "live-dot" : ""} />
    <h2><span aria-live="polite">{label}</span>{phase === "recording"
      ? <span aria-hidden="true"> · {formatDuration(seconds)}</span> : null}</h2></div>;
}

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
