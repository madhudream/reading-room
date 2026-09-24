import React from "react";
import { api, ago, go, host, TZ, until } from "../api";
import { postDate } from "./Library";
import { Icon, Link, Score, Spinner, toast, useAsync, type Item, type Recall } from "../ui";
import { RecallBox } from "./Recall";
import { ChatPanel } from "./Assistant";

interface ArticleView {
  item: Item;
  article: { title: string; byline?: string; siteName?: string; excerpt?: string; image?: string; words: number; minutes: number; outline: { level: number; text: string; id: string }[]; linkOut: boolean; error?: string; html: string | null; hasText: boolean; url: string };
  history: Recall[];
}
interface Question { q: string; choices: string[]; answer: number; why: string }

export const fmtTime = (sec: number) => { const m = Math.floor(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

/** "I've finished": how long did it take? The timer's count, or the article's length when it was read elsewhere */
function FinishCard({ tracked, estimate, linkOut, onFinish }: { tracked: number; estimate: number; linkOut: boolean; onFinish: (minutes: number) => Promise<void> }) {
  const suggested = Math.max(1, Math.round(tracked / 60 >= 2 ? tracked / 60 : linkOut ? estimate || tracked / 60 : tracked / 60 || estimate));
  const [min, setMin] = React.useState<number | "">(suggested);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setMin((m) => (m === "" || m < suggested ? suggested : m)); }, [suggested]);
  return (
    <form className="finish-card finish-time" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onFinish(Number(min) || 0); } finally { setBusy(false); } }}>
      <div>
        <h2>Finished reading?</h2>
        <p className="muted">Log the time, then a five-question check (skip any of it) and one sentence from memory.</p>
      </div>
      <div className="time-entry">
        <label className="field inline"><span>Time spent</span>
          <span className="minutes"><input type="number" min={0} max={600} inputMode="numeric" aria-label="Minutes spent reading" value={min} onChange={(e) => setMin(e.target.value === "" ? "" : Math.max(0, Math.min(600, Number(e.target.value))))} /> min</span>
        </label>
        <span className="muted small">{tracked >= 60 ? `timer: ${fmtTime(tracked)}` : linkOut ? `read on the original site? the article is about ${estimate || "?"} min` : "the timer runs while you read here"}</span>
      </div>
      <button className="btn primary" disabled={busy}><Icon name="check" size={16} /> I’ve finished</button>
    </form>
  );
}

