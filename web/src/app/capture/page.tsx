import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { CaptureClient } from "@/app/capture/CaptureClient";

export const metadata: Metadata = {
  title: "Capture a dream · DreamTrace",
  description: "Speak or type a dream and turn it into a private visual story.",
};

export default function CapturePage(): ReactElement {
  return (
    <main className="shell inner-page">
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><Link href="/journal">Open journal</Link></header>
      <section className="capture-intro">
        <div><p className="eyebrow">New entry</p>
          <h1>What happened?</h1></div>
        <div className="capture-intro-copy"><p>Speak or write everything you remember. We’ll choose one moment for each important turn in the dream.</p>
          <p className="margin-note">Start anywhere. Fragments, feelings, and impossible details are all welcome.</p></div>
      </section>
      <CaptureClient />
    </main>
  );
}
