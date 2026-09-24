# The Reading Room

**Read a blog, remember it for good.** Point it at any blog and say what you want ("AI posts only",
"all of it"), check the list, and the posts land on your shelves. Read in a quiet column with an assistant in
the margin, take a five-question quiz (skip any of it), then write a sentence or more from memory. Every recall
note is kept, and each article comes back for recall on a spaced schedule, so there is always something to
recall today.

**Live:** [reading.carebun.com](https://reading.carebun.com), part of [carebun.com](https://carebun.com) ·
**Chrome extension:** [download](https://reading.carebun.com/reading-room-extension.zip) · [how it works](extension/README.md) · MIT

| | |
|---|---|
| **Today** | the day's recall deck, streak, 16-week heatmap, minutes read today and this week, continue reading, your latest notes |
| **Library** | shelves shown as cards (or a list), sorted by the post's own date, with **Check for new posts**; new posts also arrive daily on their own |
| **Discover** | shared shelves anyone can add, whole or article by article, subscribed to their source: Outcome School's AI posts, *Thinking in Vectors*, *Memory for AI Agents*, the HanuDB docs |
| **Add** | "AI blogs only from https://outcomeschool.com/blog" → the whole index is read, filtered by meaning, and shown for you to check before anything is added |
| **Reader** | a clean reading copy (Mozilla Readability), outline, progress, a reading timer, **Finish**, select any passage to ask about it |
| **Quiz → Recall** | five questions written from the article; then one or more sentences from memory, scored 0–5 with what you got and what to add |
| **Notebook** | every recall note, by day, searchable |
| **Assistant** | chat about anything; it knows your shelves and your notes. Claude Sonnet 5 by default, any OpenRouter model |
| **Admin** | readers, password resets (signs them out everywhere), roles, accounts |

## The Chrome extension

Some sites are best read where they are. The extension puts a small pill on any article in your list: **Start
reading**, a timer that runs only while that tab is in front of you, **Digest** (keeps counting while you step
away to think a long post over, up to 30 minutes), **Pause**, and **I've finished**, which logs the minutes and
opens the quiz and recall. Your list is matched on your own machine; browsing history is never sent anywhere.
Details and install: [extension/README.md](extension/README.md).

## Run it yourself

You need [Bun](https://bun.sh) and an [OpenRouter](https://openrouter.ai) key.

```sh
bun install
cp .env.example .env        # set OPEN_ROUTER_KEY, SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
bun run dev                 # http://localhost:3500
```

With no `TWINDB_URL`, everything is stored in files under `.data/`. For a real deployment it uses
[HanuDB](https://github.com/madhudream/hanudb) (a document database for one small VM, durable in a bucket) and a
Cloud Storage bucket for article bodies; `scripts/deploy.sh` deploys to Cloud Run (set `GCP_PROJECT`,
`LMS_BUCKET_NAME`, `TWINDB_PRIVATE_URL`, `TWINDB_SECRET`; `--setup` once creates the service account and secrets
from `.env`).

## How it works

- `src/lib/discover.ts` finds a site's articles: a Next.js post index (`__NEXT_DATA__`), RSS/Atom, a GitHub
  docs folder (`github.com/<owner>/<repo>/tree/<branch>/<dir>`), the page's own links (table-of-contents rows,
  "next page"), or its sitemap. A request like "AI only" is judged by a fast model over titles, tags and summaries.
- Every import is a source that remembers what it has seen: the daily check (or **Check for new posts**) adds only
  posts that are new since then and match the original request.
- `src/lib/extract.ts` makes one reading copy per URL, shared by all readers: Readability plus an allow-list
  sanitiser, or GitHub Markdown rendered directly. Domains in `LINK_OUT_DOMAINS` (default `outcomeschool.com`)
  show a summary and outline and link to the original; their text still feeds the quiz, grading and assistant.
- `src/lib/learn.ts`: quizzes (cached per article, answers shuffled), recall grading, spacing (1 → 2 → 5 → 11 →
  24 days, capped at 30, reset after a weak recall), streaks, minutes read, and the assistant's context.
- `src/lib/catalog.ts`: Discover collections; an admin publishes one from a shelf or a source.
- `GET /api/export/reading?user=…` (bearer `READING_EXPORT_TOKEN`) gives one reader's minutes per day, for a
  personal hours log.
- Auth is a username and a password (scrypt) and a signed cookie; the extension sends the same signed value as a
  bearer token. A password reset revokes every session.

## Checks

`bun run typecheck` · `bun scripts/e2e.ts <dir>` (drives the real UI: read → quiz → recall → notebook → import →
ask about a selection) · `bun scripts/shots.ts <dir>` (desktop, phone and dark screenshots). Both need
`SHOT_USER` and `SHOT_PASS` for a test account.
