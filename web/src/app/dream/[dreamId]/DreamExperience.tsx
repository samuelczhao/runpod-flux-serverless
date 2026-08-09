"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import Link from "next/link";
import {
  dreamStorySchema,
  mergeStoryPollResult,
  planDreamPoll,
  type DreamPollPlan,
  type DreamStory,
} from "@/lib/domain/story";
import { isRetryableHttpStatus } from "@/lib/domain/polling";
import { SceneCard } from "@/app/dream/[dreamId]/SceneCard";

type ProgressStage = readonly [DreamStory["status"], string];

const STORY_STAGES: readonly ProgressStage[] = [
  ["PLANNING", "Reading your dream"],
  ["GENERATING_ANCHOR", "Beginning the story"],
  ["GENERATING_SCENES", "Bringing each moment to life"],
  ["READY", "Your story is ready"],
];
const AUDIO_STAGE: ProgressStage = ["TRANSCRIBING", "Listening to your recording"];
const STORY_POLL_INTERVAL_MS = 3_000;

export function DreamExperience({ dreamId }: { readonly dreamId: string }): ReactElement {
  const { story, error, refresh } = useDreamStory(dreamId);
  if (error && (!story || !error.retrying)) {
    return <StateMessage title="The story went quiet" copy={error.message} />;
  }
  if (!story) return <StateMessage title="Opening your dream" copy="Restoring your private journal…" />;
  const content = story.status === "FAILED" ? <FailureState />
    : story.awaitingTranscriptReview ? <TranscriptReview story={story} />
      : story.status === "READY" ? <StoryView onStoryChanged={refresh} story={story} />
        : <ProcessingView story={story} />;
  return <><p aria-live="polite" className="sr-only">{stageLabel(story.status)}</p>
    {error ? <p className="poll-warning" role="status">Connection interrupted. Retrying…</p> : null}
    {content}</>;
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
      <p>Correct anything we misheard. Your visual story begins after you confirm.</p>
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
      {submitting ? "Starting your story…" : "Confirm and create the story"}
    </button>
  </form>;
}

function ProcessingView({ story }: { readonly story: DreamStory }) {
  const progress = storyProgress(story);
  const stages = story.inputMode === "audio" ? [AUDIO_STAGE, ...STORY_STAGES] : STORY_STAGES;
  return (
    <section className="processing-panel">
      <div className="processing-rule" aria-hidden="true" />
      <p className="eyebrow">Your entry is in progress</p>
      <h1 aria-live="polite">{progress.title}</h1>
      <p>{progress.copy}</p>
      <ol className="stage-list">{stages.map(([status, label]) => (
        <li aria-current={story.status === status ? "step" : undefined}
          className={stageClass(story.status, status, stages)} key={status}><span />{label}</li>
      ))}</ol>
    </section>
  );
}

function StoryView({ story, onStoryChanged }: {
  readonly story: DreamStory; readonly onStoryChanged: () => void;
}) {
  return (
    <section className="story-view">
      <header className="story-header"><p className="eyebrow">Dream journal</p><h1>{story.title}</h1><p>{story.summary}</p>
        <div aria-label={`Mood: ${story.mood.join(", ")}`} className="mood-row">
          {story.mood.map((mood) => <span key={mood}>{mood}</span>)}</div>
      </header>
      <div className="story-sequence">{story.scenes.map((scene) =>
        <SceneCard dreamId={story.id} key={scene.id} onStoryChanged={onStoryChanged}
          scene={scene} totalMoments={story.scenes.length} />)}</div>
      <div className="story-actions"><Link className="button ghost" href="/capture">Record another dream</Link>
        <Link className="button primary" href="/journal">Open journal</Link></div>
    </section>
  );
}

function FailureState() {
  return <StateMessage title="We couldn’t finish this story"
    copy="Your dream is still saved in your journal. You can return to it or record another." />;
}

function StateMessage({ title, copy }: { readonly title: string; readonly copy: string }) {
  return <section className="processing-panel"><p className="eyebrow">DreamTrace</p><h1>{title}</h1><p>{copy}</p>
    <Link className="button ghost" href="/capture">Record a dream</Link></section>;
}

function useDreamStory(dreamId: string): {
  story: DreamStory | null; error: StoryLoadError | null; refresh: () => void;
} {
  const [story, setStory] = useState<DreamStory | null>(null);
  const [error, setError] = useState<StoryLoadError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRefresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const schedule = (plan: DreamPollPlan) => {
      timer = window.setTimeout(() => void poll(plan.preserveImageUrls), plan.delayMs);
    };
    const poll = async (preserveImageUrls: boolean) => {
      try {
        const next = await fetchDream(dreamId);
        if (!active) return;
        setStory((current) => mergeStoryPollResult(current, next, preserveImageUrls));
        setError(null);
        const plan = planDreamPoll(next);
        if (plan) schedule(plan);
      } catch (cause: unknown) {
        if (!active) return;
        const retrying = shouldRetryStoryError(cause);
        setError({ message: "The private story could not be loaded.", retrying });
        if (retrying) schedule({ delayMs: STORY_POLL_INTERVAL_MS, preserveImageUrls });
      }
    };
    void poll(false);
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

interface StoryLoadError {
  readonly message: string;
  readonly retrying: boolean;
}

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
  if (status === AUDIO_STAGE[0]) return AUDIO_STAGE[1];
  return STORY_STAGES.find(([value]) => value === status)?.[1] ?? "Preparing your story";
}

export function storyProgress(story: Pick<DreamStory, "status" | "scenes">): {
  readonly title: string;
  readonly copy: string;
} {
  const total = story.scenes.length;
  const completed = story.scenes.filter((scene) => scene.imageUrl).length;
  if (story.status === "GENERATING_ANCHOR" && total > 0) {
    return momentProgress(1, total);
  }
  if (story.status === "GENERATING_SCENES" && total > 0) {
    return momentProgress(Math.min(completed + 1, total), total);
  }
  return {
    title: stageLabel(story.status),
    copy: "You can leave this page. Your story will keep taking shape in your journal.",
  };
}

function momentProgress(current: number, total: number): { readonly title: string; readonly copy: string } {
  return {
    title: `Creating moment ${current} of ${total}`,
    copy: "You can leave this page. Your story will keep taking shape in your journal.",
  };
}

function stageClass(
  current: DreamStory["status"],
  candidate: DreamStory["status"],
  stages: readonly ProgressStage[],
): string {
  const currentIndex = stages.findIndex(([value]) => value === current);
  const candidateIndex = stages.findIndex(([value]) => value === candidate);
  if (currentIndex < 0) return candidateIndex === 0 ? "active" : "";
  return candidateIndex < currentIndex ? "done" : candidateIndex === currentIndex ? "active" : "";
}
