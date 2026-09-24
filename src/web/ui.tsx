import React from "react";
import { go, host } from "./api";

export interface Item {
  _id: string; url: string; title: string; slug: string; summary?: string; tags?: string[]; date?: string; site: string; topic: string;
  status: "new" | "reading" | "read"; addedAt: number; openedAt?: number; readAt?: number; progress?: number;
  quiz?: { score: number; total: number; answered: number; at: number };
  recall?: { count: number; lastAt?: number; due?: number; interval?: number; lastScore?: number };
  overdue?: boolean;
  timeSec?: number;
  enteredMin?: number;
}
export interface Recall { _id: string; item: string; title: string; topic: string; text: string; at: number; kind: string; score?: number; verdict?: string; got?: string[]; missed?: string[]; nudge?: string }
export interface Me { username: string; role: "admin" | "learner"; name: string }
export interface Boot { user: Me | null; allowSignup: boolean; models: { id: string; label: string }[]; defaultModel: string }
export const BootCtx = React.createContext<Boot>({ user: null, allowSignup: true, models: [], defaultModel: "" });

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const paths: Record<string, React.ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  library: <><path d="M4 19V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v14" /><path d="M9 19V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12" /><path d="m14.5 6.6 2.9-.8a1 1 0 0 1 1.2.7l3 11.2" /><path d="M3 20h18" /></>,
  add: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  recall: <><path d="M12 3a6 6 0 0 0-3.5 10.9V16a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.1A6 6 0 0 0 12 3Z" /><path d="M10 20h4" /></>,
  notebook: <><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z" /><path d="M6 3v18M3.5 7H6M3.5 12H6M3.5 17H6M10 8h5M10 12h5" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-5A8 8 0 1 1 21 12Z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" /></>,
  admin: <><path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  skip: <><path d="m5 5 8 7-8 7z" /><path d="M17 5v14" /></>,
  ext: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  flame: <path d="M12 21c4 0 7-2.7 7-6.8 0-3.9-3-6.4-4.4-9.7-.3-.7-1.2-.8-1.6-.2-.8 1.2-1.2 2.7-1.2 4.1C10.5 7.2 9.4 6 9 5.2c-.3-.5-1-.5-1.3 0C6.3 7.5 5 10.2 5 14.2 5 18.3 8 21 12 21Z" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  send: <path d="M4 12 20 4l-6 16-2.5-6.5z" />,
  outline: <path d="M4 6h16M4 12h10M4 18h13" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-3.9L4 9" /><path d="M4 4v5h5M4 13a8 8 0 0 0 14.9 3.9L20 15" /><path d="M20 20v-5h-5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5M19 19v2H6" /></>,
};
export function Icon({ name, size = 18, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...P} aria-hidden="true">{paths[name]}</svg>;
}

export function Link({ to, children, className, ...rest }: { to: string; children: React.ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(to); }} {...rest}>{children}</a>;
}

const HUES = [12, 28, 42, 150, 190, 215, 262, 330];
export function hue(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; }

export function Monogram({ url, site, size = 28 }: { url: string; site?: string; size?: number }) {
  const name = site || host(url);
  const h = hue(host(url));
  return <span className="mono" style={{ width: size, height: size, fontSize: size * 0.44, ["--h" as string]: h }} aria-hidden="true">{name.replace(/^(the|www)\s*/i, "").charAt(0).toUpperCase()}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spin" role="status"><span className="spin-dot" /><span className="spin-dot" /><span className="spin-dot" />{label && <span className="spin-label">{label}</span>}</span>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return <div className="empty"><div className="empty-ic"><Icon name={icon} size={26} /></div><h3>{title}</h3>{children}</div>;
}

export function Score({ value, max = 5 }: { value?: number; max?: number }) {
  if (value === undefined || value === null) return null;
  return <span className="score" aria-label={`${value} of ${max}`} title={`${value} / ${max}`}>{Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? "on" : ""} />)}</span>;
}

export function StatusDot({ status }: { status: Item["status"] }) {
  return <span className={`sdot s-${status}`} title={status === "new" ? "Unread" : status === "reading" ? "Reading" : "Read"} />;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void; set: (t: T) => void } {
  const [state, setState] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && setState({ data, error: null, loading: false })).catch((e) => live && setState({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1), set: (data: T) => setState({ data, error: null, loading: false }) };
}

export function Toast() {
  const [msg, setMsg] = React.useState<{ text: string; kind: string } | null>(null);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => { setMsg((e as CustomEvent).detail); clearTimeout(t); t = setTimeout(() => setMsg(null), 3600); };
    window.addEventListener("lms:toast", on);
    return () => window.removeEventListener("lms:toast", on);
  }, []);
  return msg ? <div className={`toast t-${msg.kind}`} role="status">{msg.text}</div> : null;
}
export const toast = (text: string, kind: "ok" | "err" | "info" = "info") => window.dispatchEvent(new CustomEvent("lms:toast", { detail: { text, kind } }));
