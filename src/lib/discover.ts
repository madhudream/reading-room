/**
 * discover — turn "add the AI blogs from https://outcomeschool.com/blog" into a list of
 * articles (title, slug, url, summary, tags), then keep the ones the reader asked for.
 *
 * Finding the articles, in order of how much a site tells us:
 *  1. Next.js sites ship their post index in __NEXT_DATA__ (Outcome School: all 255 posts,
 *     with tags and summaries, in one request).
 *  2. RSS / Atom feeds.
 *  3. The links on the page itself: same-site links that carry a heading or a real title,
 *     following "next page" links up to 25 pages.
 *  4. sitemap.xml, when the page has almost no links.
 * A URL that is itself an article becomes a list of one.
 *
 * Filtering: "all" keeps everything (minus obvious non-articles). Anything else ("AI
 * only", "just the ones about Kubernetes") is judged by the fast model over titles,
 * tags and summaries, in batches, and returns a short topic label for the shelf.
 */
import { parseHTML } from "linkedom";
import * as ai from "./ai";

export interface Candidate { url: string; slug: string; title: string; summary?: string; tags?: string[]; date?: string; readingTime?: string }
export interface Discovery { source: string; siteName: string; method: string; candidates: Candidate[] }

const UA = "Mozilla/5.0 (compatible; MadhuLMS/1.0; +https://madhudream.dev) reading-list";
const NON_ARTICLE = /\/(tag|tags|category|categories|author|authors|page|search|login|signin|signup|register|account|cart|pricing|contact|about|privacy|terms|feed|rss|courses?|jobs?|careers?|faq|help|support|newsletter|subscribe)(\/|$)|\.(png|jpe?g|gif|svg|webp|css|js|xml|pdf|zip|ico)$/i;

export async function fetchText(url: string, ms = 20_000): Promise<{ text: string; url: string; type: string }> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return { text: await r.text(), url: r.url || url, type: r.headers.get("content-type") || "" };
}

