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
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><span>Voice or text</span></header>
      <section className="capture-intro">
        <p className="eyebrow">Begin a trace</p>
        <h1>Tell it before<br />it disappears.</h1>
        <p>Speak or write fragments, feelings, and impossible details—DreamTrace will preserve them as three connected scenes.</p>
      </section>
      <CaptureClient />
    </main>
  );
}
