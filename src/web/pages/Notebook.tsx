import React from "react";
import { api } from "../api";
import { Empty, Icon, Link, Score, Spinner, useAsync, type Recall } from "../ui";

export function Notebook() {
  const { data, loading, error } = useAsync(() => api<{ notes: Recall[] }>("/api/notes"), []);
  const [q, setQ] = React.useState("");
  const notes = (data?.notes || []).filter((n) => !q || `${n.title} ${n.text} ${n.topic}`.toLowerCase().includes(q.toLowerCase()));
  const byDay = React.useMemo(() => {
    const m = new Map<string, Recall[]>();
    for (const n of notes) { const k = new Date(n.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }); m.set(k, [...(m.get(k) || []), n]); }
    return [...m.entries()];
  }, [notes]);
  if (loading && !data) return <div className="page"><Spinner label="Opening the notebook" /></div>;
  if (error) return <div className="page"><p className="err">{error}</p></div>;
  return (
    <div className="page narrow">
      <header className="page-head">
        <div><p className="eyebrow">Notebook</p><h1 className="display">In your own words</h1>
          <p className="lede">Every recall you’ve written, kept exactly as you wrote it. Reading back through it shows you how an idea settled over the days.</p></div>
      </header>
      {data?.notes.length ? (
        <>
          <label className="search wide"><Icon name="search" size={16} /><input aria-label="Search your notes" placeholder="Search your notes…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {byDay.map(([day, list]) => (
            <section key={day} className="nb-day">
              <h2 className="nb-date">{day}</h2>
              {list.map((n) => (
                <article key={n._id} className="nb-note">
                  <header><Link to={`/read/${encodeURIComponent(n.item)}`} className="nb-title">{n.title}</Link><span className="nb-kind">{n.kind === "daily" ? "daily recall" : n.kind === "after-read" ? "after reading" : "note"} · {new Date(n.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></header>
                  <p className="nb-text">{n.text}</p>
                  {(n.verdict || n.missed?.length) && (
                    <footer><Score value={n.score} />{n.verdict && <span>{n.verdict}</span>}{n.missed?.length ? <span className="nb-missed">Worth adding: {n.missed.join(" · ")}</span> : null}</footer>
                  )}
                </article>
              ))}
            </section>
          ))}
          {!notes.length && <p className="muted">No notes match “{q}”.</p>}
        </>
      ) : <Empty icon="notebook" title="The notebook is blank"><p>After you read something, you’ll write a sentence about it from memory. Each one is kept here.</p></Empty>}
    </div>
  );
}