export function Reader({ id }: { id: string }) {
  const { data, loading, error, set } = useAsync(() => api<ArticleView>(`/api/items/${encodeURIComponent(id)}`), [id]);
  const [panel, setPanel] = React.useState<"none" | "assistant" | "outline">(() => (window.innerWidth > 1280 ? "outline" : "none"));
  const [selection, setSelection] = React.useState<{ text: string; x: number; y: number } | null>(null);
  const [ask, setAsk] = React.useState<{ text: string; n: number } | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [stage, setStage] = React.useState<"reading" | "quiz" | "recall" | "done">("reading");
  // arriving from the Chrome extension after finishing on the original site: straight to the quiz
  React.useEffect(() => {
    if (!data || new URLSearchParams(location.search).get("next") !== "quiz" || data.item.status !== "read") return;
    setStage(data.article.hasText ? "quiz" : "recall");
    history.replaceState(null, "", location.pathname);
    setTimeout(() => document.getElementById("finish")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }, [data?.item._id]);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const sent = React.useRef(0);

  // time reading: counts while the tab is visible and the reader has touched the page in the last 3 minutes;
  // sent every 30 s and when the page is left
  const [timeSec, setTimeSec] = React.useState(0);
  const pending = React.useRef(0);
  React.useEffect(() => {
    if (!data) return;
    setTimeSec(data.item.timeSec || 0);
    let lastActive = Date.now();
    const poke = () => { lastActive = Date.now(); };
    const evs = ["scroll", "mousemove", "keydown", "touchstart", "pointerdown"];
    evs.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    const flush = (beacon = false) => {
      const sec = pending.current; if (sec < 1) return;
      pending.current = 0;
      const url = `/api/items/${encodeURIComponent(id)}/time`, payload = JSON.stringify({ seconds: sec, tz: TZ });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      else void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    };
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActive < 180_000) { pending.current += 1; setTimeSec((t) => t + 1); }
    }, 1000);
    const send = setInterval(() => flush(), 30_000);
    const hide = () => { if (document.visibilityState === "hidden") flush(true); };
    const leave = () => flush(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => { clearInterval(tick); clearInterval(send); flush(); evs.forEach((e) => window.removeEventListener(e, poke)); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); };
  }, [data?.item._id, id]);

  // reading progress, saved every 10%
  React.useEffect(() => {
    if (!data) return;
    sent.current = data.item.progress || 0;
    const on = () => {
      const el = bodyRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (window.innerHeight - r.top) / (r.height || 1)));
      setProgress(p);
      if (p - sent.current >= 0.1) { sent.current = p; void api(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", body: { progress: p } }).catch(() => {}); }
    };
    window.addEventListener("scroll", on, { passive: true }); on();
    return () => window.removeEventListener("scroll", on);
  }, [data, id]);

  // select text → ask the assistant
  React.useEffect(() => {
    const up = () => setTimeout(() => {
      const s = window.getSelection();
      const t = s?.toString().trim() || "";
      if (!t || t.length < 3 || !bodyRef.current || !s?.anchorNode || !bodyRef.current.contains(s.anchorNode)) { setSelection(null); return; }
      const rect = s.getRangeAt(0).getBoundingClientRect();
      setSelection({ text: t.slice(0, 1500), x: rect.left + rect.width / 2, y: rect.top + window.scrollY - 8 });
    }, 10);
    document.addEventListener("mouseup", up); document.addEventListener("touchend", up);
    return () => { document.removeEventListener("mouseup", up); document.removeEventListener("touchend", up); };
  }, []);

  // a link-out page already lists its outline in the body
  React.useEffect(() => { if (data && (data.article.linkOut || !data.article.html) && panel === "outline") setPanel("none"); }, [data?.item._id]);

  if (loading && !data) return <div className="page"><Spinner label="Opening the article" /></div>;
  if (error || !data) return <div className="page"><p className="err">{error}</p><Link to="/library">Back to the library</Link></div>;
  const { item, article: a } = data;

  const markRead = async (minutes: number) => {
    const r = await api<{ item: Item }>(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "read", progress: 1, minutes } });
    set({ ...data, item: r.item });
    setStage(a.hasText ? "quiz" : "recall");
    setTimeout(() => document.getElementById("finish")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const removeItem = async () => {
    if (!confirm("Remove this from your list? Your recall notes stay in the notebook.")) return;
    await api(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Removed from your list"); go("/library");
  };
  const refetch = async () => { const v = await api<ArticleView>(`/api/items/${encodeURIComponent(id)}/refetch`, { method: "POST" }); set(v); };
  const askAbout = (text: string) => { setAsk({ text, n: Date.now() }); setPanel("assistant"); setSelection(null); window.getSelection()?.removeAllRanges(); };

  return (
    <div className={`reader ${panel !== "none" ? `with-${panel}` : ""}`}>
      <div className="read-progress" style={{ transform: `scaleX(${progress})` }} />
      <div className="read-bar">
        <button className="iconbtn" onClick={() => history.length > 1 ? history.back() : go("/library")} aria-label="Back"><Icon name="back" /></button>
        <span className="read-bar-title">{item.title || a.title}</span>
        <span className="read-clock" title="Time reading this article (counts while you are active on the page)"><Icon name="clock" size={14} /> {fmtTime(timeSec)}</span>
        <div className="read-bar-tools">
          {a.outline.length > 2 && <button className={`iconbtn ${panel === "outline" ? "on" : ""}`} onClick={() => setPanel(panel === "outline" ? "none" : "outline")} aria-label="Outline" title="Outline"><Icon name="outline" /></button>}
          {item.status !== "read" && stage === "reading" && <button className="btn sm primary" onClick={() => document.getElementById("finish")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Icon name="check" size={15} /> Finish</button>}
          <button className={`btn sm ${panel === "assistant" ? "primary" : "ghost"}`} onClick={() => setPanel(panel === "assistant" ? "none" : "assistant")}><Icon name="chat" size={16} /> Assistant</button>
        </div>
      </div>

      {panel === "outline" && (
        <aside className="outline" aria-label="Outline">
          <p className="eyebrow">In this article</p>
          <ol>{a.outline.filter((o) => o.level <= 3).map((o) => <li key={o.id} className={`lv${o.level}`}><a href={`#${o.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(o.id)?.scrollIntoView({ behavior: "smooth" }); }}>{o.text}</a></li>)}</ol>
        </aside>
      )}

      <article className="paper">
        <header className="paper-head">
          <p className="eyebrow"><Link to={`/library?shelf=${encodeURIComponent(item.topic)}`}>{item.topic}</Link>{(a.siteName || item.site) !== item.topic && <> · {a.siteName || item.site}</>}</p>
          <h1>{item.title || a.title}</h1>
          <p className="paper-meta">
            {a.byline && <span>{a.byline}</span>}
            {a.minutes > 0 && <span>{a.minutes} min read</span>}
            {postDate(item.date) && <span>{postDate(item.date)}</span>}
            <a href={item.url} target="_blank" rel="noopener noreferrer">{host(item.url)} <Icon name="ext" size={13} /></a>
          </p>
        </header>

        <div ref={bodyRef}>
          {a.error ? (
            <div className="card notice"><p>This page couldn’t be turned into a reading copy ({a.error}).</p>
              <div className="row-actions"><a className="btn primary" href={item.url} target="_blank" rel="noopener noreferrer">Read on {host(item.url)} <Icon name="ext" size={15} /></a><button className="btn ghost" onClick={refetch}><Icon name="refresh" size={15} /> Try again</button></div></div>
          ) : a.linkOut || !a.html ? (
            <div className="linkout">
              {(item.summary || a.excerpt) && <p className="linkout-sum">{(item.summary || a.excerpt)!.replace(/([^.!?…])$/, "$1…")}</p>}
              {a.outline.length > 0 && <><p className="eyebrow">What it covers</p><ol className="linkout-toc">{a.outline.filter((o) => o.level <= 3).slice(0, 18).map((o) => <li key={o.id} className={`lv${o.level}`}>{o.text}</li>)}</ol></>}
              <div className="linkout-cta">
                <a className="btn primary" href={item.url} target="_blank" rel="noopener noreferrer">Read it on {a.siteName || host(item.url)} <Icon name="ext" size={15} /></a>
                <p className="muted">{a.siteName || host(item.url)} is read on its own site, at the author’s request. The assistant, the quiz and recall all know the article, so come back here when you’re done.</p>
                <p className="muted small">With the <Link to="/account#extension">Reading Room extension</Link>, a timer and a Finish button appear on the article itself.</p>
              </div>
            </div>
          ) : (
            <div className="prose" dangerouslySetInnerHTML={{ __html: a.html }} />
          )}
        </div>

        <section id="finish" className="finish">
          {stage === "reading" && (
            item.status === "read" ? (
              <div className="finish-card">
                <div><h2>You’ve read this</h2><p className="muted">{item.recall?.due ? `Next recall ${until(item.recall.due)}.` : ""} {item.quiz ? `Best quiz: ${item.quiz.score}/${item.quiz.total}.` : ""}</p></div>
                <div className="row-actions">
                  {a.hasText && <button className="btn ghost" onClick={() => setStage("quiz")}>Take the quiz</button>}
                  <button className="btn primary" onClick={() => setStage("recall")}>Recall it now</button>
                </div>
              </div>
            ) : (
              <FinishCard tracked={timeSec} estimate={a.minutes} linkOut={a.linkOut || !a.html} onFinish={markRead} />
            )
          )}
          {stage === "quiz" && <QuizFlow id={id} onDone={() => setStage("recall")} />}
          {stage === "recall" && (
            <RecallBox item={item} kind="after-read" lastNudge={data.history[0]?.nudge}
              onDone={(r, it) => { set({ ...data, item: it, history: [r, ...data.history] }); setStage("done"); }}
              onSkip={() => setStage("done")} />
          )}
          {stage === "done" && (
            <div className="finish-card">
              <div><h2>Kept.</h2><p className="muted">{data.item.recall?.due ? `It will come back to you ${until(data.item.recall.due)} in your daily recall.` : "It joins your daily recall from tomorrow."}</p></div>
              <div className="row-actions"><Link to="/library?status=new" className="btn ghost">Next unread</Link><Link to="/" className="btn primary">Back to today</Link></div>
            </div>
          )}
        </section>

        {data.history.length > 0 && (
          <section className="history">
            <h2 className="eyebrow">Your notes on this, oldest last</h2>
            <ol className="timeline">
              {data.history.map((r) => (
                <li key={r._id}><div className="tl-dot" /><div className="tl-body"><p className="tl-text">“{r.text}”</p><p className="tl-meta">{ago(r.at)} <Score value={r.score} />{r.verdict && <span> · {r.verdict}</span>}</p></div></li>
              ))}
            </ol>
          </section>
        )}
        <footer className="paper-foot">
          <button className="linkbtn danger" onClick={removeItem}><Icon name="trash" size={14} /> Remove from list</button>
          <span className="muted">Added {ago(item.addedAt)} from {item.site}</span>
        </footer>
      </article>

      {panel === "assistant" && (
        <aside className="assist" aria-label="Reading assistant">
          <div className="assist-head"><h2><Icon name="chat" size={17} /> Reading assistant</h2><button className="iconbtn" onClick={() => setPanel("none")} aria-label="Close assistant"><Icon name="x" /></button></div>
          <ChatPanel itemId={id} compact seed={ask} suggestions={[`Explain the main idea of “${a.title}” simply`, "What should I remember from this?", "Quiz me with one hard question", "How does this connect to what I’ve read before?"]} />
        </aside>
      )}

      {selection && (
        <button className="sel-pop" style={{ left: selection.x, top: selection.y }} onMouseDown={(e) => e.preventDefault()} onClick={() => askAbout(selection.text)}>
          <Icon name="chat" size={15} /> Ask about this
        </button>
      )}
    </div>
  );
}

function QuizFlow({ id, onDone }: { id: string; onDone: () => void }) {
  const { data, error, loading } = useAsync(() => api<{ quiz: { questions: Question[] } }>(`/api/items/${encodeURIComponent(id)}/quiz`), [id]);
  const [i, setI] = React.useState(0);
  const [answers, setAnswers] = React.useState<(number | null)[]>([]);
  const [picked, setPicked] = React.useState<number | null>(null);
  const finish = async (all: (number | null)[]) => {
    if (all.some((x) => x !== null)) await api(`/api/items/${encodeURIComponent(id)}/quiz`, { body: { answers: all } }).catch(() => {});
    onDone();
  };
  if (loading) return <div className="card quiz"><Spinner label="Writing your quiz from the article" /></div>;
  if (error || !data) return <div className="card quiz"><p className="muted">{error || "No quiz for this one."}</p><button className="btn primary" onClick={onDone}>Go to recall</button></div>;
  const qs = data.quiz.questions;
  if (i >= qs.length) {
    const right = answers.filter((a, k) => a !== null && a === qs[k].answer).length, answered = answers.filter((a) => a !== null).length;
    return (
      <div className="card quiz">
        <p className="eyebrow">Quiz · done</p>
        <h2 className="quiz-score">{right}<small>/{answered || qs.length}</small></h2>
        <p className="muted">{answered < qs.length ? `${qs.length - answered} skipped. ` : ""}{right === answered && answered ? "Clean sweep." : "The ones you missed are the best ones to recall."}</p>
        <button className="btn primary" onClick={() => finish(answers)}>Now, from memory <Icon name="arrow" size={16} /></button>
      </div>
    );
  }
  const q = qs[i];
  const next = (a: number | null) => { const all = [...answers, a]; setAnswers(all); setPicked(null); setI(i + 1); };
  return (
    <div className="card quiz">
      <div className="quiz-top"><p className="eyebrow">Question {i + 1} of {qs.length}</p><button className="linkbtn" onClick={() => finish([...answers, ...Array(qs.length - answers.length).fill(null)])}>Skip the quiz</button></div>
      <div className="quiz-dots">{qs.map((_, k) => <i key={k} className={k < i ? (answers[k] === null ? "skip" : answers[k] === qs[k].answer ? "ok" : "no") : k === i ? "cur" : ""} />)}</div>
      <h3 className="quiz-q">{q.q}</h3>
      <div className="choices">
        {q.choices.map((c, k) => {
          const cls = picked === null ? "" : k === q.answer ? "right" : k === picked ? "wrong" : "dim";
          return <button key={k} className={`choice ${cls}`} disabled={picked !== null} onClick={() => setPicked(k)}><span className="choice-k">{"ABCDE"[k]}</span>{c}</button>;
        })}
      </div>
      {picked !== null ? (
        <div className={`quiz-why ${picked === q.answer ? "ok" : "no"}`}><b>{picked === q.answer ? "Right." : "Not quite."}</b> {q.why}
          <div><button className="btn primary sm" onClick={() => next(picked)}>{i + 1 < qs.length ? "Next" : "See result"} <Icon name="arrow" size={15} /></button></div></div>
      ) : <div className="quiz-foot"><button className="btn ghost sm" onClick={() => next(null)}><Icon name="skip" size={14} /> Skip this question</button></div>}
    </div>
  );
}
