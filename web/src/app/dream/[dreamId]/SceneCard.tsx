"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import Image from "next/image";
import type { StoryScene, StoryVersion } from "@/lib/domain/story";

export function SceneCard({ dreamId, scene, totalMoments, onStoryChanged }: {
  readonly dreamId: string;
  readonly scene: StoryScene;
  readonly totalMoments: number;
  readonly onStoryChanged: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [pendingAfter, setPendingAfter] = useState<{ readonly branchId: string | null } | null>(null);
  const branchPanelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);
  const branch = scene.versions.filter((version) => version.parentVersionId !== null).at(-1);
  const retryable = branch ? isRetryableBranch(branch) : false;
  const branchPending = pendingAfter !== null && pendingAfter.branchId === (branch?.id ?? null);
  useEffect(() => { if (branchPending) branchPanelRef.current?.focus(); }, [branchPending]);
  useEffect(() => {
    if (!editing && restoreTriggerFocus.current) {
      triggerRef.current?.focus(); restoreTriggerFocus.current = false;
    }
  }, [editing]);
  const cancelEditing = () => { restoreTriggerFocus.current = true; setEditing(false); };
  const branchSubmitted = () => { setPendingAfter({ branchId: branch?.id ?? null }); setEditing(false); };
  return <article className="story-moment">
    <div className="moment-image"><SelectedScene scene={scene} /></div>
    <div className="moment-copy"><p className="moment-number">Moment {scene.ordinal}
      <span> of {totalMoments}</span></p><p className="moment-caption">{scene.caption}</p>
      <div className="branch-panel" ref={branchPanelRef} tabIndex={-1}>
        {!branch && !editing && !branchPending ? <button className="scene-edit-trigger"
          onClick={() => setEditing(true)} ref={triggerRef} type="button">Try a different version</button> : null}
        {editing && (!branch || retryable) ? <BranchForm dreamId={dreamId} onCancel={cancelEditing}
          onSubmitted={branchSubmitted} onStoryChanged={onStoryChanged} scene={scene} /> : null}
        {branchPending ? <p className="branch-status" role="status">
          Making another version…</p> : null}
        {branch && !branchPending && !editing ? <BranchState branch={branch}
          onRetry={() => setEditing(true)} onStoryChanged={onStoryChanged}
          retryRef={triggerRef} scene={scene} /> : null}
      </div>
    </div>
  </article>;
}

function SelectedScene({ scene }: { readonly scene: StoryScene }) {
  return scene.imageUrl
    ? <Image alt={scene.caption} height={1024} src={scene.imageUrl} unoptimized width={1024} />
    : <div className="image-placeholder" />;
}

