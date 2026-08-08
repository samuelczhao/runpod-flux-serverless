import Link from "next/link";
import type { ReactElement } from "react";
import type { JournalDream } from "@/lib/database/journal";

interface JournalCardProps {
  readonly dream: JournalDream;
}

export function JournalCard({ dream }: JournalCardProps): ReactElement {
  return (
    <Link className="journal-card" href={`/dream/${dream.id}`}>
      <span>{formatDate(dream.created_at)} · {dream.status.replaceAll("_", " ")}</span>
      <h2>{dream.title ?? "An unfinished dream"}</h2>
      <p>{dream.summary ?? "The story is still taking shape."}</p>
      <div className="mood-row">{dream.mood.map((mood) => <span key={mood}>{mood}</span>)}</div>
    </Link>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(value));
}
