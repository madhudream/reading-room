import React from "react";
import { api, ago, go, until } from "../api";
import { Empty, hue, Icon, Link, Monogram, Spinner, StatusDot, toast, useAsync, type Item } from "../ui";

const STATUS = [
  { k: "all", label: "All" },
  { k: "new", label: "Unread" },
  { k: "reading", label: "Reading" },
  { k: "read", label: "Read" },
] as const;

interface Source { _id: string; url: string; site: string; topic: string; instruction: string; lastSync?: number; lastAdded?: number; lastError?: string }

const SORTS = [
  { k: "newest", label: "Newest posts" },
  { k: "oldest", label: "Oldest posts" },
  { k: "added", label: "Recently added" },
  { k: "title", label: "Title A–Z" },
] as const;
/** the post's own date, when the source gives one */
const when = (i: Item) => (i.date && !Number.isNaN(Date.parse(i.date)) ? Date.parse(i.date) : null);
/** dated posts by date; undated ones after them, in the order their source lists them */
const byDate = (a: Item, b: Item, dir: 1 | -1) => {
  const x = when(a), y = when(b);
  if (x === null && y === null) return b.addedAt - a.addedAt;
  if (x === null) return 1;
  if (y === null) return -1;
  return dir * (x - y) || b.addedAt - a.addedAt;
};
export const postDate = (d?: string) => {
  if (!d || Number.isNaN(Date.parse(d))) return "";
  // a bare 2026-09-21 is a calendar day; a timestamp is shown in the reader's own zone, as the source site does
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** "SEPTEMBER 20, 2026", the way Outcome School prints it */
export const longDate = (d?: string) => {
  if (!d || Number.isNaN(Date.parse(d))) return "";
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return t.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};
const TAG_NAMES: Record<string, string> = { ai: "AI", llm: "LLM", "machine-learning": "ML", "ai-agent": "AI Agents", "system-design": "System Design", rag: "RAG", nlp: "NLP", "deep-learning": "Deep Learning", "generative-ai": "Generative AI", math: "Math", backend: "Backend", database: "Database", android: "Android", kotlin: "Kotlin" };
/** "AI and ML", "AI and System Design": the site's own category line, from the tags */
function category(tags?: string[]) {
  if (!tags?.length) return "";
  const names = [...new Set(tags.map((t) => TAG_NAMES[t] || t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())))];
  const top = names.includes("AI") ? ["AI", ...names.filter((n) => n !== "AI" && n !== "LLM")].slice(0, 2) : names.slice(0, 2);
  return top.join(" and ");
}

