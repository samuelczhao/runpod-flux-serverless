"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import { dreamStorySchema, shouldPollDream, type DreamStory } from "@/lib/domain/story";
import { isRetryableHttpStatus } from "@/lib/domain/polling";
import { SceneCard } from "@/app/dream/[dreamId]/SceneCard";

const STAGES = [
  ["PLANNING", "Finding the story"],
  ["GENERATING_ANCHOR", "Remembering the first scene"],
  ["GENERATING_SCENES", "Following the dream"],
  ["READY", "Trace complete"],
] as const;
const STORY_POLL_INTERVAL_MS = 3_000;

export function DreamExperience({ dreamId }: { readonly dreamId: string }): ReactElement {
  const { story, error, refresh } = useDreamStory(dreamId);
  if (error) return <StateMessage title="The trace went quiet" copy={error} />;
  if (!story) return <StateMessage title="Opening the dream" copy="Restoring your private journal…" />;
  if (story.status === "FAILED") return <FailureState story={story} />;
  if (story.awaitingTranscriptReview) return <TranscriptReview story={story} />;
  return story.status === "READY"
    ? <StoryView onStoryChanged={refresh} story={story} />
    : <ProcessingView story={story} />;
}

function TranscriptReview({ story }: { readonly story: DreamStory }) {
  const [transcript, setTranscript] = useState(story.transcript ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => void confirmTranscript(
    event, story.id, transcript, setSubmitting, setError,
  );
  return (
    <section className="transcript-review">
      <p className="eyebrow">Transcription ready</p>
      <h1>Is this what you remember?</h1>
      <p>Correct anything Whisper misheard. Image generation starts only after you confirm.</p>
      <TranscriptForm {...{ transcript, setTranscript, error, submitting, submit }} />
    </section>
  );
}

function TranscriptForm({ transcript, setTranscript, error, submitting, submit }: {
  readonly transcript: string; readonly setTranscript: (value: string) => void;
  readonly error: string | null; readonly submitting: boolean;
  readonly submit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form className="capture-card" onSubmit={submit}>
    <label htmlFor="dream-transcript">Your dream</label>
    <textarea id="dream-transcript" minLength={10} maxLength={12_000} required
      value={transcript} onChange={(event) => setTranscript(event.target.value)} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button primary" disabled={submitting} type="submit">
      {submitting ? "Starting the trace…" : "Confirm and create the story"}
    </button>
  </form>;
}

function ProcessingView({ story }: { readonly story: DreamStory }) {
  return (
    <section className="processing-panel">
      <div className="orb" aria-hidden="true" />
      <p className="eyebrow">Dream in progress</p>
      <h1 aria-live="polite">{stageLabel(story.status)}</h1>
      <p>GPU workers can take a few minutes to wake up. This page will update itself.</p>
      <ol className="stage-list">{STAGES.map(([status, label]) => (
        <li aria-current={story.status === status ? "step" : undefined}
          className={stageClass(story.status, status)} key={status}><span />{label}</li>
      ))}</ol>
    </section>
  );
}

function StoryView({ story, onStoryChanged }: {
  readonly story: DreamStory; readonly onStoryChanged: () => void;
}) {
  return (
    <section className="story-view">
      <header className="story-header"><p className="eyebrow">Your dream trace</p><h1>{story.title}</h1><p>{story.summary}</p>
        <div className="mood-row">{story.mood.map((mood) => <span key={mood}>{mood}</span>)}</div>
      </header>
      <div className="scene-strip">{story.scenes.map((scene) =>
        <SceneCard dreamId={story.id} key={scene.id} onStoryChanged={onStoryChanged} scene={scene} />)}</div>
      <div className="story-actions"><Link className="button ghost" href="/capture">Trace another</Link>
        <Link className="button primary" href="/journal">Open journal</Link></div>
    </section>
  );
}

function FailureState({ story }: { readonly story: DreamStory }) {
  return <StateMessage title="The trace broke apart"
    copy={`Generation stopped during ${story.failedStage ?? "processing"}. No duplicate paid request was submitted.`} />;
}

function StateMessage({ title, copy }: { readonly title: string; readonly copy: string }) {
  return <section className="processing-panel"><p className="eyebrow">DreamTrace</p><h1>{title}</h1><p>{copy}</p>
    <Link className="button ghost" href="/capture">Return to capture</Link></section>;
}

function useDreamStory(dreamId: string): {
  story: DreamStory | null; error: string | null; refresh: () => void;
} {
  const [story, setStory] = useState<DreamStory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRefresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(() => void poll(), STORY_POLL_INTERVAL_MS); };
    const poll = async () => {
      try {
        const next = await fetchDream(dreamId);
        if (!active) return;
        setStory(next); setError(null);
        if (shouldPollDream(next)) schedule();
      } catch (cause: unknown) {
        if (!active) return;
        setError("The private story could not be loaded.");
        if (shouldRetryStoryError(cause)) schedule();
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [dreamId, refreshKey]);
  return { story, error, refresh: requestRefresh };
}

async function fetchDream(dreamId: string): Promise<DreamStory> {
  const response = await fetch(`/api/dreams/${dreamId}`, { cache: "no-store" });
  if (!response.ok) throw new DreamRequestError(response.status);
  try {
    return dreamStorySchema.parse(await response.json() as unknown);
  } catch (cause: unknown) {
    throw new DreamPayloadError("Dream response was invalid", { cause });
  }
}

function shouldRetryStoryError(error: unknown): boolean {
  if (error instanceof DreamPayloadError) return false;
  return !(error instanceof DreamRequestError) || isRetryableHttpStatus(error.status);
}

class DreamRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`Dream request failed with HTTP ${status}`);
  }
}

class DreamPayloadError extends Error {}

async function confirmTranscript(
  event: FormEvent<HTMLFormElement>,
  dreamId: string,
  transcript: string,
  setSubmitting: (value: boolean) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  event.preventDefault();
  setSubmitting(true);
  setError(null);
  if (await requestTranscriptConfirmation(dreamId, transcript)) return;
  setError("The corrected transcript could not be confirmed.");
  setSubmitting(false);
}

async function requestTranscriptConfirmation(dreamId: string, transcript: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/dreams/${dreamId}/transcript`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function stageLabel(status: DreamStory["status"]): string {
  return STAGES.find(([value]) => value === status)?.[1] ?? "Preparing the trace";
}

function stageClass(current: DreamStory["status"], candidate: string): string {
  const currentIndex = STAGES.findIndex(([value]) => value === current);
  const candidateIndex = STAGES.findIndex(([value]) => value === candidate);
  return candidateIndex < currentIndex ? "done" : candidateIndex === currentIndex ? "active" : "";
}
