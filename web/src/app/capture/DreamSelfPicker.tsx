"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import {
  deleteDreamSelf,
  loadDreamSelf,
  uploadDreamSelf,
  type DreamSelf,
} from "@/app/capture/identityUpload";

export function DreamSelfPicker({
  ready,
  onChange,
  onBusyChange,
  onNeedsAttention,
}: {
  readonly ready: boolean;
  readonly onChange: (identityId: string | null) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onNeedsAttention: () => void;
}): ReactElement {
  const [dreamSelf, setDreamSelf] = useState<DreamSelf | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadBlocked, setLoadBlocked] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fileKey: string; operationId: string } | null>(null);
  useEffect(() => {
    onBusyChange(busy || loading || loadBlocked);
    return () => onBusyChange(false);
  }, [busy, loadBlocked, loading, onBusyChange]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void loadDreamSelf().then((value) => {
      if (!active) return;
      setDreamSelf(value);
      onChange(value?.id ?? null);
      setError(null);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError("Your saved photo could not be loaded.");
      setLoadBlocked(true);
      setLoading(false);
      onNeedsAttention();
    });
    return () => { active = false; };
  }, [loadAttempt, onChange, onNeedsAttention, ready]);
  const select = (event: ChangeEvent<HTMLInputElement>) => void handleSelection(
    event, consented, attempt, setBusy, setError, (value) => {
      setDreamSelf(value); setReplacing(false); setConsented(false); onChange(value.id);
    },
  );
  const remove = () => dreamSelf && void handleRemoval(
    dreamSelf.id, setBusy, setError, () => {
      setDreamSelf(null); setConfirmingRemoval(false); onChange(null);
    },
  );
  const chooseDisabled = !ready || loading || loadBlocked || !consented || busy;
  const showPicker = !dreamSelf || replacing;
  return <section aria-busy={busy || loading} className="dream-self" aria-labelledby="dream-self-title">
    <div className="dream-self-heading"><div><p className="eyebrow">Optional</p>
      <h2 id="dream-self-title">Step into your dream</h2>
      <p>Add one clear photo and the person saying “I” in your dream will look like you.</p></div>
      {dreamSelf ? <Image alt="Your Dream Self" className="dream-self-preview" height={160}
        src={dreamSelf.previewUrl} unoptimized width={160} /> : null}</div>
    {loading ? <p className="quiet-status" role="status">Looking for a saved photo…</p> : null}
    {dreamSelf && !replacing ? <div className="dream-self-actions">
      <span>Your photo is ready for future stories.</span>
      {confirmingRemoval ? <><button className="text-button" disabled={busy}
        onClick={() => setConfirmingRemoval(false)} type="button">Keep photo</button>
        <button className="text-button danger" disabled={busy} onClick={remove} type="button">
          {busy ? "Removing…" : "Yes, remove it"}</button></>
        : <><button className="text-button" disabled={busy}
          onClick={() => setReplacing(true)} type="button">Replace photo</button>
        <button className="text-button danger" disabled={busy}
          onClick={() => setConfirmingRemoval(true)} type="button">Remove photo</button></>}
    </div> : null}
    {showPicker ? <><label className="consent-row"><input checked={consented}
        onChange={(event) => setConsented(event.target.checked)} type="checkbox" />
        <span>This is me, or I have permission to use this person’s photo.</span></label>
        <label className={`photo-picker${chooseDisabled ? " disabled" : ""}`}>
          <span>{busy ? "Preparing your photo…" : "Choose a photo"}</span>
          <input accept="image/jpeg,image/png,image/webp" disabled={chooseDisabled}
            onChange={select} type="file" />
        </label>{replacing ? <button className="text-button" disabled={busy}
          onClick={() => { setReplacing(false); setConsented(false); }} type="button">
          Keep current photo</button> : null}</> : null}
    <p className="privacy-note">Your original upload is stripped of metadata and deleted after a private copy is prepared. A short-lived private link is shared with the image service only while your story is made. The private copy is scheduled for deletion after 30 days. Removing it sooner does not remove finished story images.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loadBlocked ? <div className="dream-self-actions">
      <button className="text-button" onClick={() => {
        setLoading(true); setLoadBlocked(false); setError(null);
        setLoadAttempt((value) => value + 1);
      }} type="button">Try loading again</button>
      <button className="text-button" onClick={() => {
        setLoadBlocked(false); setError(null); onChange(null);
      }} type="button">Continue without a photo</button></div> : null}
  </section>;
}

async function handleSelection(
  event: ChangeEvent<HTMLInputElement>,
  consented: boolean,
  attempt: React.MutableRefObject<{ fileKey: string; operationId: string } | null>,
  setBusy: (value: boolean) => void,
  setError: (value: string | null) => void,
  onComplete: (value: DreamSelf) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  if (!file || !consented) return;
  const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
  if (attempt.current?.fileKey !== fileKey) {
    attempt.current = { fileKey, operationId: crypto.randomUUID() };
  }
  setBusy(true); setError(null);
  try {
    onComplete(await uploadDreamSelf(file, attempt.current.operationId));
    attempt.current = null;
  } catch (error: unknown) {
    setError(error instanceof Error ? error.message : "Your photo could not be prepared.");
  } finally {
    setBusy(false); event.target.value = "";
  }
}

async function handleRemoval(
  identityId: string,
  setBusy: (value: boolean) => void,
  setError: (value: string | null) => void,
  onComplete: () => void,
): Promise<void> {
  setBusy(true); setError(null);
  try {
    await deleteDreamSelf(identityId);
    onComplete();
  } catch (error: unknown) {
    setError(error instanceof Error ? error.message : "Your photo could not be removed.");
  } finally {
    setBusy(false);
  }
}
