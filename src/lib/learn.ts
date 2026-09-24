/**
 * learn — the learning loop: a list of things to read, a short quiz after reading
 * (every question skippable), and recall: the reader writes one or more sentences from
 * memory, a model compares them with the article, and the note is kept forever.
 *
 * Recall scheduling is spaced but never lets a day go quiet: items come due on an
 * expanding interval (1, 2–3, 5, 11, 24 … days, capped at 30, reset after a weak recall),
 * and the daily set is topped up with the least-recently recalled reads, so there is
 * always something to recall today.
 */
import * as ai from "./ai";
import { C, findAll, find, get, put, putMany, type Doc } from "./db";
import { article, articleBody, urlKey } from "./extract";
import type { Candidate } from "./discover";

const DAY = 86_400_000;

export interface Item {
  _id: string; user: string; key: string; url: string; title: string; slug: string; summary?: string; tags?: string[]; date?: string;
  site: string; topic: string; source: string; status: "new" | "reading" | "read"; addedAt: number; openedAt?: number; readAt?: number; progress?: number;
  quiz?: { score: number; total: number; answered: number; at: number };
  recall?: { count: number; lastAt?: number; due?: number; interval?: number; lastScore?: number };
  archived?: boolean;
  /** seconds the reader page was open and in use */
  timeSec?: number;
  /** minutes the reader said they spent, at "I've finished" (wins over the timer) */
  enteredMin?: number;
}
export interface ReadDay { _id: string; user: string; item: string; title: string; url: string; site: string; topic: string; day: string; trackedSec: number; enteredMin?: number; first: number; last: number }
export const readMinutes = (r: ReadDay) => r.enteredMin ?? r.trackedSec / 60;
export interface Question { q: string; choices: string[]; answer: number; why: string }
export interface Quiz { _id: string; url: string; questions: Question[]; model: string; at: number }
export interface Recall {
  _id: string; user: string; item: string; title: string; topic: string; text: string; at: number; kind: "after-read" | "daily" | "free";
  score?: number; verdict?: string; got?: string[]; missed?: string[]; nudge?: string; skipped?: boolean;
}

export const itemId = (user: string, url: string) => `${user}|${urlKey(url)}`;

// ------------------------------------------------------------------- library
export async function library(user: string): Promise<Item[]> {
  const items = await findAll<Item>(C.item, { filter: { user }, sort: "-addedAt" });
  return items.filter((i) => !i.archived);
}

/** `seen`: every article the source had when it was added or last checked, so a daily check brings only new posts */
export interface Source { _id: string; user: string; url: string; site: string; topic: string; instruction: string; at: number; lastSync?: number; lastAdded?: number; lastError?: string; added?: number; seen?: string[] }
export const sourceId = (user: string, url: string, topic: string) => `${user}|${urlKey(url)}|${urlKey(topic.toLowerCase())}`;

export async function addItems(user: string, cands: Candidate[], meta: { site: string; topic: string; source: string; instruction?: string; seen?: string[] }): Promise<{ added: number; existing: number; items: Item[] }> {
  const have = new Set((await findAll<Item>(C.item, { filter: { user } })).filter((i) => !i.archived).map((i) => i._id));
  const now = Date.now();
  const fresh: Item[] = [];
  let existing = 0;
  cands.forEach((c, i) => {
    const _id = itemId(user, c.url);
    if (have.has(_id)) { existing++; return; }
    have.add(_id);
    fresh.push({
      _id, user, key: urlKey(c.url), url: c.url, title: c.title, slug: c.slug, summary: c.summary, tags: c.tags, date: c.date,
      site: meta.site, topic: meta.topic, source: meta.source, status: "new", addedAt: now - i, // keeps the source's order
    });
  });
  await putMany(C.item, fresh as unknown as Doc[]);
  if (meta.source) {
    const sid = sourceId(user, meta.source, meta.topic);
    const prev = await get<Source>(C.source, sid);
    const { canon } = await import("./discover");
    const seen = [...new Set([...(prev?.seen || []), ...(meta.seen || []), ...cands.map((c) => c.url)].map(canon))].slice(-3000);
    const src: Source = { ...(prev || {}), _id: sid, user, url: meta.source, site: meta.site, topic: meta.topic, instruction: meta.instruction ?? prev?.instruction ?? "", at: prev?.at || now, lastSync: now, added: (prev?.added || 0) + fresh.length, seen };
    if (fresh.length) src.lastAdded = now;
    await put(C.source, src as unknown as Record<string, unknown>, sid);
  }
  return { added: fresh.length, existing, items: fresh };
}

