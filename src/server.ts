/**
 * The reading room — one Bun process: the API and the app (Bun bundles src/web/index.html).
 *
 *   bun run dev     # http://localhost:3500, hot reload
 *   bun run start   # production
 */
import index from "./web/index.html";
import * as auth from "./lib/auth";
import * as ai from "./lib/ai";
import { C, find, get, health, newId, put, remove } from "./lib/db";
import { canon, discover, filterCandidates, parseCommand, type Candidate } from "./lib/discover";
import { article, articleBody, prefetch } from "./lib/extract";
import * as learn from "./lib/learn";
import * as catalog from "./lib/catalog";

const PORT = Number(process.env.PORT || 3500);
const ALLOW_SIGNUP = (process.env.ALLOW_SIGNUP ?? "true") !== "false";

type Handler = (req: Request, s: auth.Session, params: Record<string, string>) => Promise<Response> | Response;

const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, init);
const bad = (error: string, status = 400) => json({ error }, { status });
async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
const tzOf = (req: Request) => req.headers.get("x-tz") || "UTC";

/** a route that needs a signed-in reader (and optionally an admin) */
function user(h: Handler, admin = false) {
  return async (req: Request & { params?: Record<string, string> }) => {
    try {
      const s = await auth.session(req);
      if (!s) return bad("Sign in first.", 401);
      if (admin && s.role !== "admin") return bad("Admins only.", 403);
      return await h(req, s, req.params || {});
    } catch (e) {
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}`, e);
      if ((e as { code?: string }).code === "ConnectionRefused" || /Unable to connect/.test((e as Error).message)) return bad("The database is unreachable right now. Try again in a moment.", 503);
      return bad((e as Error).message || "Something went wrong.", 500);
    }
  };
}

// small per-user limiter for the expensive calls
const hits = new Map<string, number[]>();
function limited(key: string, perMinute: number): boolean {
  const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(key, arr);
  return arr.length > perMinute;
}

async function itemView(s: auth.Session, id: string) {
  const it = await learn.getItem(s.username, id);
  if (!it) return null;
  const meta = await article(it.url);
  const body = meta.error ? null : await articleBody(it.url).catch(() => null);
  const history = await learn.recallHistory(s.username, { item: id });
  return { item: it, article: { ...meta, html: meta.linkOut ? null : body?.html ?? null, hasText: !!body?.text }, history };
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
  routes: {
    "/api/health": async () => json({ ok: true, db: await health(), ai: ai.hasKey() }),

    // ------------------------------------------------------------------ auth
    "/api/me": async (req) => {
      const s = await auth.session(req);
      return json({ user: s, allowSignup: ALLOW_SIGNUP, models: ai.CHAT_MODELS, defaultModel: ai.CHAT_DEFAULT });
    },
    "/api/auth/login": {
      POST: async (req) => {
        const b = await body<{ username?: string; password?: string }>(req);
        if (limited(`login:${req.headers.get("x-forwarded-for") || "local"}`, 20)) return bad("Too many attempts; wait a minute.", 429);
        const r = await auth.login(b.username || "", b.password || "");
        if (!r.ok) return bad(r.error, 401);
        return json({ ok: true }, { headers: { "set-cookie": auth.sessionCookie(r.user) } });
      },
    },
    "/api/auth/signup": {
      POST: async (req) => {
        if (!ALLOW_SIGNUP) return bad("Sign-ups are closed; ask the admin for an account.", 403);
        const b = await body<{ username?: string; password?: string; name?: string }>(req);
        if (limited(`signup:${req.headers.get("x-forwarded-for") || "local"}`, 5)) return bad("Too many sign-ups; wait a minute.", 429);
        const r = await auth.signup(b.username || "", b.password || "", b.name || "");
        if (!r.ok) return bad(r.error);
        return json({ ok: true }, { headers: { "set-cookie": auth.sessionCookie(r.user) } });
      },
    },
    // the Chrome extension signs in here and keeps the token (a password reset revokes it)
    "/api/ext/login": {
      POST: async (req) => {
        const b = await body<{ username?: string; password?: string }>(req);
        if (limited(`login:${req.headers.get("x-forwarded-for") || "local"}`, 20)) return bad("Too many attempts; wait a minute.", 429);
        const r = await auth.login(b.username || "", b.password || "");
        if (!r.ok) return bad(r.error, 401);
        return json({ token: auth.sessionToken(r.user), user: { username: r.user.username, name: r.user.name || r.user.username } });
      },
    },
    /** every URL in the list, so the extension can match pages on the reader's own machine */
    "/api/urls": user(async (_req, s) => {
      const items = await learn.library(s.username);
      return json({ items: items.map((i) => ({ id: i._id, url: i.url, title: i.title, status: i.status, topic: i.topic, timeSec: i.timeSec || 0, enteredMin: i.enteredMin ?? null, minutes: null })) });
    }),
    /** "add this page" from the extension */
    "/api/items/add": {
      POST: user(async (req, s) => {
        const b = await body<{ url?: string; title?: string }>(req);
        if (!/^https?:\/\//.test(b.url || "")) return bad("That page has no web address.");
        const url = canon(b.url!);
        const site = new URL(url).hostname.replace(/^www\./, "");
        const r = await learn.addItems(s.username, [{ url, slug: url.split("/").filter(Boolean).pop() || site, title: String(b.title || url).slice(0, 300) }], { site, topic: "Saved from the web", source: "" });
        prefetch([url]);
        const id = r.items[0]?._id || learn.itemId(s.username, url);
        return json({ id, added: r.added });
      }),
    },
    "/api/auth/logout": { POST: () => json({ ok: true }, { headers: { "set-cookie": auth.clearCookie() } }) },
    "/api/auth/password": {
      POST: user(async (req, s) => {
        const b = await body<{ current?: string; next?: string }>(req);
        const ok = await auth.login(s.username, b.current || "");
        if (!ok.ok) return bad("Your current password is not right.", 401);
        if (!(await auth.setPassword(s.username, b.next || ""))) return bad("Use at least 6 characters.");
        const u = await get<auth.User>(C.user, s.username);
        return json({ ok: true }, { headers: { "set-cookie": auth.sessionCookie(u!) } });
      }),
    },

    // ----------------------------------------------------------------- admin
    "/api/admin/users": user(async () => {
      const users = await auth.listUsers();
      const counts = await Promise.all(users.map(async (u) => {
        const [items, notes] = await Promise.all([find(C.item, { filter: { user: u.username }, limit: 0 }), find(C.recall, { filter: { user: u.username }, limit: 0 })]);
        return { ...u, items: items.total, notes: notes.total };
      }));
      return json({ users: counts });
    }, true),
    "/api/admin/reset": {
      POST: user(async (req) => {
        const b = await body<{ username?: string; password?: string }>(req);
        const pw = b.password?.trim() || auth.tempPassword();
        if (!(await auth.setPassword(b.username || "", pw))) return bad("No such user, or the password is under 6 characters.");
        return json({ ok: true, username: b.username, password: pw });
      }, true),
    },
    "/api/admin/role": {
      POST: user(async (req, s) => {
        const b = await body<{ username?: string; role?: auth.Role }>(req);
        if (b.username === s.username) return bad("You cannot change your own role.");
        if (b.role !== "admin" && b.role !== "learner") return bad("Unknown role.");
        return (await auth.setRole(b.username || "", b.role)) ? json({ ok: true }) : bad("No such user.");
      }, true),
    },
    "/api/admin/create": {
      POST: user(async (req) => {
        const b = await body<{ username?: string; password?: string; name?: string; role?: auth.Role }>(req);
        const pw = b.password?.trim() || auth.tempPassword();
        const r = await auth.signup(b.username || "", pw, b.name || "", b.role === "admin" ? "admin" : "learner");
        return r.ok ? json({ ok: true, username: r.user.username, password: pw }) : bad(r.error);
      }, true),
    },

    // ---------------------------------------------------------------- import
    "/api/import/preview": {
      POST: user(async (req, s) => {
        if (limited(`import:${s.username}`, 8)) return bad("Give it a minute between imports.", 429);
        const { text = "" } = await body<{ text?: string }>(req);
        const { urls, instruction } = parseCommand(text);
        if (!urls.length) return bad("Include a link, e.g. “AI blogs only from https://outcomeschool.com/blog”.");
        const mine = new Set((await learn.library(s.username)).map((i) => canon(i.url)));
        const results = [];
        for (const url of urls.slice(0, 3)) {
          try {
            const d = await discover(url);
            const f = await filterCandidates(d.candidates, instruction, d.siteName);
            results.push({
              // shelf: the site's name, plus the filter when there is one ("Outcome School · System design")
              source: url, siteName: d.siteName, method: d.method, topic: f.topic === d.siteName ? d.siteName : `${d.siteName} · ${f.topic}`, reason: f.reason, instruction,
              candidates: d.candidates.map((c, i) => ({ ...c, keep: f.keep[i], inLibrary: mine.has(canon(c.url)) })),
            });
          } catch (e) {
            results.push({ source: url, error: (e as Error).message, candidates: [] });
          }
        }
        return json({ results });
      }),
    },
    "/api/import/commit": {
      POST: user(async (req, s) => {
        const b = await body<{ source?: string; site?: string; topic?: string; instruction?: string; items?: Candidate[]; seen?: string[] }>(req);
        const items = (b.items || []).filter((c) => c && /^https?:\/\//.test(c.url) && c.title).slice(0, 1500)
          .map((c) => ({ url: canon(c.url), slug: String(c.slug || ""), title: String(c.title).slice(0, 300), summary: c.summary?.slice(0, 600), tags: c.tags?.slice(0, 8), date: c.date, readingTime: c.readingTime }));
        if (!items.length) return bad("Pick at least one article.");
        const r = await learn.addItems(s.username, items, { site: String(b.site || new URL(items[0].url).hostname).slice(0, 80), topic: String(b.topic || "Reading").slice(0, 40), source: String(b.source || ""), instruction: String(b.instruction || "").slice(0, 300), seen: (b.seen || []).filter((u) => typeof u === "string").slice(0, 3000) });
        prefetch(r.items.slice(0, 40).map((i) => i.url));
        return json({ added: r.added, existing: r.existing });
      }),
    },

    // --------------------------------------------------------------- library
    "/api/library": user(async (_req, s) => {
      void learn.autoSync(s.username).catch(() => {});
      const [items, sources] = await Promise.all([learn.library(s.username), learn.sources(s.username)]);
      return json({ items, sources });
    }),
    "/api/today": user(async (req, s) => {
      void learn.autoSync(s.username).catch(() => {});
      return json(await learn.today(s.username, tzOf(req)));
    }),
    // --------------------------------------------------------------- discover
    "/api/catalog": {
      GET: user(async (_req, s) => json({ collections: await catalog.forReader(s.username), canPublish: s.role === "admin" })),
      /** admin: publish a shelf, or build a collection from a source */
      POST: user(async (req, s) => {
        const b = await body<{ shelf?: string; description?: string; name?: string; source?: string; instruction?: string; hue?: number }>(req);
        if (b.shelf) return json({ collection: await catalog.fromShelf(s.username, b.shelf, String(b.description || "").slice(0, 400)) });
        if (b.source && b.name) return json({ collection: await catalog.fromSource({ name: b.name.slice(0, 60), description: String(b.description || "").slice(0, 400), source: b.source, instruction: b.instruction || "all", hue: b.hue, by: s.username }) });
        return bad("Give a shelf to share, or a name and a source.");
      }, true),
    },
    "/api/catalog/:id": {
      GET: user(async (_req, s, p) => { const c = await catalog.detail(s.username, p.id); return c ? json({ collection: c }) : bad("No such collection.", 404); }),
      DELETE: user(async (_req, _s, p) => { await catalog.drop(p.id); return json({ ok: true }); }, true),
    },
    "/api/catalog/:id/add": {
      POST: user(async (req, s, p) => {
        const b = await body<{ urls?: string[] }>(req);
        const r = await catalog.addTo(s.username, p.id, b.urls);
        prefetch(r.items.slice(0, 30).map((i) => i.url));
        return json({ added: r.added, existing: r.existing });
      }),
    },
    "/api/catalog/:id/refresh": {
      POST: user(async (_req, s, p) => {
        const c = await catalog.one(p.id);
        if (!c?.source) return bad("This collection has no source to re-read.");
        return json({ collection: await catalog.fromSource({ _id: c._id, name: c.name, description: c.description, source: c.source, instruction: c.instruction, hue: c.hue, by: s.username, order: c.order }) });
      }, true),
    },
    "/api/sources/sync": {
      POST: user(async (req, s) => {
        if (limited(`sync:${s.username}`, 6)) return bad("Give it a minute between checks.", 429);
        const { id } = await body<{ id?: string }>(req);
        const results = await learn.syncSources(s.username, id || undefined);
        const added = results.filter((r) => r.added).flatMap((r) => r.items);
        prefetch(added.slice(0, 20).map((i) => i.url));
        return json({ results: results.map(({ items, ...r }) => ({ ...r, titles: items.map((i) => i.title) })) });
      }),
    },
    "/api/shelves/rename": {
      POST: user(async (req, s) => {
        const b = await body<{ from?: string; to?: string }>(req);
        if (!b.from || !b.to?.trim()) return bad("Give the shelf a name.");
        return json({ moved: await learn.renameShelf(s.username, b.from, b.to), name: b.to.trim().slice(0, 40) });
      }),
    },
    "/api/notes": user(async (req, s) => {
      const q = (new URL(req.url).searchParams.get("q") || "").toLowerCase();
      let notes = await learn.recallHistory(s.username);
      if (q) notes = notes.filter((n) => `${n.title} ${n.text} ${n.topic}`.toLowerCase().includes(q));
      return json({ notes });
    }),
    "/api/items/:id": {
      GET: user(async (_req, s, p) => {
        const v = await itemView(s, p.id);
        if (!v) return bad("Not in your list.", 404);
        if (v.item.status === "new") v.item = await learn.patchItem(v.item, { status: "reading", openedAt: Date.now() });
        else v.item = await learn.patchItem(v.item, { openedAt: Date.now() });
        if (v.article.hasText) void learn.quizFor(v.item.url).catch(() => {}); // warm the quiz while they read
        return json(v);
      }),
      PATCH: user(async (req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        const b = await body<Partial<learn.Item>>(req);
        const patch: Partial<learn.Item> = {};
        if (b.status && ["new", "reading", "read"].includes(b.status)) { patch.status = b.status; if (b.status === "read") patch.readAt = Date.now(); }
        if (typeof b.progress === "number") patch.progress = Math.max(it.progress || 0, Math.min(1, b.progress));
        if (typeof b.topic === "string" && b.topic.trim()) patch.topic = b.topic.trim().slice(0, 40);
        let cur = it;
        if (typeof (b as { minutes?: number }).minutes === "number") cur = await learn.enterReadingTime(it, (b as { minutes: number }).minutes, tzOf(req));
        if (b.status === "read" && !it.recall?.due) patch.recall = { ...(it.recall || { count: 0 }), due: Date.now() + 20 * 3600_000, interval: 1 };
        return json({ item: await learn.patchItem(cur, patch) });
      }),
      DELETE: user(async (_req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        await remove(C.item, it._id);
        return json({ ok: true });
      }),
    },
    "/api/items/:id/time": {
      POST: user(async (req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        const b = await body<{ seconds?: number; tz?: string }>(req);
        const next = await learn.addReadingTime(it, Number(b.seconds) || 0, b.tz || tzOf(req));
        return json({ timeSec: next.timeSec || 0 });
      }),
    },
    "/api/items/:id/history": user(async (_req, s, p) => {
      const it = await learn.getItem(s.username, p.id);
      if (!it) return bad("Not in your list.", 404);
      return json({ history: await learn.recallHistory(s.username, { item: it._id }) });
    }),
    "/api/items/:id/refetch": {
      POST: user(async (_req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        await article(it.url, true);
        return json(await itemView(s, p.id));
      }),
    },
    "/api/items/:id/quiz": {
      GET: user(async (_req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        const quiz = await learn.quizFor(it.url);
        return quiz ? json({ quiz }) : bad("Could not build a quiz for this article (no readable text, or the model is unavailable).", 422);
      }),
      POST: user(async (req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        const quiz = it && (await learn.quizFor(it.url));
        if (!it || !quiz) return bad("No quiz.", 404);
        const { answers = [] } = await body<{ answers?: (number | null)[] }>(req);
        return json({ item: await learn.recordQuiz(s.username, it, quiz, answers.slice(0, quiz.questions.length)) });
      }),
    },
    "/api/items/:id/recall": {
      POST: user(async (req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        if (limited(`recall:${s.username}`, 20)) return bad("Slow down a little.", 429);
        const b = await body<{ text?: string; kind?: learn.Recall["kind"] }>(req);
        const text = String(b.text || "").trim().slice(0, 4000);
        if (text.split(/\s+/).length < 3) return bad("Write at least a sentence.");
        return json(await learn.submitRecall(s.username, it, text, b.kind === "daily" || b.kind === "free" ? b.kind : "after-read"));
      }),
    },
    "/api/items/:id/recall/skip": {
      POST: user(async (_req, s, p) => {
        const it = await learn.getItem(s.username, p.id);
        if (!it) return bad("Not in your list.", 404);
        return json({ item: await learn.skipRecall(s.username, it) });
      }),
    },

    // ------------------------------------------------------------------ chat
    "/api/chats": user(async (_req, s) => {
      const r = await find<Record<string, unknown>>(C.chat, { filter: { user: s.username }, sort: "-updated", limit: 60 });
      return json({ chats: r.hits.map((c) => ({ _id: c._id, title: c.title, itemId: c.itemId, updated: c.updated, n: (c.messages as unknown[])?.length || 0 })) });
    }),
    "/api/chats/:id": {
      GET: user(async (_req, s, p) => {
        const c = await get<Record<string, unknown>>(C.chat, p.id);
        return c && c.user === s.username ? json({ chat: c }) : bad("Not found.", 404);
      }),
      DELETE: user(async (_req, s, p) => {
        const c = await get<Record<string, unknown>>(C.chat, p.id);
        if (!c || c.user !== s.username) return bad("Not found.", 404);
        await remove(C.chat, p.id);
        return json({ ok: true });
      }),
    },
    "/api/chat": {
      POST: user(async (req, s) => {
        if (!ai.hasKey()) return bad("The assistant needs an OpenRouter key on the server.", 503);
        if (limited(`chat:${s.username}`, 30)) return bad("Too many messages in a minute.", 429);
        const b = await body<{ threadId?: string; itemId?: string; model?: string; message?: string; selection?: string }>(req);
        const message = String(b.message || "").trim().slice(0, 8000);
        if (!message) return bad("Say something.");
        type Turn = { role: "user" | "assistant"; content: string; at: number; model?: string };
        let thread = b.threadId ? await get<{ _id: string; user: string; title: string; itemId?: string; model: string; messages: Turn[] }>(C.chat, b.threadId) : null;
        if (thread && thread.user !== s.username) thread = null;
        const itemId = thread?.itemId || b.itemId || undefined;
        const model = ai.CHAT_MODELS.some((m) => m.id === b.model) ? b.model! : thread?.model || ai.CHAT_DEFAULT;
        const id = thread?._id || `${s.username}|${newId()}`;
        const userTurn = b.selection ? `> ${b.selection.slice(0, 2000).replace(/\n/g, "\n> ")}\n\n${message}` : message;
        const past = (thread?.messages || []).slice(-24);
        const system = await learn.assistantContext(s.username, itemId);
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(ctrl) {
            let answer = "";
            try {
              answer = await ai.stream(model, [{ role: "system", content: system }, ...past.map((t) => ({ role: t.role, content: t.content })), { role: "user", content: userTurn }], (chunk) => ctrl.enqueue(enc.encode(chunk)), req.signal);
            } catch (e) {
              const msg = `\n\n_(The assistant could not answer: ${(e as Error).message.slice(0, 160)})_`;
              answer += msg; ctrl.enqueue(enc.encode(msg));
            }
            const title = thread?.title || message.replace(/\s+/g, " ").slice(0, 70);
            const now = Date.now();
            await put(C.chat, { user: s.username, title, itemId, model, messages: [...(thread?.messages || []), { role: "user", content: userTurn, at: now }, { role: "assistant", content: answer, at: now, model }] }, id).catch((e) => console.error("[chat] save", e));
            ctrl.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "x-thread-id": id, "cache-control": "no-store", "x-accel-buffering": "no" } });
      }),
    },

    // my_site's hours collector reads one reader's minutes here (a bearer token, not a login)
    "/api/export/reading": async (req) => {
      const token = process.env.READING_EXPORT_TOKEN;
      if (!token || req.headers.get("authorization") !== `Bearer ${token}`) return bad("Not allowed.", 401);
      const u = new URL(req.url);
      const rows = await learn.readingLog(auth.normalize(u.searchParams.get("user") || ""), Math.min(400, Number(u.searchParams.get("days")) || 90));
      return json({ user: u.searchParams.get("user"), rows: rows.map((r) => ({ day: r.day, title: r.title, url: r.url, site: r.site, topic: r.topic, minutes: +learn.readMinutes(r).toFixed(1), tracked: Math.round(r.trackedSec / 60), entered: r.enteredMin ?? null, from: new Date(r.first).toISOString(), to: new Date(r.last).toISOString() })) });
    },
    "/reading-room-extension.zip": () => {
      const f = Bun.file(`${import.meta.dir}/ext/reading-room-extension.zip`);
      return new Response(f, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="reading-room-extension.zip"', "cache-control": "no-cache" } });
    },
    "/api/*": () => bad("No such endpoint.", 404),
    "/*": index,
  },
  error(e) {
    console.error(e);
    return /Unable to connect/.test(e.message) ? bad("The database is unreachable right now. Try again in a moment.", 503) : bad("Server error.", 500);
  },
});

auth.seedAdmin().catch((e) => console.error("[auth] seed failed", e));
console.log(`reading room on http://localhost:${server.port} · db ${(await health()).mode} · ai ${ai.hasKey() ? "on" : "off"}`);