export const canon = (u: string) => {
  try { const x = new URL(u); x.hash = ""; for (const p of [...x.searchParams.keys()]) if (/^utm_|^ref$/.test(p)) x.searchParams.delete(p); return x.toString().replace(/\/$/, ""); } catch { return u; }
};
export const slugOf = (u: string) => { try { return new URL(u).pathname.split("/").filter(Boolean).pop() || new URL(u).hostname; } catch { return u; } };
const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
const titleFromSlug = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function parseCommand(input: string): { urls: string[]; instruction: string } {
  const urls = [...input.matchAll(/https?:\/\/[^\s,;"'<>)]+/g)].map((m) => m[0].replace(/[.)]+$/, ""));
  const instruction = clean(input.replace(/https?:\/\/[^\s,;"'<>)]+/g, " ").replace(/\b(please|from|at|on|the site|this site|into|to my|my|learning list|list|lms|pull( up)?|import|add|in)\b/gi, " "));
  return { urls, instruction };
}

// ---------------------------------------------------------------- 1. __NEXT_DATA__
function fromNextData(html: string, base: URL, doc: Document): Candidate[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data: unknown;
  try { data = JSON.parse(m[1]); } catch { return []; }
  let best: Record<string, unknown>[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      const posts = v.filter((x) => x && typeof x === "object" && typeof (x as Record<string, unknown>).title === "string" && typeof ((x as Record<string, unknown>).slug ?? (x as Record<string, unknown>).path) === "string");
      if (posts.length >= 3 && posts.length > best.length) best = posts as Record<string, unknown>[];
      for (const x of v.slice(0, 50)) walk(x, depth + 1);
    } else for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(data, 0);
  if (!best.length) return [];
  // learn the URL pattern from a link on the page that ends in a known slug
  const hrefs = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "");
  const firstSlug = String(best[0].slug ?? best[0].path).replace(/^\/+/, "");
  const sample = hrefs.find((h) => h.replace(/\/$/, "").endsWith(`/${firstSlug}`));
  const prefix = sample
    ? new URL(sample, base).pathname.replace(/\/$/, "").slice(0, -firstSlug.length)
    : `${base.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "")}/`;
  return best.filter((p) => !p.draft).map((p) => {
    const slug = String(p.slug ?? p.path).replace(/^\/+/, "");
    const url = canon(new URL(slug.startsWith("http") ? slug : `${prefix}${slug}`, base).toString());
    return {
      url, slug: slugOf(url), title: clean(String(p.title)),
      summary: clean(String(p.summary ?? p.description ?? p.excerpt ?? "")).slice(0, 600) || undefined,
      tags: Array.isArray(p.tags) ? (p.tags as unknown[]).map(String).slice(0, 8) : undefined,
      date: typeof p.date === "string" ? p.date : undefined,
    };
  });
}

// ---------------------------------------------------------------------- 2. feeds
function parseFeed(xml: string, base: URL): Candidate[] {
  const { document } = parseHTML(`<root>${xml.replace(/<\?xml[^>]*>/, "")}</root>`);
  const items = [...document.querySelectorAll("item, entry")];
  return items.map((it) => {
    const linkEl = it.querySelector("link");
    const href = linkEl?.getAttribute("href") || clean(linkEl?.textContent) || clean(it.querySelector("guid")?.textContent);
    if (!href) return null;
    const url = canon(new URL(href, base).toString());
    const desc = clean((it.querySelector("description, summary")?.textContent || "").replace(/<[^>]+>/g, " ")).slice(0, 400);
    return {
      url, slug: slugOf(url), title: clean(it.querySelector("title")?.textContent) || titleFromSlug(slugOf(url)),
      summary: desc || undefined,
      tags: [...it.querySelectorAll("category")].map((c) => clean(c.getAttribute("term") || c.textContent)).filter(Boolean).slice(0, 8),
      date: clean(it.querySelector("pubDate, published, updated")?.textContent).slice(0, 25) || undefined,
    } as Candidate;
  }).filter(Boolean) as Candidate[];
}

async function fromFeeds(doc: Document, base: URL): Promise<Candidate[]> {
  const links = [...doc.querySelectorAll('link[rel="alternate"]')]
    .filter((l) => /rss|atom|xml/.test(l.getAttribute("type") || ""))
    .map((l) => new URL(l.getAttribute("href") || "", base).toString());
  for (const u of links.slice(0, 2)) {
    try { const r = await fetchText(u, 10_000); const c = parseFeed(r.text, base); if (c.length) return c; } catch { /* next */ }
  }
  return [];
}

// ---------------------------------------------------------------------- 3. links
function fromLinks(doc: Document, pageUrl: URL): Candidate[] {
  const out = new Map<string, Candidate & { score: number }>();
  const here = canon(pageUrl.toString());
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    if (/^(mailto:|tel:|javascript:|#)/.test(href)) continue;
    let u: URL;
    try { u = new URL(href, pageUrl); } catch { continue; }
    if (u.hostname.replace(/^www\./, "") !== pageUrl.hostname.replace(/^www\./, "")) continue;
    const url = canon(u.toString());
    if (url === here || u.pathname === "/" || NON_ARTICLE.test(u.pathname)) continue;
    const inNav = !!a.closest("nav, header, footer");
    const heading = clean(a.querySelector("h1,h2,h3,h4,h5")?.textContent) || clean(a.closest("article, li, .card, .post")?.querySelector("h1,h2,h3,h4")?.textContent);
    const text = clean(a.textContent);
    // a table-of-contents row packs number, title, summary and time into one link: read its parts
    const parts = [...a.querySelectorAll("*")].filter((el) => !el.children.length).map((el) => clean(el.textContent)).filter((t) => t && !/^\d{1,3}\.?$/.test(t) && !/^\d+\s*min/.test(t));
    const fromParts = parts.find((t) => t.length >= 8 && t.length <= 160);
    const title = heading || (parts.length >= 2 && fromParts) || (text.length > 12 && text.length < 160 ? text : "") || fromParts || clean(a.getAttribute("title"));
    if (!title) continue;
    const summary = clean(a.querySelector("p")?.textContent) || (fromParts ? parts[parts.indexOf(fromParts) + 1] : undefined) || undefined;
    const readingTime = (text.match(/\b\d+\s*min(ute)?s?\s*read\b/i) || [])[0];
    // an article link has a heading, some words, and a path that looks like a post
    const score = (heading ? 3 : 0) + (summary ? 2 : 0) + (inNav ? -3 : 0) + (u.pathname.split("/").filter(Boolean).length >= 2 ? 1 : 0) + (title.split(" ").length >= 3 ? 1 : 0);
    const prev = out.get(url);
    if (!prev || score > prev.score) out.set(url, { url, slug: slugOf(url), title: title.slice(0, 200), summary: summary?.slice(0, 400), readingTime, score });
  }
  let all = [...out.values()];
  // a URL with a path (/learn/vectors) means that section: keep the links under it when there are enough
  const prefix = pageUrl.pathname.replace(/\/$/, "");
  if (prefix) { const under = all.filter((c) => new URL(c.url).pathname.startsWith(`${prefix}/`)); if (under.length >= 3) all = under; }
  const good = all.filter((c) => c.score >= 2);
  return (good.length >= 2 ? good : all.filter((c) => c.score >= 0)).map(({ score: _s, ...c }) => c);
}

function nextPage(doc: Document, pageUrl: URL): string | null {
  const rel = doc.querySelector('a[rel="next"], link[rel="next"]')?.getAttribute("href");
  if (rel) return new URL(rel, pageUrl).toString();
  const n = Number(pageUrl.pathname.match(/\/page\/(\d+)/)?.[1] || pageUrl.searchParams.get("page") || 1);
  const want = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "").find((h) => new RegExp(`(/page/|[?&]page=)${n + 1}(/|$|&)`).test(h));
  if (want) return new URL(want, pageUrl).toString();
  const older = [...doc.querySelectorAll("a[href]")].find((a) => /^(next|older|more posts|older posts)\b/i.test(clean(a.textContent)));
  return older ? new URL(older.getAttribute("href") || "", pageUrl).toString() : null;
}

// -------------------------------------------------------------------- 4. sitemap
async function fromSitemap(base: URL): Promise<Candidate[]> {
  try {
    const r = await fetchText(`${base.origin}/sitemap.xml`, 10_000);
    const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    return locs.filter((l) => { try { const u = new URL(l); return u.pathname !== "/" && !NON_ARTICLE.test(u.pathname) && !l.endsWith(".xml"); } catch { return false; } })
      .slice(0, 800).map((l) => { const url = canon(l); return { url, slug: slugOf(url), title: titleFromSlug(slugOf(url)) }; });
  } catch { return []; }
}

// ----------------------------------------------------------------------- main
/** `---\ntitle: "…"\nsummary: …\n---` at the top of a Markdown file: its simple keys, and the rest */
export function frontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: md.slice(m[0].length) };
}

// ------------------------------------------------------------- GitHub docs
/** github.com/<owner>/<repo>/tree/<branch>/<folder>: every Markdown file in it, titled by its first heading */
const GH_TREE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/tree\/([\w.\/-]+?)\/(.+?)\/?$/;
async function fromGithub(url: string): Promise<Discovery | null> {
  const m = url.match(GH_TREE);
  if (!m) return null;
  const [, owner, repo, branch, dir] = m;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${dir}?ref=${branch}`, { headers: { "user-agent": UA, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(r.status === 404 ? "That GitHub folder is not public (or not pushed yet)." : `GitHub answered ${r.status}`);
  const files = ((await r.json()) as { name: string; type: string; download_url: string; html_url: string }[])
    .filter((f) => f.type === "file" && /\.md$/i.test(f.name) && !/^readme\.md$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300);
  const candidates = await Promise.all(files.map(async (f) => {
    let title = titleFromSlug(f.name.replace(/\.md$/i, "").replace(/^\d+[-_]/, "")), summary: string | undefined;
    try {
      const raw = await (await fetch(f.download_url, { signal: AbortSignal.timeout(10_000) })).text();
      const { meta, body: md } = frontMatter(raw);
      title = meta.title || md.match(/^#\s+(.+)$/m)?.[1]?.trim() || title;
      summary = meta.summary || md.replace(/^#.*$/gm, "").replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((p) => clean(p.replace(/[*_`>#[\]()]/g, ""))).find((p) => p.length > 40)?.slice(0, 400);
    } catch { /* keep the file name */ }
    return { url: f.html_url, slug: f.name.replace(/\.md$/i, ""), title, summary } as Candidate;
  }));
  return { source: url, siteName: /(^|\/)docs$/i.test(dir) ? `${repo} docs` : repo, method: "github", candidates };
}

