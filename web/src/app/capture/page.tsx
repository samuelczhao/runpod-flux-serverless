import Link from "next/link";
import { CaptureClient } from "@/app/capture/CaptureClient";

export default function CapturePage() {
  return (
    <main className="shell inner-page">
      <header className="inner-nav"><Link className="brand" href="/">DreamTrace</Link><span>Text capture</span></header>
      <section className="capture-intro">
        <p className="eyebrow">Begin a trace</p>
        <h1>Tell it before<br />it disappears.</h1>
        <p>Write fragments, feelings, impossible details—DreamTrace will preserve them as three connected scenes.</p>
      </section>
      <CaptureClient />
    </main>
  );
}
