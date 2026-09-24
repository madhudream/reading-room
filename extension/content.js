// Reading Room — on the article's own site.
// When the page is in the reader's list, a small pill appears: Start reading → the time counts while
// this tab is focused (and the reader is not idle for 5 minutes) → I've finished → minutes are logged
// and the quiz and recall open in the Reading Room. A started article resumes by itself on return.
(() => {
  if (window.top !== window || window.__readingRoom) return;
  window.__readingRoom = true;

  const IDLE_MS = 5 * 60_000, SEND_MS = 30_000, DIGEST_MAX_S = 30 * 60;
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })); } catch (e) { res({ ok: false, error: String(e) }); } });

  // reading: false | true | "digest" | "finishing". Digesting counts whether or not the tab is in front:
  // stepping away to think a long post over is part of reading it.
  let item = null, reading = false, total = 0, pending = 0, lastInput = Date.now(), minimized = false, finished = null;
  let readSec = 0, digestSec = 0, digestRun = 0;
  let host, root, tick, flushTimer, url = location.href;

  const focused = () => document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInput < IDLE_MS;
  const fmt = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return m < 60 ? `${m}:${String(s).padStart(2, "0")}` : `${Math.floor(m / 60)}h ${m % 60}m`; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  for (const e of ["scroll", "mousemove", "keydown", "pointerdown", "touchstart", "wheel"]) addEventListener(e, () => { lastInput = Date.now(); }, { passive: true, capture: true });

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; width: 300px; background: #fffdf8; color: #221e19; border: 1px solid #e6dece; border-radius: 18px; box-shadow: 0 2px 4px rgba(60,40,20,.08), 0 24px 50px -20px rgba(60,40,20,.45); overflow: hidden; font-size: 14px; line-height: 1.4; }
    .pill.in { animation: up .35s cubic-bezier(.16,1,.3,1); }
    @keyframes up { from { opacity: 0; transform: translateY(12px); } }
    .head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 14px; }
    .mark { width: 26px; height: 26px; border-radius: 8px; background: #b4432a; display: grid; place-items: center; flex: none; }
    .mark i { display: block; width: 11px; height: 14px; background: #fffaf2; border-radius: 2px; position: relative; }
    .mark i::after { content: ""; position: absolute; right: 2px; top: 0; width: 3px; height: 8px; background: #f2c14e; clip-path: polygon(0 0,100% 0,100% 100%,50% 75%,0 100%); }
    .who { flex: 1; min-width: 0; }
    .kicker { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #b4432a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .title { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x { border: 0; background: none; color: #8f8474; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 6px; border-radius: 8px; }
    .x:hover { background: #efe8da; color: #221e19; }
    .body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    .clock { display: flex; align-items: baseline; justify-content: space-between; }
    .time { font: 700 28px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .state { font-size: 12px; color: #8f8474; display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #c9bfae; }
    .dot.on { background: #4a6b3a; box-shadow: 0 0 0 3px #e4ecd9; animation: pulse 1.6s infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 5px rgba(74,107,58,.12); } }
    .dot.dig { background: #a4761c; box-shadow: 0 0 0 3px #f6ebcf; animation: pulse 2.4s infinite; }
    .row { display: flex; gap: 8px; }
    button.btn { flex: 1 1 auto; min-width: 0; padding: 0 10px; height: 38px; border-radius: 11px; border: 1px solid transparent; font-weight: 700; font-size: 13.5px; cursor: pointer; }
    .primary { background: #b4432a; color: #fffaf2; box-shadow: inset 0 -2px 0 rgba(0,0,0,.14); }
    .primary:hover { background: #9c3a24; }
    .ghost { background: #fffdf8; border-color: #d7ccb8 !important; color: #221e19; }
    .ghost:hover { background: #efe8da; }
    .min { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #5b5348; }
    .min input { width: 70px; height: 34px; border: 1px solid #d7ccb8; border-radius: 9px; padding: 0 8px; font-size: 15px; text-align: right; background: #f7f3ea; color: #221e19; }
    .min input:focus { outline: 2px solid #b4432a; outline-offset: 1px; }
    .note { font-size: 12px; color: #8f8474; }
    .ok { background: #e4ecd9; color: #4a6b3a; border-radius: 12px; padding: 10px 12px; font-weight: 600; }
    a.link { color: #b4432a; font-weight: 700; text-decoration: none; }
    a.link:hover { text-decoration: underline; }
    .mini { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 8px; border-radius: 999px; background: #fffdf8; border: 1px solid #e6dece; box-shadow: 0 16px 30px -16px rgba(60,40,20,.5); cursor: pointer; font: 700 13px ui-monospace, Menlo, monospace; color: #221e19; }
    @media (prefers-color-scheme: dark) {
      .pill, .mini { background: #1e1b17; color: #ece5d8; border-color: #332e28; }
      .ghost { background: #1e1b17; color: #ece5d8; border-color: #443d34 !important; }
      .ghost:hover, .x:hover { background: #2a251f; color: #ece5d8; }
      .min input { background: #181613; color: #ece5d8; border-color: #443d34; }
      .min, .note, .state { color: #b9ae9d; }
      .ok { background: #243021; color: #9cc083; }
      .kicker, a.link { color: #e7866b; }
    }`;

  function mount() {
    if (host) return;
    host = document.createElement("reading-room-pill");
    root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }
  function unmount() { host?.remove(); host = root = null; }

  function render() {
    if (!item) { unmount(); return; }
    const fresh = !host; // slide in once, not on every one-second refresh
    mount();
    const shown = total + pending;
    if (minimized) {
      root.innerHTML = `<style>${CSS}</style><button class="mini" data-a="expand" title="Reading Room"><span class="mark"><i></i></span>${reading ? fmt(shown) : "Reading Room"}</button>`;
      return bind();
    }
    let body;
    if (finished) {
      body = `<div class="ok">Kept: ${finished.minutes} min logged.</div>
        <a class="link" href="${esc(finished.next)}" target="_blank" rel="noopener">Take the quiz and recall it →</a>`;
    } else if (item.status === "read" && !reading) {
      body = `<div class="note">You finished this${item.enteredMin ? ` · ${item.enteredMin} min` : ""}. Its recall comes back in your daily practice.</div>
        <div class="row"><button class="btn ghost" data-a="start">Read again</button></div>`;
    } else if (!reading) {
      body = `<div class="clock"><span class="time">${fmt(shown)}</span><span class="state"><span class="dot"></span>${shown ? "paused" : "not started"}</span></div>
        <div class="row"><button class="btn primary" data-a="start">${shown ? "Resume reading" : "Start reading"}</button>${shown ? `<button class="btn ghost" data-a="finish">I’ve finished</button>` : ""}</div>
        <div class="note">Time counts only while this tab is in front of you.</div>`;
    } else if (reading === "finishing") {
      body = `<label class="min">Time spent <input type="number" min="0" max="600" value="${Math.max(1, Math.round(shown / 60))}" data-min aria-label="Minutes spent reading"> min</label>
        <div class="row"><button class="btn primary" data-a="save">Save &amp; finish</button><button class="btn ghost" data-a="back">Back</button></div>
        <div class="note">${readSec || digestSec ? `This visit: ${fmt(readSec)} reading + ${fmt(digestSec)} digesting. ` : ""}Adjust it if you read some of it elsewhere.</div>`;
    } else if (reading === "digest") {
      body = `<div class="clock"><span class="time">${fmt(shown)}</span><span class="state"><span class="dot dig"></span>digesting ${fmt(digestRun)}</span></div>
        <div class="row"><button class="btn primary" data-a="resume">Back to reading</button><button class="btn ghost" data-a="finish">I’ve finished</button></div>
        <div class="note">Thinking it over counts, even away from the screen. Stops by itself after 30 minutes.</div>`;
    } else {
      const on = focused();
      body = `<div class="clock"><span class="time">${fmt(shown)}</span><span class="state"><span class="dot ${on ? "on" : ""}"></span>${on ? "reading" : document.hasFocus() ? "idle" : "paused: tab not focused"}</span></div>
        <div class="row"><button class="btn primary" data-a="finish">I’ve finished</button><button class="btn ghost" data-a="digest" title="Keep counting while you think it over">Digest</button><button class="btn ghost" data-a="pause" title="Stop the timer">Pause</button></div>`;
    }
    root.innerHTML = `<style>${CSS}</style><div class="pill${fresh ? " in" : ""}" role="dialog" aria-label="Reading Room">
      <div class="head"><span class="mark"><i></i></span><div class="who"><div class="kicker">Reading Room${item.topic ? ` · ${esc(item.topic)}` : ""}</div><div class="title">${esc(item.title || document.title)}</div></div>
      <button class="x" data-a="min" title="Minimise" aria-label="Minimise">–</button></div>
      <div class="body">${body}</div></div>`;
    bind();
  }

  function bind() {
    root.querySelectorAll("[data-a]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); act(el.dataset.a); }));
    const inp = root.querySelector("[data-min]");
    if (inp) { inp.focus(); inp.select(); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") act("save"); }); }
  }

  async function flush() {
    if (!item || pending < 1) return;
    const seconds = pending; pending = 0; total += seconds;
    const r = await send({ type: "time", id: item.id, seconds });
    if (!r.ok) pending += seconds, total -= seconds; // keep it for the next try
  }

  function startTimer() {
    stopTimer();
    // re-render each second, except while the minutes field is open (it would lose what is typed)
    tick = setInterval(() => {
      if (reading === true && focused()) { pending++; readSec++; }
      else if (reading === "digest") {
        pending++; digestSec++; digestRun++;
        if (digestRun >= DIGEST_MAX_S) { reading = false; digestRun = 0; flush(); stopTimer(); send({ type: "pause", id: item.id }); } // forgotten: stop at 30 minutes
      }
      if (reading !== "finishing") render();
    }, 1000);
    flushTimer = setInterval(flush, SEND_MS);
  }
  function stopTimer() { clearInterval(tick); clearInterval(flushTimer); tick = flushTimer = null; }

  async function act(a) {
    if (a === "min") { minimized = true; return render(); }
    if (a === "expand") { minimized = false; return render(); }
    if (a === "start") {
      const r = await send({ type: "start", url: location.href, title: document.title });
      if (!r.ok) return alertInPill(r.error);
      item = { ...item, ...r.item }; total = item.timeSec || total; reading = true; finished = null; lastInput = Date.now(); startTimer(); return render();
    }
    if (a === "pause") { await flush(); reading = false; stopTimer(); await send({ type: "pause", id: item.id }); return render(); }
    if (a === "digest") { reading = "digest"; digestRun = 0; if (!tick) startTimer(); return render(); }
    if (a === "resume") { reading = true; digestRun = 0; lastInput = Date.now(); return render(); }
    if (a === "finish") { if (!tick) startTimer(); reading = "finishing"; return render(); }
    if (a === "back") { reading = true; return render(); }
    if (a === "save") {
      const minutes = Number(root.querySelector("[data-min]")?.value) || 0;
      await flush();
      const r = await send({ type: "finish", id: item.id, minutes });
      if (!r.ok) return alertInPill(r.error);
      stopTimer(); reading = false; item = { ...item, status: "read", enteredMin: minutes }; finished = { minutes, next: r.next };
      return render();
    }
  }
  function alertInPill(msg) { const n = root?.querySelector(".note") || root?.querySelector(".body"); if (n) { n.textContent = msg || "Something went wrong."; n.style.color = "#b3412f"; } }

  async function check() {
    const r = await send({ type: "match", url: location.href });
    if (!r.ok || !r.item) { if (!reading) { item = null; stopTimer(); unmount(); } return; }
    item = r.item; total = item.timeSec || 0;
    if (r.reading && item.status !== "read") { reading = true; startTimer(); } // it was started before: resume by itself
    render();
  }

  // leave nothing uncounted
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); render(); });
  addEventListener("blur", () => render());
  addEventListener("focus", () => render());
  addEventListener("pagehide", () => { flush(); });

  // the popup can start reading this page too
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === "page:start") { act("start").then(() => reply({ ok: true })); return true; }
    if (msg?.type === "page:state") { reply({ item, reading: !!reading, seconds: total + pending }); return false; }
    return false;
  });

  // single-page sites change the URL without a reload
  setInterval(() => { if (location.href !== url) { url = location.href; flush(); reading = false; finished = null; stopTimer(); check(); } }, 1500);
  check();
})();
