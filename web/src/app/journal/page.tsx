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
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><Link href="/capture">New trace</Link></header>
      <section className="journal-header"><p className="eyebrow">Private journal</p><h1>The places<br />you return to.</h1>
        <p>Every trace remains isolated to this browser journal.</p></section>
      <JournalConstellation dreams={journal.constellationDreams} />
      {journal.dreams.length ? <div className="journal-grid">{journal.dreams.map((dream) => <JournalCard dream={dream} key={dream.id} />)}</div>
        : <EmptyJournal />}
    </main>
  );
}

function EmptyJournal(): ReactElement {
  return <section className="empty-journal"><p>No dreams have been traced in this journal yet.</p>
    <Link className="button primary" href="/capture">Trace the first one</Link></section>;
}