export async function getItem(user: string, id: string): Promise<Item | null> {
  const it = await get<Item>(C.item, id);
  return it && it.user === user ? it : null;
}

export async function patchItem(it: Item, patch: Partial<Item>): Promise<Item> {
  const next = { ...it, ...patch };
  await put(C.item, next as unknown as Record<string, unknown>, it._id);
  return next;
}

export async function sources(user: string): Promise<Source[]> {
  return (await findAll<Source>(C.source, { filter: { user } })).filter((x) => x.instruction !== undefined && x.url);
}

export interface SyncResult { id: string; site: string; topic: string; added: number; items: Item[]; error?: string }
const syncing = new Map<string, Promise<SyncResult[]>>();

/** check each source for posts that are not in the list yet and add the ones that match the original request */
export function syncSources(user: string, only?: string): Promise<SyncResult[]> {
  const key = `${user}|${only || "*"}`;
  if (syncing.has(key)) return syncing.get(key)!;
  const job = (async () => {
    const { discover, filterCandidates, canon } = await import("./discover");
    const list = (await sources(user)).filter((x) => !only || x._id === only);
    const mine = new Set((await findAll<Item>(C.item, { filter: { user } })).map((i) => canon(i.url)));
    const out: SyncResult[] = [];
    for (const src of list) {
      try {
        const d = await discover(src.url);
        const seen = new Set(src.seen || []);
        // only posts this source did not have before; the ones the reader left out stay left out
        const fresh = d.candidates.filter((c) => !mine.has(canon(c.url)) && !seen.has(canon(c.url)));
        let pick = fresh;
        if (fresh.length) { const f = await filterCandidates(fresh, src.instruction, d.siteName); pick = fresh.filter((_, i) => f.keep[i]); }
        const r = await addItems(user, pick, { site: src.site, topic: src.topic, source: src.url, instruction: src.instruction, seen: d.candidates.map((c) => c.url) });
        const after = await get<Source>(C.source, src._id);
        if (after) Object.assign(src, { seen: after.seen, added: after.added });
        await put(C.source, { ...src, lastSync: Date.now(), lastError: undefined, ...(r.added ? { lastAdded: Date.now(), added: (src.added || 0) + r.added } : {}) } as unknown as Record<string, unknown>, src._id);
        pick.forEach((c) => mine.add(canon(c.url)));
        out.push({ id: src._id, site: src.site, topic: src.topic, added: r.added, items: r.items });
      } catch (e) {
        await put(C.source, { ...src, lastSync: Date.now(), lastError: (e as Error).message } as unknown as Record<string, unknown>, src._id);
        out.push({ id: src._id, site: src.site, topic: src.topic, added: 0, items: [], error: (e as Error).message });
      }
    }
    return out;
  })().finally(() => syncing.delete(key));
  syncing.set(key, job);
  return job;
}

/** once a day, quietly, when the reader shows up */
export async function autoSync(user: string): Promise<void> {
  const due = (await sources(user)).some((x) => Date.now() - (x.lastSync || 0) > 20 * 3600_000);
  if (due) void syncSources(user).catch((e) => console.warn("[sync]", e));
}

export async function renameShelf(user: string, from: string, to: string): Promise<number> {
  const name = to.trim().slice(0, 40);
  if (!name || name === from) return 0;
  const items = (await findAll<Item>(C.item, { filter: { user } })).filter((i) => i.topic === from);
  await putMany(C.item, items.map((i) => ({ ...i, topic: name })) as unknown as Doc[]);
  for (const src of (await sources(user)).filter((x) => x.topic === from)) {
    const { remove } = await import("./db");
    const moved = { ...src, _id: sourceId(user, src.url, name), topic: name };
    await put(C.source, moved as unknown as Record<string, unknown>, moved._id);
    await remove(C.source, src._id);
  }
  return items.length;
}

// ------------------------------------------------------------- time reading
export const dayKey = (t: number, tz: string) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t); } catch { return new Date(t).toISOString().slice(0, 10); } };
const readId = (it: Item, day: string) => `${it._id}|${day}`;