export async function discover(inputUrl: string): Promise<Discovery> {
  const gh = await fromGithub(inputUrl);
  if (gh) return gh;
  const first = await fetchText(inputUrl);
  const base = new URL(first.url);
  if (/xml|rss|atom/.test(first.type) || /^\s*<\?xml|<rss|<feed/.test(first.text.slice(0, 200))) {
    return { source: inputUrl, siteName: base.hostname, method: "feed", candidates: parseFeed(first.text, base) };
  }
  const { document } = parseHTML(first.text);
  const siteName = (clean(document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")) || clean(document.title)).split(/\s[|·—–-]\s/)[0].trim() || base.hostname;

  const next = fromNextData(first.text, base, document as unknown as Document);
  if (next.length >= 3) return { source: inputUrl, siteName, method: "next-data", candidates: dedupe(next) };

  let links = fromLinks(document as unknown as Document, base);
  // walk "next page" links while each page adds new articles
  let pageUrl = base, doc = document as unknown as Document;
  for (let i = 0; i < 25; i++) {
    const nx = nextPage(doc, pageUrl);
    if (!nx || canon(nx) === canon(pageUrl.toString())) break;
    try {
      const r = await fetchText(nx);
      pageUrl = new URL(r.url); doc = parseHTML(r.text).document as unknown as Document;
      const more = fromLinks(doc, pageUrl);
      const before = new Set(links.map((c) => c.url));
      const fresh = more.filter((c) => !before.has(c.url));
      if (!fresh.length) break;
      links = links.concat(fresh);
      await Bun.sleep(400);
    } catch { break; }
  }
  const feed = await fromFeeds(document as unknown as Document, base);
  if (feed.length > links.length) return { source: inputUrl, siteName, method: "feed", candidates: dedupe(mergeInfo(feed, links)) };
  if (links.length >= 2) return { source: inputUrl, siteName, method: "links", candidates: dedupe(mergeInfo(links, feed)) };

  const map = await fromSitemap(base);
  if (map.length >= 2) return { source: inputUrl, siteName, method: "sitemap", candidates: dedupe(map) };

  // a single article
  const title = clean(document.querySelector('meta[property="og:title"]')?.getAttribute("content")) || clean(document.querySelector("h1")?.textContent) || clean(document.title);
  const summary = clean(document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute("content")) || undefined;
  const url = canon(base.toString());
  return { source: inputUrl, siteName, method: "single", candidates: [{ url, slug: slugOf(url), title: title || titleFromSlug(slugOf(url)), summary }] };
}

function mergeInfo(primary: Candidate[], extra: Candidate[]): Candidate[] {
  const by = new Map(extra.map((c) => [c.url, c]));
  return primary.map((c) => { const e = by.get(c.url); return e ? { ...e, ...c, summary: c.summary || e.summary, tags: c.tags?.length ? c.tags : e.tags, date: c.date || e.date } : c; });
}
function dedupe(c: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return c.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true))).slice(0, 1500);
}

