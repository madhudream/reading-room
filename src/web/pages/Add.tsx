import React from "react";
import { api, go, host } from "../api";
import { postDate } from "./Library";
import { Icon, Monogram, Spinner, toast } from "../ui";

interface Cand { url: string; slug: string; title: string; summary?: string; tags?: string[]; date?: string; keep: boolean; inLibrary: boolean }
interface Result { source: string; siteName?: string; method?: string; topic?: string; reason?: string; instruction?: string; error?: string; candidates: Cand[] }

const EXAMPLES = [
  "AI blogs only from https://outcomeschool.com/blog",
  "Add all blogs from https://memory-notes-246726325229.us-central1.run.app/",
  "System design posts from https://outcomeschool.com/blog",
];
const METHOD: Record<string, string> = { catalog: "this shared shelf", github: "the GitHub folder", "next-data": "the site’s post index", feed: "its RSS feed", links: "the links on the page", sitemap: "its sitemap", single: "a single article" };

export function Add({ initial }: { initial: string }) {
  const [text, setText] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [results, setResults] = React.useState<Result[] | null>(null);
  const ran = React.useRef(false);

  const preview = async (t = text) => {
    if (!t.trim()) return;
    setBusy(true); setErr(""); setResults(null);
    try { setResults((await api<{ results: Result[] }>("/api/import/preview", { body: { text: t } })).results); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  React.useEffect(() => { if (initial && !ran.current) { ran.current = true; void preview(initial); } }, [initial]);

  return (
    <div className="page">
      <header className="page-head">
        <div><p className="eyebrow">Add reading</p><h1 className="display">What should we gather?</h1>
          <p className="lede">Paste a blog’s address and say what you want from it. The room reads the whole index, keeps what matches, and lets you check the list before anything is added.</p></div>
      </header>
      <form className="command" onSubmit={(e) => { e.preventDefault(); void preview(); }}>
        <Icon name="spark" size={20} className="command-ic" />
        <textarea aria-label="What to add" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. AI blogs only from https://outcomeschool.com/blog"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void preview(); } }} />
        <button className="btn primary" disabled={busy || !text.trim()}>{busy ? "Looking…" : "Find articles"}</button>
      </form>
      {!results && !busy && (
        <div className="chips">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => { setText(e); void preview(e); }}>{e.replace(/https?:\/\//, "")}</button>)}</div>
      )}
      {busy && <div className="card scanning"><Spinner label="Reading the index and choosing what matches" /><p className="muted">Big blogs take a few seconds: every post’s title, tags and summary are read before choosing.</p></div>}
      {err && <p className="err" role="alert">{err}</p>}
      {results?.map((r) => <Preview key={r.source} r={r} />)}
    </div>
  );
}

export function Preview({ r }: { r: Result }) {
  const [sel, setSel] = React.useState<Set<number>>(() => new Set(r.candidates.map((c, i) => (c.keep && !c.inLibrary ? i : -1)).filter((i) => i >= 0)));
  const [topic, setTopic] = React.useState(r.topic || r.siteName || "Reading");
  const [showAll, setShowAll] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState<{ added: number; existing: number } | null>(null);
  if (r.error) return <div className="card"><p className="err">Couldn’t read {r.source}: {r.error}</p></div>;
  const kept = r.candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.keep);
  const others = r.candidates.map((c, i) => ({ c, i })).filter(({ c }) => !c.keep);
  const list = (showAll ? [...kept, ...others] : kept).sort((a, b) => Number(a.c.inLibrary) - Number(b.c.inLibrary));
  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const setMany = (ids: number[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const commit = async () => {
    setSaving(true);
    try {
      const items = [...sel].sort((a, b) => a - b).map((i) => r.candidates[i]);
      const res = await api<{ added: number; existing: number }>("/api/import/commit", { body: { source: r.source, site: r.siteName, topic, instruction: r.instruction || "", items, seen: r.candidates.map((c) => c.url) } });
      setDone(res);
      toast(`Added ${res.added} to “${topic}”`, "ok");
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setSaving(false); }
  };
  if (done) return (
    <div className="card done">
      <Icon name="check" size={28} />
      <div><h2>{done.added} article{done.added === 1 ? "" : "s"} on the “{topic}” shelf</h2><p className="muted">{done.existing ? `${done.existing} were already in your list. ` : ""}New posts on {r.siteName || host(r.source)} that match will be added here every day; the shelf has a button to check now.</p></div>
      <button className="btn primary" onClick={() => go(`/library?shelf=${encodeURIComponent(topic)}`)}>Open the shelf <Icon name="arrow" size={16} /></button>
    </div>
  );
  return (
    <section className="card preview">
      <header className="preview-head">
        <Monogram url={r.source} site={r.siteName} size={40} />
        <div>
          <h2>{r.siteName || host(r.source)}</h2>
          <p className="muted">Found <b>{r.candidates.length}</b> via {METHOD[r.method || ""] || r.method}. {r.instruction ? <>Kept <b>{kept.length}</b> for “{r.instruction}”.</> : <>Keeping all of them.</>}</p>
        </div>
      </header>
      <div className="preview-bar">
        <label className="field inline"><span>Shelf</span><input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={40} /></label>
        <div className="preview-actions">
          <button className="linkbtn" onClick={() => setMany(list.map((x) => x.i).filter((i) => !r.candidates[i].inLibrary), true)}>Select all</button>
          <button className="linkbtn" onClick={() => setMany(list.map((x) => x.i), false)}>None</button>
          {others.length > 0 && <button className="linkbtn" onClick={() => setShowAll(!showAll)}>{showAll ? `Hide the ${others.length} left out` : `Show the ${others.length} left out`}</button>}
        </div>
      </div>
      <ul className="cands">
        {list.map(({ c, i }) => (
          <li key={c.url} className={`${!c.keep ? "out" : ""} ${c.inLibrary ? "have" : ""}`}>
            <label>
              <input type="checkbox" checked={sel.has(i)} disabled={c.inLibrary} onChange={() => toggle(i)} />
              <span className="cand-body">
                <span className="cand-title">{c.title}</span>
                <span className="cand-meta"><span className="slug">/{c.slug}</span>{postDate(c.date) && <span>{postDate(c.date)}</span>}{c.tags?.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}{c.inLibrary && <span className="pill moss">in your list</span>}</span>
                {c.summary && <span className="cand-sum">{c.summary}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <footer className="preview-foot">
        <span className="muted">{sel.size} selected</span>
        <button className="btn primary" disabled={!sel.size || saving} onClick={commit}>{saving ? "Adding…" : `Add ${sel.size} to “${topic}”`}</button>
      </footer>
    </section>
  );
}
