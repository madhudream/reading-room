// Reading Room — the extension's background worker.
// It holds the sign-in token, keeps a copy of the reader's list of URLs, and talks to the server.
// Pages are matched against that list here, on the reader's machine: browsing history never leaves it.

const DEFAULT_BASE = "https://reading.carebun.com";
const REFRESH_MS = 10 * 60_000;
let cache = { at: 0, byUrl: new Map() };

const store = {
  get: (k) => chrome.storage.local.get(k),
  set: (o) => chrome.storage.local.set(o),
  del: (k) => chrome.storage.local.remove(k),
};
async function cfg() { const s = await store.get(["token", "user", "base"]); return { token: s.token || "", user: s.user || null, base: s.base || DEFAULT_BASE }; }

/** the same normal form the server uses: no fragment, no tracking parameters, no trailing slash */
function canon(u) {
  try {
    const x = new URL(u); x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/.test(k)) x.searchParams.delete(k);
    x.hostname = x.hostname.replace(/^www\./, "");
    return x.toString().replace(/\/$/, "");
  } catch { return u; }
}

async function api(path, opts = {}) {
  const { token, base } = await cfg();
  const r = await fetch(base + path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-tz": Intl.DateTimeFormat().resolvedOptions().timeZone, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { await store.del(["token", "user"]); cache = { at: 0, byUrl: new Map() }; }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

async function list(force = false) {
  const { token } = await cfg();
  if (!token) return new Map();
  if (!force && Date.now() - cache.at < REFRESH_MS) return cache.byUrl;
  const r = await api("/api/urls");
  const byUrl = new Map();
  for (const it of r.items) byUrl.set(canon(it.url), it);
  cache = { at: Date.now(), byUrl };
  return byUrl;
}

async function match(url) { return (await list()).get(canon(url)) || null; }

function badge(tabId, text) { if (tabId != null) chrome.action.setBadgeText({ tabId, text }).catch(() => {}); chrome.action.setBadgeBackgroundColor({ color: "#b4432a" }).catch(() => {}); }

const handlers = {
  async state() { const c = await cfg(); return { signedIn: !!c.token, user: c.user, base: c.base }; },
  async login({ username, password, base }) {
    if (base) await store.set({ base: base.replace(/\/+$/, "") });
    const r = await api("/api/ext/login", { body: { username, password } });
    await store.set({ token: r.token, user: r.user });
    await list(true);
    return { ok: true, user: r.user };
  },
  async logout() { await store.del(["token", "user", "active"]); cache = { at: 0, byUrl: new Map() }; return { ok: true }; },
  async match({ url }) {
    const it = await match(url);
    const { active = {} } = await store.get("active");
    return { item: it, reading: !!(it && active[it.id]) };
  },
  /** "Start reading": add the page when it is not in the list yet, then remember it is being read */
  async start({ url, title }) {
    let it = await match(url);
    if (!it) { const r = await api("/api/items/add", { body: { url, title } }); await list(true); it = (await match(url)) || { id: r.id, url, title, status: "new", timeSec: 0 }; }
    const { active = {} } = await store.get("active");
    active[it.id] = Date.now(); await store.set({ active });
    return { item: it };
  },
  async pause({ id }) { const { active = {} } = await store.get("active"); delete active[id]; await store.set({ active }); return { ok: true }; },
  async time({ id, seconds }, sender) {
    const r = await api(`/api/items/${encodeURIComponent(id)}/time`, { body: { seconds } });
    const it = cache.byUrl.size ? [...cache.byUrl.values()].find((x) => x.id === id) : null;
    if (it) it.timeSec = r.timeSec;
    badge(sender?.tab?.id, `${Math.round(r.timeSec / 60)}m`);
    return r;
  },
  async finish({ id, minutes }) {
    const r = await api(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "read", progress: 1, minutes } });
    const { active = {} } = await store.get("active"); delete active[id]; await store.set({ active });
    await list(true);
    const { base } = await cfg();
    return { item: r.item, next: `${base}/read/${encodeURIComponent(id)}?next=quiz` };
  },
  async today() { return api("/api/today"); },
  async open({ path }) { const { base } = await cfg(); await chrome.tabs.create({ url: base + (path || "/") }); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg, sender).then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: e.message }));
  return true; // async reply
});
