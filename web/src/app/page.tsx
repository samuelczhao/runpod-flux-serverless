import Link from "next/link";

const FEATURES = [
  ["Reconstruct", "Speak a dream and receive a coherent three-scene visual story."],
  ["Re-enter", "Rewrite any scene without losing the original version."],
  ["Recognize", "See the people, places, and symbols that return over time."],
] as const;

export default function HomePage() {
  return (
    <main>
      <Navigation />
      <Hero />
      <FeatureGrid />
    </main>
  );
}

function Navigation() {
  return (
    <nav className="nav shell">
      <Link className="brand" href="/">DreamTrace</Link>
      <span className="privacy-pill">Private by design</span>
    </nav>
  );
}

function Hero() {
  return (
    <section className="hero shell">
      <p className="eyebrow">A visual dream journal</p>
      <h1>Return to the place<br />only you remember.</h1>
      <p className="lede">Record a dream. Watch it become a story. Change one choice and follow where it leads.</p>
      <div className="actions">
        <Link className="button primary" href="/capture">Trace a dream</Link>
        <Link className="button ghost" href="/journal">Explore the journal</Link>
      </div>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section className="feature-grid shell" aria-label="DreamTrace capabilities">
      {FEATURES.map(([title, copy], index) => (
        <article className="feature" key={title}>
          <span>0{index + 1}</span><h2>{title}</h2><p>{copy}</p>
        </article>
      ))}
    </section>
  );
}
