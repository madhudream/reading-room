/**
 * catalog — Discover: shared collections anyone can add to their own library.
 *
 * A collection is a named list of articles plus where it came from (a blog index, a GitHub docs folder)
 * and the request that picked them ("AI blogs only"). Adding one copies the articles onto a shelf of the
 * same name and subscribes the reader to its source, so new posts arrive with the daily check.
 * Admins publish collections, usually from one of their own shelves.
 */
import { C, findAll, get, put, remove } from "./db";
import { canon, discover, filterCandidates, type Candidate } from "./discover";
import * as learn from "./learn";

export interface Collection {
  _id: string; name: string; description: string; site: string; source: string; instruction: string;
  hue: number; items: Candidate[]; count: number; updated: number; by: string; order?: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "collection";

export async function all(): Promise<Collection[]> {
  return (await findAll<Collection>(C.catalog)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || b.count - a.count);
}
export const one = (id: string) => get<Collection>(C.catalog, id);

/** how much of each collection this reader already has */
export async function forReader(user: string) {
  const mine = new Set((await learn.library(user)).map((i) => canon(i.url)));
  return (await all()).map((c) => {
    const have = c.items.filter((i) => mine.has(canon(i.url))).length;
    return { ...c, items: undefined, have, fresh: c.count - have };
  });
}

export async function detail(user: string, id: string) {
  const c = await one(id);
  if (!c) return null;
  const mine = new Set((await learn.library(user)).map((i) => canon(i.url)));
  return { ...c, items: c.items.map((i) => ({ ...i, keep: true, inLibrary: mine.has(canon(i.url)) })) };
}

export async function save(c: Omit<Collection, "_id" | "updated" | "count"> & { _id?: string }): Promise<Collection> {
  const _id = c._id || slug(c.name);
  const doc: Collection = { ...c, _id, items: c.items.slice(0, 1500), count: c.items.length, updated: Date.now() };
  await put(C.catalog, doc as unknown as Record<string, unknown>, _id);
  return doc;
}

/** build (or rebuild) a collection from its source and request */
export async function fromSource(meta: { _id?: string; name: string; description: string; source: string; instruction: string; hue?: number; by: string; order?: number }): Promise<Collection> {
  const d = await discover(meta.source);
  const f = await filterCandidates(d.candidates, meta.instruction, d.siteName);
  const items = d.candidates.filter((_, i) => f.keep[i]);
  return save({ ...meta, site: d.siteName, hue: meta.hue ?? 20, items });
}

/** publish one of the admin's shelves */
export async function fromShelf(user: string, shelf: string, description: string): Promise<Collection> {
  const items = (await learn.library(user)).filter((i) => i.topic === shelf);
  if (!items.length) throw new Error("That shelf is empty.");
  const src = (await learn.sources(user)).find((s) => s.topic === shelf);
  const existing = (await all()).find((c) => c.name === shelf);
  return save({
    _id: existing?._id, name: shelf, description: description || existing?.description || "", site: items[0].site,
    source: src?.url || "", instruction: src?.instruction || "", hue: existing?.hue ?? 20, by: user, order: existing?.order,
    items: items.map((i) => ({ url: i.url, slug: i.slug, title: i.title, summary: i.summary, tags: i.tags, date: i.date })),
  });
}

/** everything in a collection (or the chosen part of it) onto the reader's shelf, subscribed to its source */
export async function addTo(user: string, id: string, urls?: string[]) {
  const c = await one(id);
  if (!c) throw new Error("No such collection.");
  const want = urls?.length ? new Set(urls.map(canon)) : null;
  const items = want ? c.items.filter((i) => want.has(canon(i.url))) : c.items;
  return learn.addItems(user, items, { site: c.site, topic: c.name, source: c.source, instruction: c.instruction, seen: c.items.map((i) => i.url) });
}

export const drop = (id: string) => remove(C.catalog, id);
