"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import type { StoryScene, StoryVersion } from "@/lib/domain/story";

export function SceneCard({ dreamId, scene }: {
  readonly dreamId: string;
  readonly scene: StoryScene;
}) {
  const [editing, setEditing] = useState(false);
  const branch = scene.versions.find((version) => version.parentVersionId !== null);
  return <article className="scene-card">
    <SelectedScene scene={scene} />
    <div className="scene-copy"><span>Scene {scene.ordinal}</span><p>{scene.caption}</p>
      {!branch && !editing ? <button className="scene-edit-trigger" onClick={() => setEditing(true)}
        type="button">Change this scene</button> : null}
      {editing ? <BranchForm dreamId={dreamId} scene={scene} onClose={() => setEditing(false)} /> : null}
      {branch ? <BranchState branch={branch} scene={scene} /> : null}
    </div>
  </article>;
}

function SelectedScene({ scene }: { readonly scene: StoryScene }) {
  return scene.imageUrl
    ? <Image alt={scene.caption} height={1024} src={scene.imageUrl} unoptimized width={1024} />
    : <div className="image-placeholder" />;
}

function BranchForm({ dreamId, scene, onClose }: {
  readonly dreamId: string; readonly scene: StoryScene; readonly onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => void submitBranch(
    event, dreamId, scene, instruction, operationId, setSubmitting, setError, onClose,
  );
  return <form className="branch-form" onSubmit={submit}>
    <label htmlFor={`branch-${scene.id}`}>What should change?</label>
    <textarea id={`branch-${scene.id}`} maxLength={1_000} minLength={3} required
      placeholder="Make the doorway open onto the ocean…" value={instruction}
      onChange={(event) => setInstruction(event.target.value)} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div><button className="button ghost" onClick={onClose} type="button">Cancel</button>
      <button className="button primary" disabled={submitting} type="submit">
        {submitting ? "Creating branch…" : "Generate alternative"}</button></div>
  </form>;
}

function BranchState({ branch, scene }: { readonly branch: StoryVersion; readonly scene: StoryScene }) {
  const selected = scene.versions.find((version) => version.isSelected);
  const alternative = scene.versions.find((version) => version.id !== selected?.id && version.imageUrl);
  if (alternative && selected?.imageUrl) {
    return <BranchComparison sceneId={scene.id} current={selected} alternative={alternative} />;
  }
  if (["FAILED", "CANCELLED", "SUBMIT_UNKNOWN"].includes(branch.status)) {
    return <p className="branch-status form-error">The alternative could not be generated.</p>;
  }
  return <p className="branch-status">Alternative rendering on Runpod…</p>;
}

function BranchComparison({ sceneId, current, alternative }: {
  readonly sceneId: string; readonly current: StoryVersion; readonly alternative: StoryVersion;
}) {
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = () => void chooseVersion(sceneId, current.id, alternative.id, setSelecting, setError);
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
  const response = await fetch(`/api/scenes/${scene.id}/branches`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dreamId, parentVersionId: scene.versionId, instruction, operationId: operationId.current }),
  });
  if (!response.ok) { setError("The alternative could not be started."); setSubmitting(false); return; }
  operationId.current = null; onClose();
}

async function chooseVersion(
  sceneId: string, expectedVersionId: string, nextVersionId: string,
  setSelecting: (value: boolean) => void, setError: (value: string | null) => void,
): Promise<void> {
  setSelecting(true); setError(null);
  const response = await fetch(`/api/scenes/${sceneId}/selection`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersionId, nextVersionId }),
  });
  if (!response.ok) setError("The scene changed elsewhere. Refresh and try again.");
  setSelecting(false);
}
