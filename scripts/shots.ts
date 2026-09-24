#!/usr/bin/env bun
/** screenshots of every page, desktop and phone, for a look before shipping:  bun scripts/shots.ts <outdir> [base] */
import puppeteer from "puppeteer-core";
const out = process.argv[2] || ".data/shots";
const base = process.argv[3] || "http://localhost:3500";
const user = process.env.SHOT_USER || "", pass = process.env.SHOT_PASS || "";
if (!user || !pass) { console.error("set SHOT_USER and SHOT_PASS to a test account"); process.exit(2); }
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(base, { waitUntil: "networkidle0" });
await page.screenshot({ path: `${out}/login.png` });
await page.evaluate(async (u, p) => { await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }); }, user, pass);
const lib = await page.evaluate(async () => (await (await fetch("/api/library")).json()).items as { _id: string; url: string; status: string }[]);
const read = lib.find((i) => i.url.includes("/k/01"))!, out2 = lib.find((i) => i.url.includes("outcomeschool"))!;
const routes: [string, string][] = [["today", "/"], ["library", "/library"], ["add", "/add"], ["reader", `/read/${encodeURIComponent(read._id)}`], ["linkout", `/read/${encodeURIComponent(out2._id)}`], ["recall", "/recall"], ["notebook", "/notebook"], ["assistant", "/assistant"]];
for (const [dark, suffix] of [[false, ""], [true, "-dark"]] as const) {
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
  for (const [name, path] of routes) {
    if (dark && !["today", "reader", "library"].includes(name)) continue;
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(base + path, { waitUntil: "networkidle0" });
    await Bun.sleep(700);
    await page.screenshot({ path: `${out}/${name}${suffix}.png` });
    if (!dark) {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await page.goto(base + path, { waitUntil: "networkidle0" });
      await Bun.sleep(500);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      if (wide > 390) console.log(`!! ${name} is ${wide}px wide on a phone`);
      await page.screenshot({ path: `${out}/${name}-phone.png` });
    }
  }
}
await browser.close();
console.log("shots in", out);
