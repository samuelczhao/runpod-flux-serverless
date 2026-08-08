import Link from "next/link";

const DETAILS = [
  ["Tell it your way", "Speak while the memory is fresh, or write down the details at your own pace."],
  ["Keep every turn", "Your story follows the moments that matter, whether there is one or there are many."],
  ["Return later", "Change a moment, compare versions, and notice what comes back across your dreams."],
] as const;

export default function HomePage() {
  return (
    <main>
      <Navigation />
      <Hero />
      <JournalDetails />
    </main>
  );
}

function Navigation() {
  return (
    <nav className="nav shell">
      <Link className="brand" href="/">DreamTrace</Link>
      <span className="nav-note">Your private journal</span>
    </nav>
  );
}

function Hero() {
  return (
    <section className="hero shell">
      <div className="hero-copy">
        <p className="eyebrow">A visual dream journal</p>
        <h1>Write down a dream before it fades.</h1>
        <p className="lede">Speak or type what you remember. DreamTrace finds the important moments and turns them into a story you can return to.</p>
        <div className="actions">
          <Link className="button primary" href="/capture">Record a dream</Link>
          <Link className="text-link" href="/journal">Open your journal</Link>
        </div>
      </div>
      <aside className="hero-note" aria-label="A note for remembering dreams">
        <span>For the details that disappear first</span>
        <p>Start with a room, a face, a sound, or a feeling. It does not need to make sense yet.</p>
      </aside>
    </section>
  );
}

function JournalDetails() {
  return (
    <section className="journal-details shell" aria-labelledby="journal-details-title">
      <header><p className="eyebrow">Made for remembering</p>
        <h2 id="journal-details-title">The dream decides the length.</h2></header>
      <div className="detail-list">{DETAILS.map(([title, copy]) => (
        <article className="detail" key={title}>
          <h3>{title}</h3><p>{copy}</p>
        </article>
      ))}</div>
    </section>
  );
}
