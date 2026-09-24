#!/usr/bin/env bun
/**
 * seed-catalog — the first Discover collections. Safe to re-run: each is rebuilt from its source.
 *   bun scripts/seed-catalog.ts          (needs TWINDB_URL: `bun run tunnel` first)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as catalog from "../src/lib/catalog";

const by = process.env.ADMIN_USERNAME || "hanu";
const seeds = [
  { name: "Outcome School blogs", description: "Amit Shekhar’s AI posts: LLM architecture, attention, inference and serving, RAG, agents and the math underneath, one clear idea at a time. New posts arrive daily.", source: "https://outcomeschool.com/blog", instruction: "AI blogs only", hue: 14, order: 1 },
  { name: "Memory for AI Agents", description: "How an AI assistant remembers you, in plain English: the card file with two dates, the secretary who never tears a page out, the librarian with three ways to search.", source: "https://memory-notes-246726325229.us-central1.run.app/", instruction: "all", hue: 20, order: 2 },
  { name: "Thinking in Vectors", description: "A book in 66 chapters, from “what is a vector?” to retrieval over a hundred million chunks. Every idea built from something you already know.", source: "https://madhudream.dev/learn/vectors", instruction: "all", hue: 212, order: 3 },
];
for (const s of seeds) {
  try { const c = await catalog.fromSource({ ...s, _id: undefined, by }); console.log(`✓ ${c.name}: ${c.count} articles`); }
  catch (e) { console.log(`✗ ${s.name}: ${(e as Error).message}`); }
}

// HanuDB docs: from GitHub once the folder is pushed; until then from the local checkout, with the GitHub
// addresses they will have (the reader shows "not on GitHub yet" for a file that is not pushed)
const HANU = { name: "HanuDB docs", description: "The small database for people who build a lot of apps: why it exists, the building blocks, how it works, quickstart, deploying on GCP, and the API.", source: "https://github.com/madhudream/hanudb/tree/main/docs", instruction: "all", hue: 28, order: 4, by };
try { const c = await catalog.fromSource(HANU); console.log(`✓ ${c.name}: ${c.count} articles (from GitHub)`); }
catch (e) {
  const dir = join(process.env.HOME || "", "apps/hanudb/docs");
  if (!existsSync(dir)) { console.log(`✗ HanuDB docs: ${(e as Error).message}`); process.exit(0); }
  const items = readdirSync(dir).filter((f) => /^\d.*\.md$/.test(f)).sort().map((f) => {
    const md = readFileSync(join(dir, f), "utf8");
    const summary = md.replace(/^#.*$/gm, "").replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/).map((p) => p.replace(/[*_`>#[\]()]/g, "").replace(/\s+/g, " ").trim()).find((p) => p.length > 40)?.slice(0, 400);
    return { url: `https://github.com/madhudream/hanudb/blob/main/docs/${f}`, slug: f.replace(/\.md$/, ""), title: md.match(/^#\s+(.+)$/m)?.[1]?.trim() || f, summary };
  });
  const c = await catalog.save({ ...HANU, site: "hanudb docs", items });
  console.log(`✓ ${c.name}: ${c.count} articles (from the local checkout; ${(e as Error).message})`);
}
