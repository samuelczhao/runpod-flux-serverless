import Link from "next/link";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { loadJournal } from "@/lib/database/journal";
import { JournalCard } from "@/app/journal/JournalCard";
import { JournalConstellation } from "@/app/journal/JournalConstellation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dream Journal | DreamTrace",
  description: "Explore completed dreams and the recurring motifs that connect them.",
};

export default async function JournalPage(): Promise<ReactElement> {
  const journal = await loadJournal();
  return (
    <main className="shell inner-page">
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><Link href="/capture">New entry</Link></header>
      <section className="journal-header"><p className="eyebrow">Private journal</p><h1>Your dreams, over time.</h1>
        <p>Every entry stays private to this browser journal.</p></section>
      <section aria-labelledby="entries-title" className="journal-entries">
        <header className="section-heading"><h2 id="entries-title">Entries</h2>
          <span>{entryCount(journal.dreams.length)}</span></header>
        {journal.dreams.length ? <div className="journal-grid">{journal.dreams.map((dream) => <JournalCard dream={dream} key={dream.id} />)}</div>
          : <EmptyJournal />}
      </section>
      <JournalConstellation dreams={journal.constellationDreams} />
    </main>
  );
}

function EmptyJournal(): ReactElement {
  return <section className="empty-journal"><p>Your first remembered dream will appear here.</p>
    <Link className="button primary" href="/capture">Record a dream</Link></section>;
}

function entryCount(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}
