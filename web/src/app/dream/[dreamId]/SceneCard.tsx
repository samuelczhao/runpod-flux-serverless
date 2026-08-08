"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import Image from "next/image";
import type { StoryScene, StoryVersion } from "@/lib/domain/story";

export function SceneCard({ dreamId, scene, onStoryChanged }: {
  readonly dreamId: string;
  readonly scene: StoryScene;
  readonly onStoryChanged: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [branchPending, setBranchPending] = useState(false);
  const branchPanelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);
  const branch = scene.versions.find((version) => version.parentVersionId !== null);
  useEffect(() => { if (branchPending) branchPanelRef.current?.focus(); }, [branchPending]);
  useEffect(() => {
    if (!editing && restoreTriggerFocus.current) {
      triggerRef.current?.focus(); restoreTriggerFocus.current = false;
    }
  }, [editing]);
  const cancelEditing = () => { restoreTriggerFocus.current = true; setEditing(false); };
  const branchSubmitted = () => { setBranchPending(true); setEditing(false); };
  return <article className="scene-card">
    <SelectedScene scene={scene} />
    <div className="scene-copy"><span>Scene {scene.ordinal}</span><p>{scene.caption}</p>
      <div className="branch-panel" ref={branchPanelRef} tabIndex={-1}>
        {!branch && !editing && !branchPending ? <button className="scene-edit-trigger"
          onClick={() => setEditing(true)} ref={triggerRef} type="button">Change this scene</button> : null}
        {editing && !branch ? <BranchForm dreamId={dreamId} onCancel={cancelEditing}
          onSubmitted={branchSubmitted} onStoryChanged={onStoryChanged} scene={scene} /> : null}
        {branchPending && !branch ? <p className="branch-status" role="status">
          Alternative rendering on Runpod…</p> : null}
        {branch ? <BranchState branch={branch} onStoryChanged={onStoryChanged} scene={scene} /> : null}
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
    <label htmlFor={`branch-${scene.id}`}>What should change?</label>
    <textarea id={`branch-${scene.id}`} maxLength={1_000} minLength={3} required
      placeholder="Make the doorway open onto the ocean…" value={instruction}
      onChange={(event) => setInstruction(event.target.value)} ref={instructionRef} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div><button className="button ghost" onClick={onCancel} type="button">Cancel</button>
      <button className="button primary" disabled={submitting} type="submit">
        {submitting ? "Creating branch…" : "Generate alternative"}</button></div>
  </form>;
}

function BranchState({ branch, scene, onStoryChanged }: {
  readonly branch: StoryVersion; readonly scene: StoryScene; readonly onStoryChanged: () => void;
}) {
  const selected = scene.versions.find((version) => version.isSelected);
  const alternative = scene.versions.find((version) => version.id !== selected?.id && version.imageUrl);
  if (alternative && selected?.imageUrl) {
    return <><p className="sr-only" aria-live="polite" role="status">Alternative scene ready.</p>
      <BranchComparison sceneId={scene.id} current={selected} alternative={alternative}
        onStoryChanged={onStoryChanged} /></>;
  }
  if (["FAILED", "CANCELLED"].includes(branch.status)) {
    return <p className="branch-status form-error" role="alert">The alternative could not be generated.</p>;
  }
  const message = branch.status === "SUBMIT_UNKNOWN"
    ? "Alternative submission is being reconciled…"
    : "Alternative rendering on Runpod…";
  return <p className="branch-status" aria-live="polite" role="status">{message}</p>;
}

function BranchComparison({ sceneId, current, alternative, onStoryChanged }: {
  readonly sceneId: string; readonly current: StoryVersion; readonly alternative: StoryVersion;
  readonly onStoryChanged: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = () => void chooseVersion(
    sceneId, current.id, alternative.id, setSelecting, setError, onStoryChanged,
  );
  return <div className="branch-comparison">
    <p><strong>Alternative:</strong> {alternative.editInstruction ?? "Scene variation"}</p>
    <Image alt="Alternative dream scene" height={1024} src={alternative.imageUrl!} unoptimized width={1024} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button ghost" disabled={selecting} onClick={choose} type="button">
      {selecting ? "Choosing…" : "Choose this version"}</button>
  </div>;
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
    if (!response.ok) throw new Error("Branch request failed");
    operationId.current = null; onClose();
  } catch {
    setError("The alternative could not be started."); setSubmitting(false);
  }
}

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
    setError("The scene changed elsewhere. Refresh and try again.");
  } finally {
    setSelecting(false);
  }
}
