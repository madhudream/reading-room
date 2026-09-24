/**
 * extract — fetch an article once, keep a clean reading copy.
 *
 * Mozilla Readability (the engine behind Firefox Reader View) finds the article in the
 * page; an allow-list sanitiser then strips scripts, handlers and styles and makes every
 * link and image absolute. The body goes to the blob store; TwinDB keeps the metadata.
 *
 * Some authors publish for their own site only. Domains in LINK_OUT_DOMAINS (default:
 * outcomeschool.com, as on madhudream.dev) are shown as summary + outline with a link
 * to the original; their text is still used privately for quizzes, recall grading and
 * the reading assistant.
 */
import { Readability } from "@mozilla/readability";
import { marked } from "marked";
import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import { C, get, put } from "./db";
import { getBlob, putBlob } from "./blobs";
import { fetchText } from "./discover";

export interface ArticleMeta {
  _id: string; url: string; title: string; byline?: string; siteName?: string; excerpt?: string; image?: string;
  words: number; minutes: number; outline: { level: number; text: string; id: string }[]; linkOut: boolean; fetchedAt: number; error?: string;
}
export interface ArticleBody { html: string; text: string }

export const urlKey = (u: string) => createHash("sha1").update(u).digest("hex").slice(0, 20);
const LINK_OUT = (process.env.LINK_OUT_DOMAINS ?? "outcomeschool.com").split(",").map((s) => s.trim()).filter(Boolean);
export const isLinkOut = (url: string) => { try { const h = new URL(url).hostname.replace(/^www\./, ""); return LINK_OUT.some((d) => h === d || h.endsWith(`.${d}`)); } catch { return false; } };

const ALLOWED = new Set("a abbr b blockquote br caption code del details dd div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre q s section small span strong sub summary sup table tbody td tfoot th thead tr u ul".split(" "));
const DROP = new Set("script style noscript iframe object embed form input button select textarea svg canvas video audio link meta nav footer aside".split(" "));
const ATTRS: Record<string, string[]> = { a: ["href", "title"], img: ["src", "alt", "title", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], code: ["class"], pre: ["class"] };

function sanitize(html: string, base: string): { html: string; outline: ArticleMeta["outline"]; image?: string } {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById("root")!;
  const outline: ArticleMeta["outline"] = [];
  let image: string | undefined;
  const used = new Set<string>();
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROP.has(tag)) { child.remove(); continue; }
      walk(child);
      if (!ALLOWED.has(tag)) { child.replaceWith(...child.childNodes); continue; }
      const keep = ATTRS[tag] || [];
      for (const a of [...child.attributes]) if (!keep.includes(a.name)) child.removeAttribute(a.name);
      if (tag === "a") {
        const h = child.getAttribute("href") || "";
        try { const u = new URL(h, base); if (!/^https?:$/.test(u.protocol)) child.removeAttribute("href"); else child.setAttribute("href", u.toString()); } catch { child.removeAttribute("href"); }
        child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer");
      }
      if (tag === "img") {
        const s = child.getAttribute("src") || "";
        try { const u = new URL(s, base); if (!/^https?:$/.test(u.protocol)) { child.remove(); continue; } child.setAttribute("src", u.toString()); image ||= u.toString(); } catch { child.remove(); continue; }
        child.setAttribute("loading", "lazy");
      }
      if ((tag === "code" || tag === "pre") && child.getAttribute("class") && !/^language-[\w-]+$/.test(child.getAttribute("class")!)) child.removeAttribute("class");
      if (/^h[1-4]$/.test(tag)) {
        const text = (child.textContent || "").replace(/\s+/g, " ").trim();
        if (text) {
          let id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
          while (used.has(id)) id += "-";
          used.add(id);
          child.setAttribute("id", id);
          outline.push({ level: Number(tag[1]), text, id });
        }
      }
    }
  };
  walk(root);
  return { html: root.innerHTML, outline, image };
}

