import React from "react";
import { api, ago, until } from "../api";
import { Empty, Icon, Link, Score, Spinner, toast, useAsync, type Item, type Recall } from "../ui";

const PROMPTS = [
  (t: string) => `Without looking: what is “${t}” about?`,
  (t: string) => `Explain “${t}” to a friend in a sentence or two.`,
  (t: string) => `What’s the one idea from “${t}” you’d want to keep?`,
];

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

export function RecallBox({ item, kind, lastNudge, onDone, onSkip }: {
  item: Item; kind: "after-read" | "daily" | "free"; lastNudge?: string;
  onDone: (r: Recall, it: Item) => void; onSkip: () => void;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ recall: Recall; item: Item } | null>(null);
  const prompt = React.useMemo(() => lastNudge && kind === "daily" ? lastNudge : PROMPTS[(item.recall?.count || 0) % PROMPTS.length](item.title), [item._id]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const submit = async () => {
    setBusy(true);
    try { setResult(await api(`/api/items/${encodeURIComponent(item._id)}/recall`, { body: { text, kind } })); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };
  if (result) {
    const r = result.recall;
    return (
      <div className="card recallbox graded">
        <div className="graded-top"><p className="eyebrow">Your recall</p>{r.score !== undefined && <Score value={r.score} />}</div>
        <blockquote className="yours">“{r.text}”</blockquote>
        {r.verdict && <p className="verdict">{r.verdict}</p>}
        <div className="gm">
          {r.got?.length ? <div className="gm-col ok"><h4><Icon name="check" size={14} /> You remembered</h4><ul>{r.got.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
          {r.missed?.length ? <div className="gm-col no"><h4><Icon name="spark" size={14} /> Worth adding</h4><ul>{r.missed.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
        </div>
        {r.nudge && <p className="nudge"><b>Next time:</b> {r.nudge}</p>}
        <div className="graded-foot"><span className="muted">Saved to your notebook · next recall {until(result.item.recall?.due)}</span>
          <button className="btn primary" onClick={() => onDone(r, result.item)}>Continue <Icon name="arrow" size={16} /></button></div>
      </div>
    );
  }
  return (
    <div className="card recallbox">
      <p className="eyebrow"><Icon name="recall" size={14} /> Recall{item.recall?.count ? ` · ${ordinal(item.recall.count + 1)} time` : ""}</p>
      <h3 className="recall-prompt">{prompt}</h3>
      <textarea aria-label="What you remember" autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Write one or more sentences, in your own words. Rough is fine."
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && words >= 3) void submit(); }} />
      <div className="recall-foot">
        <span className="muted">{words ? `${words} word${words === 1 ? "" : "s"}` : "⌘↵ to save"}</span>
        <div className="row-actions">
          <button className="btn ghost" onClick={onSkip} disabled={busy}><Icon name="skip" size={14} /> Skip</button>
          <button className="btn primary" onClick={submit} disabled={busy || words < 3}>{busy ? "Reading your note…" : "Save & check"}</button>
        </div>
      </div>
    </div>
  );
}

export function RecallSession() {
  const { data, loading, error } = useAsync(() => api<{ queue: Item[]; doneToday: number; streak: number }>("/api/today"), []);
  const [i, setI] = React.useState(0);
  const [done, setDone] = React.useState<{ n: number; skipped: number; scores: number[] }>({ n: 0, skipped: 0, scores: [] });
  const [reveal, setReveal] = React.useState(false);
  const [history, setHistory] = React.useState<Recall[] | null>(null);
  const queue = data?.queue || [];
  const it = queue[i];
  React.useEffect(() => {
    setReveal(false); setHistory(null);
    if (it) api<{ history: Recall[] }>(`/api/items/${encodeURIComponent(it._id)}/history`).then((v) => setHistory(v.history)).catch(() => setHistory([]));
  }, [it?._id]);

  if (loading) return <div className="page narrow"><Spinner label="Shuffling today’s cards" /></div>;
  if (error) return <div className="page narrow"><p className="err">{error}</p></div>;
  if (!queue.length) return (
    <div className="page narrow">
      <header className="page-head"><div><p className="eyebrow">Daily recall</p><h1 className="display">Nothing due right now.</h1></div></header>
      <Empty icon="recall" title={data?.doneToday ? `You recalled ${data.doneToday} today` : "Read something first"}>
        <p>{data?.doneToday ? "The next cards come due on their own. See you tomorrow." : "Finish an article and write one sentence about it; from then on it comes back here, spaced out over days and weeks."}</p>
        <Link to="/library?status=new" className="btn primary">Find something to read</Link>
      </Empty>
    </div>
  );
  if (i >= queue.length) {
    const avg = done.scores.length ? done.scores.reduce((a, b) => a + b, 0) / done.scores.length : null;
    return (
      <div className="page narrow">
        <div className="card session-done">
          <Icon name="flame" size={40} className="lit" />
          <h1 className="display">Done for today.</h1>
          <p className="lede">{done.n} recalled{done.skipped ? `, ${done.skipped} skipped` : ""}{avg !== null ? ` · average ${avg.toFixed(1)}/5` : ""}. Streak: {(data?.streak || 0) + (data?.doneToday ? 0 : done.n ? 1 : 0)} day{((data?.streak || 0) + (data?.doneToday ? 0 : done.n ? 1 : 0)) === 1 ? "" : "s"}.</p>
          <div className="row-actions center"><Link to="/notebook" className="btn ghost">Open the notebook</Link><Link to="/" className="btn primary">Back to today</Link></div>
        </div>
      </div>
    );
  }
  const skip = async () => { await api(`/api/items/${encodeURIComponent(it._id)}/recall/skip`, { method: "POST" }).catch(() => {}); setDone((d) => ({ ...d, skipped: d.skipped + 1 })); setI(i + 1); };
  return (
    <div className="page narrow">
      <header className="session-head">
        <p className="eyebrow">Daily recall · {i + 1} of {queue.length}</p>
        <div className="session-bar">{queue.map((q, k) => <i key={q._id} className={k < i ? "done" : k === i ? "cur" : ""} />)}</div>
      </header>
      <div className="session-card">
        <p className="session-topic">{it.topic} · {it.site}</p>
        <h2 className="session-title">{it.title}</h2>
        <p className="muted">{it.recall?.lastAt ? `Last recalled ${ago(it.recall.lastAt)}` : `Read ${ago(it.readAt)}`}{it.overdue ? "" : " · a bonus review to keep the day going"}</p>
      </div>
      {history === null ? <div className="card recallbox"><Spinner /></div> : <RecallBox key={it._id} item={it} kind="daily" lastNudge={history[0]?.nudge}
        onDone={(r) => { setDone((d) => ({ ...d, n: d.n + 1, scores: r.score !== undefined ? [...d.scores, r.score] : d.scores })); setI(i + 1); }}
        onSkip={skip} />}
      {history && history.length > 0 && (
        <div className="peek">
          <button className="linkbtn" onClick={() => setReveal(!reveal)}>{reveal ? "Hide" : "Peek at"} what you wrote before ({history.length})</button>
          {reveal && <ul className="notes-mini">{history.slice(0, 3).map((h) => <li key={h._id}><p>“{h.text}”</p><span>{ago(h.at)} <Score value={h.score} /></span></li>)}</ul>}
        </div>
      )}
      <p className="session-link"><Link to={`/read/${encodeURIComponent(it._id)}`}>Re-read the article</Link></p>
    </div>
  );
}