function BranchForm({ dreamId, scene, onCancel, onSubmitted, onStoryChanged }: {
  readonly dreamId: string; readonly scene: StoryScene; readonly onCancel: () => void;
  readonly onStoryChanged: () => void; readonly onSubmitted: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { instructionRef.current?.focus(); }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => void submitBranch(
    event, dreamId, scene, instruction, operationId, setSubmitting, setError,
    () => { onSubmitted(); onStoryChanged(); },
  );
  return <form className="branch-form" onSubmit={submit}>
    <label htmlFor={`branch-${scene.id}`}>What would you like to change?</label>
    <textarea id={`branch-${scene.id}`} maxLength={1_000} minLength={3} required
      placeholder="Make the doorway open onto the ocean…" value={instruction}
      onChange={(event) => setInstruction(event.target.value)} ref={instructionRef} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div><button className="button ghost" onClick={onCancel} type="button">Cancel</button>
      <button className="button primary" disabled={submitting} type="submit">
        {submitting ? "Starting…" : "Make another version"}</button></div>
  </form>;
}

function BranchState({ branch, scene, onRetry, onStoryChanged, retryRef }: {
  readonly branch: StoryVersion; readonly scene: StoryScene; readonly onRetry: () => void;
  readonly onStoryChanged: () => void;
  readonly retryRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const selected = scene.versions.find((version) => version.isSelected);
  const alternative = scene.versions.find((version) => version.id !== selected?.id && version.imageUrl);
  if (alternative && selected?.imageUrl) {
    return <><p className="sr-only" aria-live="polite" role="status">
      {alternativeLabel(alternative)} ready.</p>
      <BranchComparison sceneId={scene.id} current={selected} alternative={alternative}
        onStoryChanged={onStoryChanged} /></>;
  }
  if (isRetryableBranch(branch)) {
    return <><p className="branch-status form-error" role="alert">We couldn’t make the new version.</p>
      <button className="scene-edit-trigger" onClick={onRetry} ref={retryRef} type="button">
        Try another edit</button></>;
  }
  if (branch.status === "SUBMIT_UNKNOWN") {
    return <p className="branch-status form-error" role="alert">
      We couldn’t confirm that the new version started. Your current moment is safe.</p>;
  }
  return <p className="branch-status" aria-live="polite" role="status">
    Making another version…</p>;
}

function isRetryableBranch(branch: StoryVersion): boolean {
  return branch.status === "FAILED" || branch.status === "CANCELLED";
}

function BranchComparison({ sceneId, current, alternative, onStoryChanged }: {
  readonly sceneId: string; readonly current: StoryVersion; readonly alternative: StoryVersion;
  readonly onStoryChanged: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = alternativeLabel(alternative);
  const description = alternative.parentVersionId
    ? alternative.editInstruction ?? "A different take on this moment"
    : "The first version of this moment";
  const choose = () => void chooseVersion(
    sceneId, current.id, alternative.id, setSelecting, setError, onStoryChanged,
  );
  return <div className="branch-comparison">
    <p><strong>{label}:</strong> {description}</p>
    <Image alt={`${label} of this dream moment`} height={1024} src={alternative.imageUrl!}
      unoptimized width={1024} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button ghost" disabled={selecting} onClick={choose} type="button">
      {selecting ? "Saving…" : `Use ${label.toLowerCase()}`}</button>
  </div>;
}

function alternativeLabel(version: StoryVersion): "New version" | "Original version" {
  return version.parentVersionId ? "New version" : "Original version";
}

async function submitBranch(
  event: FormEvent<HTMLFormElement>, dreamId: string, scene: StoryScene, instruction: string,
  operationId: React.MutableRefObject<string | null>, setSubmitting: (value: boolean) => void,
  setError: (value: string | null) => void, onClose: () => void,
): Promise<void> {
  event.preventDefault(); setSubmitting(true); setError(null);
  operationId.current ??= crypto.randomUUID();
  try {
    const response = await requestBranch(dreamId, scene, instruction, operationId.current);
    if (!response.ok) throw new BranchRequestError(await branchErrorMessage(response));
    operationId.current = null; onClose();
  } catch (cause: unknown) {
    setError(cause instanceof BranchRequestError
      ? cause.message : "The new version could not be started.");
    setSubmitting(false);
  }
}

async function branchErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { readonly error?: unknown };
    return typeof payload.error === "string" && payload.error
      ? payload.error : "The new version could not be started.";
  } catch {
    return "The new version could not be started.";
  }
}

class BranchRequestError extends Error {}

function requestBranch(
  dreamId: string,
  scene: StoryScene,
  instruction: string,
  operationId: string,
): Promise<Response> {
  return fetch(`/api/scenes/${scene.id}/branches`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dreamId, parentVersionId: scene.versionId, instruction, operationId }),
  });
}

async function chooseVersion(
  sceneId: string, expectedVersionId: string, nextVersionId: string,
  setSelecting: (value: boolean) => void, setError: (value: string | null) => void,
  onStoryChanged: () => void,
): Promise<void> {
  setSelecting(true); setError(null);
  try {
    const response = await fetch(`/api/scenes/${sceneId}/selection`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersionId, nextVersionId }),
    });
    if (!response.ok) throw new Error("Selection request failed");
    onStoryChanged();
  } catch {
    setError("This moment changed elsewhere. Refresh and try again.");
  } finally {
    setSelecting(false);
  }
}
