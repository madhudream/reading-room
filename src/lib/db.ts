/**
 * db — the LMS's storage: TwinDB, the same twindb-1 VM madhudream.dev writes to,
 * in collections prefixed `lms_` so nothing collides with the site's `site_*`.
 *
 * Without TWINDB_URL the app runs on a file store under .data/ (same API, for
 * offline development). `dbMode()` says which one is live.
 */
import { TwinDB, TwinDBError } from "./twindb";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const C = {
  user: "lms_user",
  item: "lms_item",
  article: "lms_article",
  quiz: "lms_quiz",
  attempt: "lms_quiz_attempt",
  recall: "lms_recall",
  chat: "lms_chat",
  source: "lms_source",
  /** minutes spent reading, one row per reader, item and day */
  read: "lms_read",
  /** Discover: shared collections anyone can add */
  catalog: "lms_catalog",
} as const;
export type Col = (typeof C)[keyof typeof C];
export type Doc = Record<string, unknown> & { _id: string };

const URL_ = process.env.TWINDB_URL || "";
const TOKEN = process.env.TWINDB_TOKEN || "";
const DIR = join(process.cwd(), ".data");
const twin = URL_ ? new TwinDB(URL_, TOKEN, { readYourWrites: true, durable: "local" }) : null;

export const dbMode = () => (twin ? "twindb" : "files");

// ---------------------------------------------------------------- file fallback
const fdir = (c: string) => { const d = join(DIR, c); mkdirSync(d, { recursive: true }); return d; };
const fpath = (c: string, id: string) => join(fdir(c), `${encodeURIComponent(id)}.json`);
const fall = (c: string): Doc[] => readdirSync(fdir(c)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(fdir(c), f), "utf8")));
function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const d = doc[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ("$gte" in o && !(Number(d) >= Number(o.$gte))) return false;
      if ("$lte" in o && !(Number(d) <= Number(o.$lte))) return false;
      if ("$gt" in o && !(Number(d) > Number(o.$gt))) return false;
      if ("$lt" in o && !(Number(d) < Number(o.$lt))) return false;
      if ("$ne" in o && d === o.$ne) return false;
      if ("$in" in o && !(o.$in as unknown[]).includes(d)) return false;
      return true;
    }
    return Array.isArray(d) ? d.includes(v) : d === v;
  });
}

// -------------------------------------------------------------------------- api
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export async function put(col: Col, doc: Record<string, unknown>, id?: string): Promise<string> {
  const _id = id || String(doc._id || newId());
  const body = { ...doc, _id, updated: Date.now() };
  if (twin) {
    try { await twin.update(col, _id, body); }
    catch (e) { if (e instanceof TwinDBError && e.status === 404) await twin.insert(col, body); else throw e; }
    return _id;
  }
  writeFileSync(fpath(col, _id), JSON.stringify(body));
  return _id;
}

/** many writes in one atomic transaction */
export async function putMany(col: Col, docs: Doc[]): Promise<void> {
  if (!docs.length) return;
  const now = Date.now();
  if (twin) {
    for (let i = 0; i < docs.length; i += 200) {
      await twin.batch(docs.slice(i, i + 200).map((d) => ({ op: "put" as const, col, id: d._id, doc: { ...d, updated: now } })));
    }
    return;
  }
  for (const d of docs) writeFileSync(fpath(col, d._id), JSON.stringify({ ...d, updated: now }));
}

export async function get<T = Doc>(col: Col, id: string): Promise<T | null> {
  if (twin) return twin.get<T>(col, id);
  const p = fpath(col, id);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}

export interface FindOpts { filter?: Record<string, unknown>; q?: string; sort?: string; limit?: number; offset?: number; aggs?: Record<string, unknown> }

export async function find<T = Doc>(col: Col, o: FindOpts = {}): Promise<{ hits: T[]; total: number; aggs?: Record<string, unknown> }> {
  if (twin) {
    try {
      const r = await twin.find<T>(col, { count: true, limit: 100, ...o });
      return { hits: r.hits, total: r.total ?? r.hits.length, aggs: r.aggs };
    } catch (e) {
      // a collection that has never been written to is simply empty
      if (e instanceof TwinDBError && e.status === 404) return { hits: [], total: 0 };
      throw e;
    }
  }
  let hits = fall(col);
  if (o.filter) hits = hits.filter((d) => matches(d, o.filter!));
  if (o.q) { const n = o.q.toLowerCase(); hits = hits.filter((d) => JSON.stringify(d).toLowerCase().includes(n)); }
  if (o.sort) {
    const desc = o.sort.startsWith("-"), k = desc ? o.sort.slice(1) : o.sort;
    hits.sort((a, b) => { const x = a[k] as number, y = b[k] as number; return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
  }
  const off = o.offset || 0;
  return { hits: hits.slice(off, off + (o.limit ?? 100)) as T[], total: hits.length };
}

/** every row that matches, paging past the per-call limit */
export async function findAll<T = Doc>(col: Col, o: FindOpts = {}, max = 5000): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < max; off += 500) {
    const r = await find<T>(col, { ...o, limit: 500, offset: off });
    out.push(...r.hits);
    if (r.hits.length < 500) break;
  }
  return out;
}

export async function remove(col: Col, id: string): Promise<void> {
  if (twin) {
    try { await twin.remove(col, id); } catch (e) { if (!(e instanceof TwinDBError && e.status === 404)) throw e; }
    return;
  }
  const p = fpath(col, id);
  if (existsSync(p)) unlinkSync(p);
}

export async function health(): Promise<{ mode: string; ok: boolean }> {
  if (!twin) return { mode: "files", ok: true };
  try {
    const r = await fetch(`${URL_.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
    return { mode: "twindb", ok: r.ok };
  } catch { return { mode: "twindb", ok: false }; }
}