/** the timer: a few seconds of active reading at a time, capped so a stuck tab cannot inflate it */
export async function addReadingTime(it: Item, seconds: number, tz: string): Promise<Item> {
  const sec = Math.max(0, Math.min(120, Math.round(seconds)));
  if (!sec) return it;
  const now = Date.now(), day = dayKey(now, tz);
  const prev = await get<ReadDay>(C.read, readId(it, day));
  const row: ReadDay = prev
    ? { ...prev, trackedSec: prev.trackedSec + sec, last: now }
    : { _id: readId(it, day), user: it.user, item: it._id, title: it.title, url: it.url, site: it.site, topic: it.topic, day, trackedSec: sec, first: now - sec * 1000, last: now };
  await put(C.read, row as unknown as Record<string, unknown>, row._id);
  return patchItem(it, { timeSec: (it.timeSec || 0) + sec });
}

/** "I spent 25 minutes on this": today's row takes what the earlier days' timer has not already counted */
export async function enterReadingTime(it: Item, minutes: number, tz: string): Promise<Item> {
  const min = Math.max(0, Math.min(600, Math.round(minutes)));
  const now = Date.now(), day = dayKey(now, tz);
  const rows = await findAll<ReadDay>(C.read, { filter: { item: it._id } });
  const earlier = rows.filter((r) => r.day !== day).reduce((n, r) => n + readMinutes(r), 0);
  const prev = rows.find((r) => r.day === day);
  const row: ReadDay = { ...(prev || { _id: readId(it, day), user: it.user, item: it._id, title: it.title, url: it.url, site: it.site, topic: it.topic, day, trackedSec: 0, first: now, last: now }), enteredMin: Math.max(0, Math.round(min - earlier)), last: now };
  await put(C.read, row as unknown as Record<string, unknown>, row._id);
  return patchItem(it, { enteredMin: min });
}

export async function readingLog(user: string, days = 90): Promise<ReadDay[]> {
  const since = Date.now() - days * 86_400_000;
  return (await findAll<ReadDay>(C.read, { filter: { user } })).filter((r) => r.last >= since).sort((a, b) => a.first - b.first);
}

// ----------------------------------------------------------------------- quiz
const QUIZ_SCHEMA = {
  name: "quiz",
  schema: {
    type: "object", additionalProperties: false, required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["q", "choices", "answer", "why"],
          properties: { q: { type: "string" }, choices: { type: "array", items: { type: "string" } }, answer: { type: "integer" }, why: { type: "string" } },
        },
      },
    },
  },
};

const quizInflight = new Map<string, Promise<Quiz | null>>();

/** one quiz per article, shared by every reader; concurrent callers share one generation */
export function quizFor(url: string): Promise<Quiz | null> {
  const key = urlKey(url);
  if (!quizInflight.has(key)) quizInflight.set(key, makeQuiz(url).finally(() => quizInflight.delete(key)));
  return quizInflight.get(key)!;
}

function shuffle(q: Question): Question {
  const order = q.choices.map((_, i) => i).sort(() => Math.random() - 0.5);
  return { ...q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
}

async function makeQuiz(url: string): Promise<Quiz | null> {
  const key = urlKey(url);
  const have = await get<Quiz>(C.quiz, key);
  if (have?.questions?.length) return have;
  const meta = await article(url);
  const body = await articleBody(url);
  if (!body?.text || body.text.length < 400) return null;
  const r = await ai.json<{ questions: Question[] }>([
    { role: "system", content: "You write short comprehension quizzes that check understanding, not trivia. Write 5 multiple-choice questions about the article's central ideas: mechanisms, trade-offs, why something works, when to use it. Each has exactly 4 plausible choices (no 'all of the above'), one correct `answer` (0-based index), and `why`: one sentence explaining the right answer using the article. Vary the position of the correct answer. Plain text, no markdown, no letter prefixes in choices." },
    { role: "user", content: `Title: ${meta.title}\n\nArticle:\n${body.text.slice(0, 24_000)}` },
  ], QUIZ_SCHEMA, 2500);
  const questions = (r?.questions || [])
    .map((q) => ({ ...q, choices: q.choices.slice(0, 5).map((c) => c.replace(/^[A-Ea-e][.)]\s+/, "")) }))
    .filter((q) => q.q && q.choices.length >= 2 && q.answer >= 0 && q.answer < q.choices.length)
    .map(shuffle);
  if (!questions.length) return null;
  const quiz: Quiz = { _id: key, url, questions, model: ai.FAST, at: Date.now() };
  await put(C.quiz, quiz as unknown as Record<string, unknown>, key);
  return quiz;
}

/** answers: a choice index, or null for a skipped question */
export async function recordQuiz(user: string, it: Item, quiz: Quiz, answers: (number | null)[]) {
  const answered = answers.filter((a) => a !== null).length;
  const score = answers.reduce<number>((n, a, i) => n + (a !== null && a === quiz.questions[i]?.answer ? 1 : 0), 0);
  await put(C.attempt, { user, item: it._id, url: it.url, answers, score, answered, total: quiz.questions.length, at: Date.now() });
  const best = it.quiz && it.quiz.score > score ? it.quiz : { score, total: quiz.questions.length, answered, at: Date.now() };
  return patchItem(it, { quiz: best });
}