/** a Markdown file on GitHub: read the raw file and render it ourselves (GitHub's page is an app shell) */
const GH_BLOB = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([\w.-]+)\/(.+\.md)$/i;
async function fromGithubMarkdown(url: string, id: string): Promise<ArticleMeta | null> {
  const m = url.match(GH_BLOB);
  if (!m) return null;
  const [, owner, repo, branch, path] = m;
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const r = await fetch(raw, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(r.status === 404 ? "not on GitHub yet (push the file)" : `GitHub answered ${r.status}`);
  const md = await r.text();
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.split("/").pop()!;
  const body = md.replace(/^#\s+.+$/m, ""); // the title is shown above the article
  const clean = sanitize(await marked.parse(body, { gfm: true }), url.replace(/\/[^/]*$/, "/"));
  const text = md.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|[\]]/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).length;
  const meta: ArticleMeta = {
    _id: id, url, title, siteName: `${repo} docs`, excerpt: text.slice(0, 300), words, minutes: Math.max(1, Math.round(words / 230)),
    outline: clean.outline, linkOut: false, fetchedAt: Date.now(),
  };
  await putBlob(`articles/${id}.json`, { html: clean.html, text: md } satisfies ArticleBody);
  await put(C.article, meta as unknown as Record<string, unknown>, id);
  return meta;
}

const inflight = new Map<string, Promise<ArticleMeta>>();

/** the reading copy of a URL, fetched and cleaned once and shared by every reader */
export function article(url: string, force = false): Promise<ArticleMeta> {
  const id = urlKey(url);
  if (!force && inflight.has(id)) return inflight.get(id)!;
  const job = (async () => {
    if (!force) {
      const have = await get<ArticleMeta>(C.article, id);
      if (have && !have.error) return have;
      if (have?.error && Date.now() - have.fetchedAt < 10 * 60_000) return have;
    }
    try {
      const gh = await fromGithubMarkdown(url, id);
      if (gh) return gh;
      const page = await fetchText(url, 25_000);
      const { document } = parseHTML(page.text);
      const og = (p: string) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || undefined;
      const parsed = new Readability(document as unknown as Document, { charThreshold: 300, keepClasses: true }).parse();
      if (!parsed?.content) throw new Error("no readable article on that page");
      const clean = sanitize(parsed.content, page.url);
      const text = (parsed.textContent || "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
      const words = text.split(/\s+/).length;
      const site = parsed.siteName || og("og:site_name");
      let title = (parsed.title || og("og:title") || url).trim();
      // "Why do agents forget? · Memory for AI Agents" → "Why do agents forget?"
      const parts = title.split(/\s+[|·—–-]\s+/);
      if (parts.length > 1 && (site ? parts.slice(1).join(" ").toLowerCase().includes(site.toLowerCase().slice(0, 12)) : parts[parts.length - 1].length < 40)) title = parts[0];
      const meta: ArticleMeta = {
        _id: id, url, title, byline: parsed.byline || undefined,
        siteName: site, excerpt: (parsed.excerpt || og("description") || "").slice(0, 400),
        image: og("og:image") || clean.image, words, minutes: Math.max(1, Math.round(words / 230)), outline: clean.outline,
        linkOut: isLinkOut(url), fetchedAt: Date.now(),
      };
      await putBlob(`articles/${id}.json`, { html: clean.html, text } satisfies ArticleBody);
      await put(C.article, meta as unknown as Record<string, unknown>, id);
      return meta;
    } catch (e) {
      const meta: ArticleMeta = { _id: id, url, title: url, words: 0, minutes: 0, outline: [], linkOut: isLinkOut(url), fetchedAt: Date.now(), error: (e as Error).message };
      await put(C.article, meta as unknown as Record<string, unknown>, id).catch(() => {});
      return meta;
    }
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

export async function articleBody(url: string): Promise<ArticleBody | null> {
  const meta = await article(url);
  if (meta.error) return null;
  return getBlob<ArticleBody>(`articles/${meta._id}.json`);
}

/** warm the cache for new items, two at a time, politely */
export function prefetch(urls: string[]) {
  const queue = [...urls];
  const worker = async () => { for (let u = queue.shift(); u; u = queue.shift()) { await article(u).catch(() => {}); await Bun.sleep(800); } };
  void Promise.all([worker(), worker()]);
}
