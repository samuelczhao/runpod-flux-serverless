import Link from "next/link";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseDatabaseRows, throwIfDatabaseError } from "@/lib/database/errors";

export const dynamic = "force-dynamic";

const journalDreamSchema = z.object({
  id: z.uuid(), title: z.string().nullable(), summary: z.string().nullable(),
  status: z.string(), mood: z.array(z.string()), created_at: z.string(),
}).strict();

export default async function JournalPage() {
  const dreams = await loadJournalDreams();
  return (
    <main className="shell inner-page">
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><Link href="/capture">New trace</Link></header>
      <section className="journal-header"><p className="eyebrow">Private journal</p><h1>The places<br />you return to.</h1>
        <p>Every trace remains isolated to this browser journal.</p></section>
      {dreams.length ? <div className="journal-grid">{dreams.map((dream) => <JournalCard dream={dream} key={dream.id} />)}</div>
        : <EmptyJournal />}
    </main>
  );
}

function JournalCard({ dream }: { readonly dream: z.infer<typeof journalDreamSchema> }) {
  return (
    <Link className="journal-card" href={`/dream/${dream.id}`}>
      <span>{formatDate(dream.created_at)} · {dream.status.replaceAll("_", " ")}</span>
      <h2>{dream.title ?? "An unfinished dream"}</h2>
      <p>{dream.summary ?? "The story is still taking shape."}</p>
      <div className="mood-row">{dream.mood.map((mood) => <span key={mood}>{mood}</span>)}</div>
    </Link>
  );
}

function EmptyJournal() {
  return <section className="empty-journal"><p>No dreams have been traced in this journal yet.</p>
    <Link className="button primary" href="/capture">Trace the first one</Link></section>;
}

async function loadJournalDreams(): Promise<z.infer<typeof journalDreamSchema>[]> {
  const client = await createSupabaseServerClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return [];
  const result = await client.from("dreams").select("id,title,summary,status,mood,created_at")
    .neq("status", "DELETING").order("created_at", { ascending: false }).limit(50);
  throwIfDatabaseError(result.error);
  return parseDatabaseRows(journalDreamSchema, result.data);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
