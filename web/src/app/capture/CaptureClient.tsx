"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { AudioCapture } from "@/app/capture/AudioCapture";

const createResponseSchema = z.object({ dreamId: z.uuid(), runId: z.string() }).strict();

export function CaptureClient() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"speak" | "type">("speak");
  useEffect(() => { void prepareAnonymousSession(setReady, setError); }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => void submitCapture(
    event, transcript, (path) => router.push(path), setSubmitting, setError,
  );
  return <><CaptureModeSwitch mode={mode} setMode={setMode} />
    {mode === "speak" ? <AudioCapture ready={ready} onComplete={(id) => router.push(`/dream/${id}`)} />
      : <CaptureForm {...{ ready, transcript, setTranscript, error, submitting, submit }} />}</>;
}

function CaptureModeSwitch({
  mode,
  setMode,
}: {
  readonly mode: "speak" | "type";
  readonly setMode: (mode: "speak" | "type") => void;
}) {
  return <div className="capture-mode" aria-label="Dream input method" role="group">
    <button aria-pressed={mode === "speak"} onClick={() => setMode("speak")} type="button">Speak</button>
    <button aria-pressed={mode === "type"} onClick={() => setMode("type")} type="button">Type</button>
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
  const client = createSupabaseBrowserClient();
  const current = await client.auth.getUser();
  if (!current.data.user) {
    const created = await client.auth.signInAnonymously();
    if (created.error) return onError("Private journal setup failed. Please refresh and try again.");
  }
  onReady(true);
}

async function createDream(transcript: string) {
  const response = await fetch("/api/dreams", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(errorMessage(payload));
  return createResponseSchema.parse(payload);
}

async function submitCapture(
  event: FormEvent<HTMLFormElement>,
  transcript: string,
  navigate: (path: string) => void,
  setSubmitting: (value: boolean) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  event.preventDefault();
  setSubmitting(true);
  setError(null);
  try {
    navigate(`/dream/${(await createDream(transcript)).dreamId}`);
  } catch (cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Dream generation could not start");
    setSubmitting(false);
  }
}

function errorMessage(payload: unknown): string {
  const parsed = z.object({ error: z.string() }).safeParse(payload);
  return parsed.success ? parsed.data.error : "Dream generation could not start";
}