// --------------------------------------------------------------------- recall
const GRADE_SCHEMA = {
  name: "grade",
  schema: {
    type: "object", additionalProperties: false, required: ["score", "verdict", "got", "missed", "nudge"],
    properties: {
      score: { type: "integer" }, verdict: { type: "string" },
      got: { type: "array", items: { type: "string" } }, missed: { type: "array", items: { type: "string" } }, nudge: { type: "string" },
    },
  },
};

export function nextInterval(prev: number | undefined, score: number): number {
  const p = prev || 0;
  if (score <= 1) return 1;
  if (score <= 3) return Math.min(30, Math.max(1, Math.round(p * 1.3) || 1));
  return Math.min(30, Math.max(2, Math.round((p || 1) * 2.2)));
}

export async function submitRecall(user: string, it: Item, text: string, kind: Recall["kind"]): Promise<{ recall: Recall; item: Item }> {
  const body = await articleBody(it.url).catch(() => null);
  const history = (await find<Recall>(C.recall, { filter: { user, item: it._id }, sort: "-at", limit: 3 })).hits.filter((r) => !r.skipped);
  let g: { score: number; verdict: string; got: string[]; missed: string[]; nudge: string } | null = null;
  if (text.trim()) {
    g = await ai.json([
      { role: "system", content: "You are a warm, exact learning coach. A reader wrote, from memory, what they recall about an article. Compare it with the article. Return: `score` 0-5 (0 nothing relevant, 3 the core idea in their own words, 5 core idea plus mechanism and a nuance; never punish brevity if it is right), `verdict` one encouraging sentence addressed to the reader, `got` 1-3 short phrases of what they recalled correctly, `missed` 1-3 short phrases of the most important ideas they did not mention (or corrections if they got something wrong), `nudge` one question to ask them next time to deepen recall. Plain text." },
      { role: "user", content: `Article: ${it.title}\n\n${(body?.text || it.summary || "").slice(0, 16_000)}\n\n---\nTheir earlier notes: ${history.map((h) => `“${h.text}”`).join(" ") || "none"}\n\nWhat they wrote now:\n${text}` },
    ], GRADE_SCHEMA, 700);
  }
  const score = g ? Math.max(0, Math.min(5, Math.round(g.score))) : undefined;
  const recall: Recall = {
    _id: `${user}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, user, item: it._id, title: it.title, topic: it.topic,
    text: text.trim(), at: Date.now(), kind, score, verdict: g?.verdict, got: g?.got, missed: g?.missed, nudge: g?.nudge,
  };
  await put(C.recall, recall as unknown as Record<string, unknown>, recall._id);
  const interval = nextInterval(it.recall?.interval, score ?? 3);
  const item = await patchItem(it, {
    recall: { count: (it.recall?.count || 0) + 1, lastAt: recall.at, interval, due: recall.at + interval * DAY - 3 * 3600_000, lastScore: score },
  });
  return { recall, item };
}

export async function skipRecall(user: string, it: Item): Promise<Item> {
  await put(C.recall, { _id: `${user}|${Date.now().toString(36)}s`, user, item: it._id, title: it.title, topic: it.topic, text: "", at: Date.now(), kind: "daily", skipped: true });
  return patchItem(it, { recall: { ...(it.recall || { count: 0 }), due: Date.now() + DAY - 3 * 3600_000 } });
}

export async function recallHistory(user: string, opts: { item?: string; limit?: number } = {}): Promise<Recall[]> {
  const filter: Record<string, unknown> = { user };
  if (opts.item) filter.item = opts.item;
  const hits = await findAll<Recall>(C.recall, { filter, sort: "-at" }, opts.limit || 2000);
  return hits.filter((r) => !r.skipped);
}

// ---------------------------------------------------------------------- today
export async function today(user: string, tz: string) {
  const [items, recalls, reads] = await Promise.all([library(user), recallHistory(user), readingLog(user, 8)]);
  const now = Date.now();
  const todayK = dayKey(now, tz);
  const doneToday = new Set(recalls.filter((r) => dayKey(r.at, tz) === todayK).map((r) => r.item));
  const read = items.filter((i) => i.status === "read" || i.recall?.count);
  const due = read.filter((i) => !doneToday.has(i._id) && (i.recall?.due ?? 0) <= now).sort((a, b) => (a.recall?.due ?? 0) - (b.recall?.due ?? 0));
  // never a quiet day: top up with what was recalled longest ago
  const extra = read.filter((i) => !doneToday.has(i._id) && !due.includes(i) && !(i.recall?.lastAt && dayKey(i.recall.lastAt, tz) === todayK))
    .sort((a, b) => (a.recall?.lastAt ?? 0) - (b.recall?.lastAt ?? 0));
  const queue = [...due, ...extra.slice(0, Math.max(0, 3 - due.length))].slice(0, 7);
  // streak: consecutive days, ending today or yesterday, with at least one recall
  const days = new Set(recalls.map((r) => dayKey(r.at, tz)));
  let streak = 0;
  for (let d = days.has(todayK) ? 0 : 1; d < 3650; d++) { if (days.has(dayKey(now - d * DAY, tz))) streak++; else break; }
  const heat: { day: string; n: number }[] = [];
  const perDay = new Map<string, number>();
  for (const r of recalls) perDay.set(dayKey(r.at, tz), (perDay.get(dayKey(r.at, tz)) || 0) + 1);
  for (let d = 111; d >= 0; d--) { const k = dayKey(now - d * DAY, tz); heat.push({ day: k, n: perDay.get(k) || 0 }); }
  const reading = items.filter((i) => i.status === "reading").sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  const next = items.filter((i) => i.status === "new").sort((a, b) => b.addedAt - a.addedAt);
  const scores = recalls.filter((r) => r.score !== undefined).slice(0, 30);
  return {
    queue: queue.map((i) => ({ ...i, overdue: (i.recall?.due ?? 0) <= now })),
    doneToday: doneToday.size, streak, heat,
    counts: { total: items.length, read: items.filter((i) => i.status === "read").length, reading: reading.length, new: next.length, notes: recalls.length },
    readToday: Math.round(reads.filter((r) => r.day === todayK).reduce((n, r) => n + readMinutes(r), 0)),
    readWeek: Math.round(reads.filter((r) => r.day > dayKey(now - 7 * DAY, tz)).reduce((n, r) => n + readMinutes(r), 0)),
    avgRecall: scores.length ? scores.reduce((n, r) => n + (r.score || 0), 0) / scores.length : null,
    continue: reading.slice(0, 3), upNext: next.slice(-6).reverse(),
    lastNotes: recalls.slice(0, 4),
  };
}

// ------------------------------------------------------------ assistant context
export async function assistantContext(user: string, itemId?: string): Promise<string> {
  const items = await library(user);
  const recalls = (await recallHistory(user, { limit: 40 })).slice(0, 12);
  const read = items.filter((i) => i.status === "read").slice(0, 25);
  const lines = [
    `You are the reader's reading assistant inside their personal learning system (a reading room). You help them understand what they read, connect ideas across articles, quiz them when asked, and suggest what to read next from their list. Be clear, concrete and friendly; use short paragraphs, examples and analogies; use Markdown (headings sparingly, lists, code blocks, tables when useful). When you use the article, say which part. If they ask about anything else, answer it well as a knowledgeable tutor.`,
    `Their library: ${items.length} items (${read.length ? `${items.filter((i) => i.status === "read").length} read` : "none read yet"}, ${items.filter((i) => i.status === "new").length} unread). Shelves: ${[...new Set(items.map((i) => i.topic))].slice(0, 8).join(", ") || "none"}.`,
    read.length ? `Recently read: ${read.slice(0, 12).map((i) => i.title).join(" · ")}` : "",
    items.some((i) => i.status === "new") ? `Unread, newest first: ${items.filter((i) => i.status === "new").slice(0, 15).map((i) => i.title).join(" · ")}` : "",
    recalls.length ? `Their recent recall notes (their own words):\n${recalls.map((r) => `- [${r.title}] “${r.text.slice(0, 220)}”${r.missed?.length ? ` (missed: ${r.missed.join("; ")})` : ""}`).join("\n")}` : "",
  ];
  if (itemId) {
    const it = await getItem(user, itemId);
    if (it) {
      const body = await articleBody(it.url).catch(() => null);
      lines.push(`They are reading now: “${it.title}” (${it.url}).\n<article>\n${(body?.text || it.summary || "(text unavailable)").slice(0, 60_000)}\n</article>\nGround answers about it in the article text; if the article does not cover something, say so and answer from general knowledge, labelled as such.`);
    }
  }
  return lines.filter(Boolean).join("\n\n");
}
