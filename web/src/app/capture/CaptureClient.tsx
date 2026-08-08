"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { AudioCapture } from "@/app/capture/AudioCapture";
import { DreamSelfPicker } from "@/app/capture/DreamSelfPicker";
import { StoryStylePicker } from "@/app/capture/StoryStylePicker";
import {
  DEFAULT_VISUAL_STYLE,
  type VisualStyle,
} from "@/lib/domain/identity";

const createResponseSchema = z.object({ dreamId: z.uuid(), runId: z.string().nullable() }).strict();

export function CaptureClient(): ReactElement {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"speak" | "type">("speak");
  const [audioBusy, setAudioBusy] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityReferenceId, setIdentityReferenceId] = useState<string | null>(null);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
  const textAttempt = useRef<TextAttempt | null>(null);
  const settings = useRef<HTMLDetailsElement>(null);
  const updateAudioBusy = useCallback((busy: boolean) => setAudioBusy(busy), []);
  const updateIdentityBusy = useCallback((busy: boolean) => setIdentityBusy(busy), []);
  const updateIdentity = useCallback((identityId: string | null) => setIdentityReferenceId(identityId), []);
  const revealSettings = useCallback(() => { if (settings.current) settings.current.open = true; }, []);
  useEffect(() => { void prepareAnonymousSession(setReady, setSessionError); }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => void submitCapture(
    event, transcript,
    operationIdFor(textAttempt, transcript, identityReferenceId, visualStyle),
    identityReferenceId, visualStyle,
    (path) => router.push(path), setSubmitting, setError,
  );
  const captureReady = ready && !identityBusy;
  return <><details className="story-settings" ref={settings}><summary><span>Make it feel like yours</span>
      <small>Add your photo or choose an illustration style</small></summary>
    <div className="story-settings-body">
      <DreamSelfPicker onBusyChange={updateIdentityBusy} onChange={updateIdentity}
        onNeedsAttention={revealSettings} ready={ready} />
      <StoryStylePicker onChange={setVisualStyle} value={visualStyle} />
    </div></details>
    <CaptureModeSwitch disabled={audioBusy || identityBusy} mode={mode} setMode={setMode} />
    {sessionError ? <p className="form-error" role="alert">{sessionError}</p> : null}
    {mode === "speak" ? <AudioCapture ready={captureReady} onBusyChange={updateAudioBusy}
      identityReferenceId={identityReferenceId} visualStyle={visualStyle}
      onComplete={(id) => router.push(`/dream/${id}`)} />
      : <CaptureForm ready={captureReady} {...{ transcript, setTranscript, error, submitting, submit }} />}</>;
}

function CaptureModeSwitch({
  mode,
  setMode,
  disabled,
}: {
  readonly mode: "speak" | "type";
  readonly setMode: (mode: "speak" | "type") => void;
  readonly disabled: boolean;
}) {
  return <div className="capture-mode" aria-label="Dream input method" role="group">
    <button aria-pressed={mode === "speak"} disabled={disabled}
      onClick={() => setMode("speak")} type="button">Speak</button>
    <button aria-pressed={mode === "type"} disabled={disabled}
      onClick={() => setMode("type")} type="button">Type</button>
  </div>;
}

interface CaptureFormProps {
  readonly ready: boolean;
  readonly transcript: string;
  readonly setTranscript: (value: string) => void;
  readonly error: string | null;
  readonly submitting: boolean;
  readonly submit: (event: FormEvent<HTMLFormElement>) => void;
}

function CaptureForm(props: CaptureFormProps) {
  return (
    <form className="capture-card" onSubmit={props.submit}>
      <label htmlFor="dream-text">What do you remember?</label>
      <textarea id="dream-text" minLength={10} maxLength={12_000} required
        placeholder="I was walking through a flooded library..."
        value={props.transcript} onChange={(event) => props.setTranscript(event.target.value)} />
      <div className="capture-meta"><span>{props.transcript.length.toLocaleString()} / 12,000</span><span>Private to this journal</span></div>
      {props.error ? <p className="form-error" role="alert">{props.error}</p> : null}
      <button className="button primary" disabled={!props.ready || props.submitting} type="submit">
        {props.submitting ? "Tracing your dream…" : props.ready ? "Create the story" : "Opening a private journal…"}
      </button>
    </form>
  );
}

async function prepareAnonymousSession(
  onReady: (ready: boolean) => void,
  onError: (error: string) => void,
): Promise<void> {
  try {
    const client = createSupabaseBrowserClient();
    const current = await client.auth.getUser();
    if (current.error) throw current.error;
    if (!current.data.user) {
      const created = await client.auth.signInAnonymously();
      if (created.error) throw created.error;
    }
    onReady(true);
  } catch {
    onError("Private journal setup failed. Please refresh and try again.");
  }
}

async function createDream(
  transcript: string,
  operationId: string,
  identityReferenceId: string | null,
  visualStyle: VisualStyle,
) {
  const response = await fetch("/api/dreams", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, operationId, identityReferenceId, visualStyle }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(errorMessage(payload));
  return createResponseSchema.parse(payload);
}

async function submitCapture(
  event: FormEvent<HTMLFormElement>,
  transcript: string,
  operationId: string,
  identityReferenceId: string | null,
  visualStyle: VisualStyle,
  navigate: (path: string) => void,
  setSubmitting: (value: boolean) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  event.preventDefault();
  setSubmitting(true);
  setError(null);
  try {
    navigate(`/dream/${(await createDream(
      transcript, operationId, identityReferenceId, visualStyle,
    )).dreamId}`);
  } catch (cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Dream generation could not start");
    setSubmitting(false);
  }
}

interface TextAttempt {
  readonly requestKey: string;
  readonly operationId: string;
}

function operationIdFor(
  ref: React.RefObject<TextAttempt | null>,
  transcript: string,
  identityReferenceId: string | null,
  visualStyle: VisualStyle,
): string {
  const requestKey = `${transcript.trim()}\u0000${identityReferenceId ?? ""}\u0000${visualStyle}`;
  if (ref.current?.requestKey !== requestKey) {
    ref.current = { requestKey, operationId: crypto.randomUUID() };
  }
  return ref.current.operationId;
}

function errorMessage(payload: unknown): string {
  const parsed = z.object({ error: z.string() }).safeParse(payload);
  return parsed.success ? parsed.data.error : "Dream generation could not start";
}
