import Link from "next/link";
import type { ReactElement } from "react";
import type { JournalDream } from "@/lib/database/journal";

interface JournalCardProps {
  readonly dream: JournalDream;
}

export function JournalCard({ dream }: JournalCardProps): ReactElement {
  return (
    <Link className="journal-card" href={`/dream/${dream.id}`}>
      <div className="journal-card-meta"><time dateTime={dream.created_at}>{formatDate(dream.created_at)}</time>
        <span>{journalStatusLabel(dream.status)}</span></div>
      <div className="journal-card-copy"><h2>{dream.title ?? "An unfinished dream"}</h2>
        <p>{dream.summary ?? "The story is still taking shape."}</p>
        {dream.mood.length ? <div aria-label={`Mood: ${dream.mood.join(", ")}`} className="mood-row">
          {dream.mood.map((mood) => <span key={mood}>{mood}</span>)}</div> : null}</div>
    </Link>
  );
}

export function journalStatusLabel(status: JournalDream["status"]): string {
  if (status === "READY") return "Ready";
  if (status === "FAILED") return "Needs attention";
  if (status === "DELETING") return "Removing";
  return "In progress";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(value));
}
