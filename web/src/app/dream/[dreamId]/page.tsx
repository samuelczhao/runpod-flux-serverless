import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { DreamExperience } from "@/app/dream/[dreamId]/DreamExperience";

interface DreamPageProps {
  readonly params: Promise<{ dreamId: string }>;
}

export default async function DreamPage({ params }: DreamPageProps) {
  const dreamId = z.uuid().safeParse((await params).dreamId);
  if (!dreamId.success) notFound();
  return (
    <main className="shell inner-page">
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><Link href="/journal">Journal</Link></header>
      <DreamExperience dreamId={dreamId.data} />
    </main>
  );
}