function Card({ it }: { it: Item }) {
  return (
    <li className={`bcard s-${it.status}`}>
      <Link to={`/read/${encodeURIComponent(it._id)}`} className="bcard-link">
        <div className="bcard-head" style={{ ["--h" as string]: hue(it.site) }}>
          <span className="bcard-site">{it.site}</span>
          <span className="bcard-big">{it.title}</span>
          {category(it.tags) && <span className="bcard-cat">{category(it.tags)}</span>}
        </div>
        <div className="bcard-body">
          <span className="bcard-date">{longDate(it.date) || `Added ${ago(it.addedAt)}`}</span>
          <span className="bcard-title">{it.title}</span>
          {it.summary && <span className="bcard-sum">{it.summary}</span>}
          <span className="bcard-foot">
            <span className="bcard-status"><StatusDot status={it.status} />{it.status === "new" ? "Unread" : it.status === "reading" ? (it.progress ? `${Math.round(it.progress * 100)}% read` : "Reading") : "Read"}</span>
            {it.quiz && <span className="pill">quiz {it.quiz.score}/{it.quiz.total}</span>}
            {it.recall?.count ? <span className="pill moss">{it.recall.count} note{it.recall.count > 1 ? "s" : ""}</span> : null}
            {(it.enteredMin ?? Math.round((it.timeSec || 0) / 60)) > 0 ? <span className="bcard-time"><Icon name="clock" size={12} /> {it.enteredMin ?? Math.round((it.timeSec || 0) / 60)} min</span> : null}
            {it.status === "read" && it.recall?.due ? <span className="bcard-due">recall {until(it.recall.due)}</span> : null}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function Library({ query }: { query: URLSearchParams }) {
  const { data, loading, error, reload } = useAsync(() => api<{ items: Item[]; sources: Source[] }>("/api/library"), []);
  const [q, setQ] = React.useState("");
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const sort = query.get("sort") || "newest";
  const view = query.get("view") || (() => { try { return localStorage.getItem("libView") || "cards"; } catch { return "cards"; } })();
  const setView = (v: string) => { try { localStorage.setItem("libView", v); } catch { /* private mode */ } setParam("view", v === "cards" ? "" : v); };
  const status = query.get("status") || "all";
  const shelf = query.get("shelf") || "";
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(query);
    if (v && v !== "all") p.set(k, v); else p.delete(k);
    go(`/library${p.toString() ? `?${p}` : ""}`);
  };
  const items = data?.items || [];
  const shelves = React.useMemo(() => {
    const m = new Map<string, { n: number; read: number }>();
    for (const i of items) { const s = m.get(i.topic) || { n: 0, read: 0 }; s.n++; if (i.status === "read") s.read++; m.set(i.topic, s); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [items]);
  const shown = items.filter((i) =>
    (status === "all" || i.status === status) && (!shelf || i.topic === shelf) &&
    (!q || `${i.title} ${i.summary || ""} ${(i.tags || []).join(" ")} ${i.site}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title)
      : sort === "added" ? b.addedAt - a.addedAt
      : byDate(a, b, sort === "oldest" ? 1 : -1));
  const srcs = (data?.sources || []).filter((x) => !shelf || x.topic === shelf);
  const sync = async (id?: string) => {
    setSyncing(id || "*");
    try {
      const r = await api<{ results: { site: string; topic: string; added: number; titles: string[]; error?: string }[] }>("/api/sources/sync", { body: { id } });
      const added = r.results.reduce((n, x) => n + x.added, 0);
      const failed = r.results.filter((x) => x.error);
      if (failed.length) toast(`Couldn’t reach ${failed.map((x) => x.site).join(", ")}`, "err");
      else toast(added ? `${added} new post${added === 1 ? "" : "s"}: ${r.results.flatMap((x) => x.titles).slice(0, 2).join(" · ")}${added > 2 ? " …" : ""}` : "Up to date: nothing new since last time.", added ? "ok" : "info");
      if (added) reload();
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setSyncing(null); }
  };
  const rename = async (from: string, to: string) => {
    setRenaming(null);
    if (!to.trim() || to.trim() === from) return;
    try { const r = await api<{ name: string }>("/api/shelves/rename", { body: { from, to } }); reload(); setParam("shelf", r.name); toast(`Renamed to “${r.name}”`, "ok"); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  const counts = { all: 0, new: 0, reading: 0, read: 0 } as Record<string, number>;
  for (const i of items) if (!shelf || i.topic === shelf) { counts.all++; counts[i.status]++; }

  if (loading && !data) return <div className="page"><Spinner label="Dusting the shelves" /></div>;
  if (error) return <div className="page"><p className="err">{error}</p></div>;

  return (
    <div className="page">
      <header className="page-head">
        <div><p className="eyebrow">Library</p><h1 className="display">Your shelves</h1></div>
        <Link to="/add" className="btn primary"><Icon name="plus" size={16} /> Add reading</Link>
      </header>
      {!items.length ? (
        <Empty icon="library" title="No books on the shelf yet"><p>Take a shared shelf from <Link to="/discover">Discover</Link>, or <Link to="/add">add a blog</Link> and choose what to keep.</p></Empty>
      ) : (
        <>
          <div className="shelves" role="list">
            <button role="listitem" className={`shelf ${!shelf ? "on" : ""}`} onClick={() => setParam("shelf", "")}><span className="shelf-name">Everything</span><span className="shelf-n">{items.length}</span></button>
            {shelves.map(([name, s]) => (
              <button role="listitem" key={name} className={`shelf ${shelf === name ? "on" : ""}`} onClick={() => setParam("shelf", name)}>
                <span className="shelf-name">{name}</span><span className="shelf-n">{s.read}/{s.n}</span>
                <span className="shelf-bar"><i style={{ width: `${(s.read / s.n) * 100}%` }} /></span>
              </button>
            ))}
          </div>
          {(shelf || srcs.length > 0) && (
            <div className="sourcebar">
              {shelf && (renaming === shelf ? (
                <form className="rename" onSubmit={(e) => { e.preventDefault(); void rename(shelf, (e.currentTarget.elements.namedItem("n") as HTMLInputElement).value); }}>
                  <input name="n" aria-label="Shelf name" defaultValue={shelf} autoFocus maxLength={40} onBlur={(e) => rename(shelf, e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
                </form>
              ) : <h2 className="shelf-title">{shelf} <button className="linkbtn" onClick={() => setRenaming(shelf)}>Rename</button></h2>)}
              <div className="sources">
                {srcs.map((x) => (
                  <div key={x._id} className="source">
                    <span className="source-what">
                      <a href={x.url} target="_blank" rel="noopener noreferrer">{x.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                      {x.instruction && !/^(all|every)/i.test(x.instruction) ? <span className="muted"> · “{x.instruction}”</span> : null}
                    </span>
                    <span className="source-when muted">{x.lastError ? <span className="err-inline">last check failed</span> : x.lastSync ? `checked ${ago(x.lastSync)}` : "never checked"} · checks daily</span>
                    <button className="btn ghost sm" disabled={!!syncing} onClick={() => sync(x._id)}><Icon name="refresh" size={14} className={syncing === x._id || syncing === "*" ? "spinning" : ""} /> {syncing === x._id ? "Checking…" : "Check for new posts"}</button>
                  </div>
                ))}
                {!shelf && srcs.length > 1 && <button className="linkbtn" disabled={!!syncing} onClick={() => sync()}>{syncing === "*" ? "Checking every source…" : "Check every source now"}</button>}
              </div>
            </div>
          )}
          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="Filter by status">
              {STATUS.map((s) => <button role="tab" aria-selected={status === s.k} key={s.k} className={status === s.k ? "on" : ""} onClick={() => setParam("status", s.k)}>{s.label} <small>{counts[s.k]}</small></button>)}
            </div>
            <div className="toolbar-right">
              <div className="seg" role="tablist" aria-label="Layout">
                <button role="tab" aria-selected={view === "cards"} className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cards</button>
                <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
              </div>
              <select className="sort" aria-label="Sort" value={sort} onChange={(e) => setParam("sort", e.target.value === "newest" ? "" : e.target.value)}>{SORTS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select>
              <label className="search"><Icon name="search" size={16} /><input aria-label="Search your library" placeholder="Search titles, tags…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            </div>
          </div>
          {shown.length && view === "cards" ? (
            <ul className="bgrid">{shown.map((it) => <Card key={it._id} it={it} />)}</ul>
          ) : shown.length ? (
            <ul className="lib">
              {shown.map((it) => (
                <li key={it._id}>
                  <Link to={`/read/${encodeURIComponent(it._id)}`} className="lib-row">
                    <Monogram url={it.url} site={it.site} size={34} />
                    <span className="lib-body">
                      <span className="lib-title"><StatusDot status={it.status} />{it.title}</span>
                      {it.summary && <span className="lib-sum">{it.summary}</span>}
                      <span className="lib-meta">
                        <span>{it.site}</span>
                        {postDate(it.date) && <span>{postDate(it.date)}</span>}
                        {it.tags?.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
                      </span>
                    </span>
                    <span className="lib-side">
                      {it.status === "read" ? <>
                        {it.quiz && <span className="pill">quiz {it.quiz.score}/{it.quiz.total}</span>}
                        {it.recall?.count ? <span className="pill moss">{it.recall.count} note{it.recall.count > 1 ? "s" : ""}</span> : null}
                        {it.recall?.due && <span className="lib-due">recall {until(it.recall.due)}</span>}
                      </> : it.status === "reading" ? <span className="lib-due">opened {ago(it.openedAt)}</span> : <span className="lib-due">added {ago(it.addedAt)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty icon="search" title="Nothing matches"><p>Try another filter or search.</p></Empty>}
        </>
      )}
    </div>
  );
}
