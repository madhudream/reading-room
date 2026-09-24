const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })));
const fmt = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

async function show() {
  const st = await send({ type: "state" });
  $("#signin").hidden = st.signedIn; $("#main").hidden = !st.signedIn;
  $("#who").textContent = st.user ? `@${st.user.username}` : "";
  if (!st.signedIn) return;
  send({ type: "today" }).then((t) => { $("#today").textContent = t.ok ? fmt(t.readToday || 0) : "–"; });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const web = tab?.url && /^https?:/.test(tab.url) && !/reading\.carebun\.com|localhost:3500/.test(tab.url);
  if (!web) { $("#pstate").textContent = "This page"; $("#ptitle").textContent = "Open an article to time your reading."; $("#start").hidden = true; return; }
  const m = await send({ type: "match", url: tab.url });
  $("#ptitle").textContent = m.item?.title || tab.title || tab.url;
  if (m.item) {
    $("#pstate").textContent = m.item.status === "read" ? "In your list · finished" : `In your list${m.item.topic ? ` · ${m.item.topic}` : ""}`;
    $("#start").textContent = m.reading ? "Reading now" : m.item.status === "read" ? "Read again" : "Start reading";
    $("#start").disabled = !!m.reading;
    $("#phint").textContent = m.reading ? "The timer runs while that tab is focused. Finish from the pill on the page." : "";
  } else {
    $("#pstate").textContent = "Not in your list";
    $("#start").textContent = "Add & start reading";
    $("#phint").textContent = "It goes on the “Saved from the web” shelf.";
  }
  $("#start").onclick = async () => {
    $("#start").disabled = true;
    const r = await new Promise((res) => chrome.tabs.sendMessage(tab.id, { type: "page:start" }, (x) => res(x || { ok: false, error: chrome.runtime.lastError?.message })));
    if (!r.ok) { $("#phint").textContent = "Reload the page once (the extension was just installed), then try again."; $("#start").disabled = false; return; }
    show();
  };
}

$("#login").addEventListener("submit", async (e) => {
  e.preventDefault(); $("#err").textContent = "";
  const f = new FormData(e.target);
  const r = await send({ type: "login", username: f.get("username"), password: f.get("password"), base: f.get("base") || undefined });
  if (!r.ok) { $("#err").textContent = r.error; return; }
  show();
});
$("#logout").addEventListener("click", async () => { await send({ type: "logout" }); show(); });
document.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); send({ type: "open", path: a.dataset.open }); window.close(); }));
show();
