import { marked } from "marked";

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const r = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-tz": TZ },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && path !== "/api/auth/login") window.dispatchEvent(new Event("lms:signedout"));
    throw new ApiError(r.status, data.error || `Request failed (${r.status})`);
  }
  return data as T;
}

/** POST that streams plain text back */
export async function streamChat(body: unknown, onChunk: (s: string) => void, signal?: AbortSignal): Promise<string | null> {
  const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-tz": TZ }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new ApiError(r.status, d.error || "The assistant is unavailable."); }
  const id = r.headers.get("x-thread-id");
  const reader = r.body.getReader(), dec = new TextDecoder();
  for (;;) { const { done, value } = await reader.read(); if (done) break; onChunk(dec.decode(value, { stream: true })); }
  return id;
}

// ------------------------------------------------------------------ navigation
export function go(path: string) {
  if (location.pathname + location.search === path) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new Event("lms:navigate"));
  window.scrollTo({ top: 0 });
}

// -------------------------------------------------------------------- markdown
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
marked.use({
  gfm: true, breaks: false,
  renderer: {
    html(token) { return esc((token as { text: string }).text); },
    link(token) {
      const t = token as { href: string; title?: string | null; tokens: unknown[] };
      const href = /^(https?:|mailto:|\/)/.test(t.href) ? t.href : "#";
      // @ts-expect-error parser is bound at render time
      const inner = this.parser.parseInline(t.tokens);
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
  },
});
export const md = (s: string) => marked.parse(s, { async: false }) as string;

// --------------------------------------------------------------------- formats
export function ago(t?: number) {
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
export function until(t?: number) {
  if (!t) return "";
  const d = Math.round((t - Date.now()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}
export const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
