import React from "react";
import { api, go } from "../api";
import { Empty, Icon, Link, Spinner, toast, useAsync } from "../ui";
import { Preview } from "./Add";

interface Coll { _id: string; name: string; description: string; site: string; source: string; instruction: string; hue: number; count: number; have: number; fresh: number; updated: number }

export function Discover() {
  const { data, loading, error, reload } = useAsync(() => api<{ collections: Coll[]; canPublish: boolean }>("/api/catalog"), []);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const addAll = async (c: Coll) => {
    setBusy(c._id);
    try {
      const r = await api<{ added: number; existing: number }>(`/api/catalog/${encodeURIComponent(c._id)}/add`, { body: {} });
      toast(r.added ? `Added ${r.added} to “${c.name}”. New posts arrive daily.` : "You already have all of these.", "ok");
      reload();
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(null); }
  };
  const refresh = async (c: Coll) => { setBusy(c._id); try { await api(`/api/catalog/${encodeURIComponent(c._id)}/refresh`, { method: "POST" }); toast("Re-read from its source", "ok"); reload(); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(null); } };
  const drop = async (c: Coll) => { if (!confirm(`Take “${c.name}” off Discover? Readers keep what they added.`)) return; await api(`/api/catalog/${encodeURIComponent(c._id)}`, { method: "DELETE" }); reload(); };

  if (loading && !data) return <div className="page"><Spinner label="Opening the shared shelves" /></div>;
  if (error) return <div className="page"><p className="err">{error}</p></div>;
  const list = data?.collections || [];
  return (
    <div className="page">
      <header className="page-head">
        <div><p className="eyebrow">Discover</p><h1 className="display">Shared shelves</h1>
          <p className="lede">Collections anyone can add. Take a whole shelf, or pick the articles you want; new posts from its source arrive in your library every day.</p></div>
        {data?.canPublish && <button className="btn ghost" onClick={() => setSharing(true)}><Icon name="plus" size={16} /> Share a shelf</button>}
      </header>
      {sharing && <ShareShelf onDone={() => { setSharing(false); reload(); }} />}
      {list.length ? (
        <ul className="colls">
          {list.map((c, i) => (
            <li key={c._id} className="coll" style={{ ["--h" as string]: c.hue, ["--i" as string]: i }}>
              <Link to={`/discover/${encodeURIComponent(c._id)}`} className="coll-cover" aria-label={`${c.name}: see the articles`}>
                <span className="coll-kicker">{c.site}</span>
                <span className="coll-name">{c.name}</span>
                <span className="coll-count">{c.count} articles</span>
                <span className="coll-bar"><i style={{ width: `${c.count ? (c.have / c.count) * 100 : 0}%` }} /></span>
              </Link>
              <div className="coll-body">
                <p>{c.description}</p>
                <div className="coll-actions">
                  {c.have === 0 ? <button className="btn primary sm" disabled={busy === c._id} onClick={() => addAll(c)}>{busy === c._id ? "Adding…" : `Add all ${c.count}`}</button>
                    : c.fresh > 0 ? <button className="btn primary sm" disabled={busy === c._id} onClick={() => addAll(c)}>{busy === c._id ? "Adding…" : `Add ${c.fresh} new`}</button>
                    : <span className="pill moss"><Icon name="check" size={13} /> In your library</span>}
                  <Link to={`/discover/${encodeURIComponent(c._id)}`} className="linkbtn">Choose articles</Link>
                  {c.have > 0 && <Link to={`/library?shelf=${encodeURIComponent(c.name)}`} className="linkbtn">Open shelf</Link>}
                </div>
                {data?.canPublish && (
                  <div className="coll-admin"><span className="muted small">{c.source ? `from ${c.source.replace(/^https?:\/\//, "")}${c.instruction && !/^all$/i.test(c.instruction) ? ` · “${c.instruction}”` : ""}` : "a fixed list"}</span>
                    {c.source && <button className="linkbtn" onClick={() => refresh(c)} disabled={busy === c._id}>Refresh</button>}
                    <button className="linkbtn danger" onClick={() => drop(c)}>Remove</button></div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty icon="library" title="No shared shelves yet"><p>{data?.canPublish ? "Share one of your shelves to start." : "Check back soon."}</p></Empty>}
    </div>
  );
}

function ShareShelf({ onDone }: { onDone: () => void }) {
  const lib = useAsync(() => api<{ items: { topic: string }[] }>("/api/library"), []);
  const shelves = [...new Set((lib.data?.items || []).map((i) => i.topic))];
  const [shelf, setShelf] = React.useState(""); const [desc, setDesc] = React.useState(""); const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api("/api/catalog", { body: { shelf: shelf || shelves[0], description: desc } }); toast("Shared on Discover", "ok"); onDone(); }
    catch (x) { toast((x as Error).message, "err"); } finally { setBusy(false); }
  };
  return (
    <form className="card form share-form" onSubmit={submit}>
      <h2>Share a shelf</h2>
      <label className="field"><span>Shelf</span><select value={shelf || shelves[0] || ""} onChange={(e) => setShelf(e.target.value)}>{shelves.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="field"><span>One or two sentences for the cover</span><input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={400} placeholder="What is on it, and who it is for" /></label>
      <div className="row-actions"><button className="btn primary" disabled={busy || !shelves.length}>{busy ? "Sharing…" : "Share"}</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

export function DiscoverOne({ id }: { id: string }) {
  const { data, loading, error } = useAsync(() => api<{ collection: Coll & { items: { url: string; slug: string; title: string; summary?: string; tags?: string[]; date?: string; keep: boolean; inLibrary: boolean }[] } }>(`/api/catalog/${encodeURIComponent(id)}`), [id]);
  if (loading && !data) return <div className="page"><Spinner label="Opening the collection" /></div>;
  if (error || !data) return <div className="page"><p className="err">{error}</p><Link to="/discover">Back to Discover</Link></div>;
  const c = data.collection;
  return (
    <div className="page">
      <header className="page-head">
        <div><p className="eyebrow"><Link to="/discover">Discover</Link> · {c.site}</p><h1 className="display">{c.name}</h1><p className="lede">{c.description}</p></div>
        <button className="btn ghost" onClick={() => go("/discover")}><Icon name="back" size={16} /> All shelves</button>
      </header>
      <Preview r={{ source: c.source, siteName: c.site, method: "catalog", topic: c.name, instruction: c.instruction, candidates: c.items }} />
    </div>
  );
}