// --------------------------------------------------------------------- filter
const WANTS_ALL = /^(all|every(thing)?|everything|all (of )?(the )?(blogs?|posts?|articles?|logs?|notes?|pieces?))?$/i;

export async function filterCandidates(cands: Candidate[], instruction: string, siteName: string): Promise<{ keep: boolean[]; topic: string; reason: string }> {
  const ins = instruction.replace(/\b(blogs?|posts?|articles?|only|just|logs?)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!ins || WANTS_ALL.test(ins) || WANTS_ALL.test(instruction.trim())) {
    return { keep: cands.map(() => true), topic: siteName, reason: "Everything on the page that looks like an article." };
  }
  if (!ai.hasKey()) {
    // no model: keep titles/tags that mention a word of the instruction
    const words = ins.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
    return { keep: cands.map((c) => words.some((w) => `${c.title} ${(c.tags || []).join(" ")} ${c.summary || ""}`.toLowerCase().includes(w))), topic: ins, reason: "Keyword match (no model key)." };
  }
  const keep = cands.map(() => false);
  let topic = ins;
  const schema = { name: "pick", schema: { type: "object", additionalProperties: false, required: ["topic", "keep"], properties: { topic: { type: "string" }, keep: { type: "array", items: { type: "integer" } } } } };
  const BATCH = 80;
  const jobs: (() => Promise<void>)[] = [];
  for (let s = 0; s < cands.length; s += BATCH) {
    const slice = cands.slice(s, s + BATCH);
    const lines = slice.map((c, i) => `${i}. ${c.title}${c.tags?.length ? ` [tags: ${c.tags.join(", ")}]` : ""}${c.summary ? ` — ${c.summary.slice(0, 160)}` : ""}`).join("\n");
    jobs.push(() => ai.json<{ topic: string; keep: number[] }>([
      { role: "system", content: "You curate a reading list. Given a numbered list of blog posts and the reader's request, return the numbers of the posts that match the request. Judge by meaning, not keywords: 'AI' includes machine learning, LLMs, agents, RAG, transformers, inference, and the math behind them. Be inclusive of posts clearly on-topic and exclude unrelated ones (e.g. Android, Kotlin, generic backend when AI was asked). Also return `topic`: a 1-3 word shelf label for the request, e.g. 'AI', 'System design'." },
      { role: "user", content: `Request: ${instruction}\n\nPosts:\n${lines}` },
    ], schema, 1200).then((r) => {
      if (!r) return;
      if (r.topic) topic = r.topic;
      for (const i of r.keep) if (i >= 0 && i < slice.length) keep[s + i] = true;
    }));
  }
  // a few batches at a time
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map((j) => j()));
  return { keep, topic: topic.slice(0, 40), reason: `Chosen by ${ai.FAST} for “${instruction}”.` };
}
