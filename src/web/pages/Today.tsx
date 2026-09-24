import React from "react";
import { api, ago, until } from "../api";
import { Empty, Icon, Link, Monogram, Score, Spinner, useAsync, type Item, type Me, type Recall } from "../ui";

interface TodayData {
  queue: Item[]; doneToday: number; streak: number; heat: { day: string; n: number }[];
  counts: { total: number; read: number; reading: number; new: number; notes: number };
  avgRecall: number | null; readToday: number; readWeek: number; continue: Item[]; upNext: Item[]; lastNotes: Recall[];
}

const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Heat({ heat }: { heat: TodayData["heat"] }) {
  // 16 weeks, columns are weeks, rows are weekdays
  const first = new Date(heat[0].day + "T12:00:00");
  const pad = first.getDay();
  const cells = [...Array(pad).fill(null), ...heat];
  const cols: (typeof heat[number] | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
  const lvl = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
  const total = heat.reduce((a, b) => a + b.n, 0);
  return (
    <figure className="heat" aria-label={`${total} recall notes in the last 16 weeks`}>
      <div className="heat-grid">{cols.map((c, i) => <div key={i} className="heat-col">{c.map((d, j) => d ? <i key={j} className={`l${lvl(d.n)}`} title={`${d.day}: ${d.n} recall${d.n === 1 ? "" : "s"}`} /> : <i key={j} className="blank" />)}</div>)}</div>
      <figcaption><span>16 weeks</span><span className="heat-key">less <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /> more</span></figcaption>
    </figure>
  );
}

export function Today({ me }: { me: Me }) {
  const { data, loading, error } = useAsync(() => api<TodayData>("/api/today"), []);
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (loading && !data) return <div className="page"><Spinner label="Opening your desk" /></div>;
  if (error || !data) return <div className="page"><p className="err">{error}</p></div>;
  const d = data;
  const first = d.counts.total === 0;
  return (
    <div className="page">
      <header className="today-head">
        <p className="eyebrow">{date}</p>
        <h1 className="display">{greeting()}, {me.name.split(" ")[0]}.</h1>
        {!first && <p className="lede">{d.queue.length ? <>You have <b>{d.queue.length}</b> thing{d.queue.length === 1 ? "" : "s"} to recall today{d.doneToday ? <>, and you’ve already done {d.doneToday}</> : null}.</> : d.doneToday ? <>Today’s recall is done: {d.doneToday} note{d.doneToday === 1 ? "" : "s"} written. Well kept.</> : <>Nothing to recall yet. Finish an article and it joins your daily practice.</>}</p>}
      </header>

      {first ? (
        <section className="welcome card">
          <div>
            <h2>Start your list</h2>
            <p>Take a shared shelf from Discover (Outcome School’s AI posts, Thinking in Vectors, Memory for AI Agents, the HanuDB docs), or point the room at any blog and say what you want.</p>
            <div className="chips">
              <Link className="chip" to={`/add?q=${encodeURIComponent("AI blogs only from https://outcomeschool.com/blog")}`}>AI blogs only from outcomeschool.com/blog</Link>
              <Link className="chip" to={`/add?q=${encodeURIComponent("Add all blogs from https://memory-notes-246726325229.us-central1.run.app/")}`}>All of Memory for AI Agents</Link>
            </div>
          </div>
          <div className="row-actions"><Link to="/discover" className="btn primary">Browse shared shelves <Icon name="arrow" size={16} /></Link><Link to="/add" className="btn ghost">Add a blog</Link></div>
        </section>
      ) : (
        <div className="today-grid">
          <section className="card recall-card">
            <div className="card-head">
              <h2><Icon name="recall" /> Recall today</h2>
              {d.queue.length > 0 && <Link to="/recall" className="btn primary sm">Begin <Icon name="arrow" size={15} /></Link>}
            </div>
            {d.queue.length ? (
              <ul className="deck">
                {d.queue.slice(0, 5).map((it, i) => (
                  <li key={it._id} style={{ ["--i" as string]: i }}>
                    <Link to="/recall" className="deck-card">
                      <span className="deck-topic">{it.topic}</span>
                      <span className="deck-title">{it.title}</span>
                      <span className="deck-meta">{it.recall?.count ? `recalled ${it.recall.count}× · last ${ago(it.recall.lastAt)}` : "first recall"}{it.overdue ? "" : " · a bonus review"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty icon="check" title={d.doneToday ? "All done for today" : "Your deck is empty"}>{d.doneToday ? <p>Come back tomorrow; the next cards come due on their own.</p> : <p>Read something and mark it finished. It shows up here the next day.</p>}</Empty>}
          </section>

          <section className="card stats">
            <div className="streak">
              <Icon name="flame" size={30} className={d.streak ? "lit" : ""} />
              <div><b>{d.streak}</b><span>day streak</span></div>
            </div>
            <div className="readtime"><Icon name="clock" size={16} /><span><b>{fmtMin(d.readToday)}</b> reading today</span><span className="muted">{fmtMin(d.readWeek)} this week</span></div>
            <Heat heat={d.heat} />
            <dl className="nums">
              <div><dt>Read</dt><dd>{d.counts.read}<small>/{d.counts.total}</small></dd></div>
              <div><dt>Notes</dt><dd>{d.counts.notes}</dd></div>
              <div><dt>Recall</dt><dd>{d.avgRecall === null ? "–" : d.avgRecall.toFixed(1)}<small>/5</small></dd></div>
            </dl>
          </section>

          {d.continue.length > 0 && (
            <section className="card span2">
              <div className="card-head"><h2><Icon name="book" /> Continue reading</h2></div>
              <ul className="rows">{d.continue.map((it) => <Row key={it._id} it={it} />)}</ul>
            </section>
          )}

          <section className="card">
            <div className="card-head"><h2><Icon name="library" /> Up next</h2><Link to="/library?status=new" className="more">All unread <Icon name="arrow" size={14} /></Link></div>
            {d.upNext.length ? <ul className="rows compact">{d.upNext.map((it) => <Row key={it._id} it={it} />)}</ul> : <p className="muted">Everything on your list has been opened. <Link to="/add">Add more</Link>.</p>}
          </section>

          <section className="card">
            <div className="card-head"><h2><Icon name="notebook" /> Lately, in your words</h2><Link to="/notebook" className="more">Notebook <Icon name="arrow" size={14} /></Link></div>
            {d.lastNotes.length ? (
              <ul className="notes-mini">{d.lastNotes.map((n) => (
                <li key={n._id}><p>“{n.text}”</p><span>{n.title} · {ago(n.at)} <Score value={n.score} /></span></li>
              ))}</ul>
            ) : <p className="muted">Your recall notes will collect here.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

export function Row({ it }: { it: Item }) {
  return (
    <li>
      <Link to={`/read/${encodeURIComponent(it._id)}`} className="row">
        <Monogram url={it.url} site={it.site} />
        <span className="row-body">
          <span className="row-title">{it.title}</span>
          <span className="row-meta">
            <span>{it.site}</span>
            {it.status === "reading" && it.progress ? <span className="pbar" aria-label={`${Math.round(it.progress * 100)}% read`}><i style={{ width: `${Math.round(it.progress * 100)}%` }} /></span> : null}
            {it.recall?.due && it.status === "read" ? <span>recall {until(it.recall.due)}</span> : null}
          </span>
        </span>
        <Icon name="arrow" size={16} className="row-go" />
      </Link>
    </li>
  );
}
