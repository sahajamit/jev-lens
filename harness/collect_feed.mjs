// Collect judged posts with Jev's answers across N feed refreshes. Output: JSONL of {id, site, author, text, verdict, answers}.
// Usage: node harness/collect_feed.mjs linkedin|x <out.jsonl> [refreshes=5] [screens=14]
import { chromium } from "playwright-core";
import fs from "node:fs";
const site = process.argv[2] || "linkedin", out = process.argv[3] || "artifacts/posts.jsonl", refreshes = Number(process.argv[4] || 5), screens = Number(process.argv[5] || 14);
const url = site === "x" ? "https://x.com/home" : "https://www.linkedin.com/feed/";
const SEL = site === "x" ? 'article[data-testid="tweet"]' : '[data-testid="mainFeed"] div[role="listitem"][componentkey^="update-card-focus"]';
const browser = await chromium.connectOverCDP(process.env.CDP || "http://127.0.0.1:9222");
const page = await browser.contexts()[0].newPage();
const seen = new Set(); let total = 0;
for (let r = 0; r < refreshes; r++) {
  await page.goto(url, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6500);
  for (let i = 0; i < screens; i++) {
    await page.evaluate(() => { const m = document.querySelector("main#workspace"); if (m && m.scrollHeight > m.clientHeight) m.scrollTop += 750; else window.scrollBy(0, 750); });
    await page.waitForTimeout(1700);
  }
  await page.waitForTimeout(1500);
  const rows = await page.evaluate((SEL) => [...document.querySelectorAll(SEL)].filter((el) => el.dataset.jevAnswers).map((el) => {
    const A = window.JevLensAdapter; // not visible from the page world; re-derive minimal fields here
    const who = el.querySelector('button[aria-label^="Open control menu for post by"]')?.getAttribute("aria-label")?.replace(/^Open control menu for post by\s*/, "") || el.querySelector('[data-testid="User-Name"]')?.innerText.split("\n")[0] || "";
    const paras = [...el.querySelectorAll('p, [data-testid="tweetText"]')].map((p) => p.innerText.trim()).filter((t) => t.length > 20);
    paras.sort((a, b) => b.length - a.length);
    const id = el.getAttribute("componentkey") || (el.querySelector('a[href*="/status/"]')?.getAttribute("href") || "").match(/status\/(\d+)/)?.[1] || "";
    return { id, author: who, text: (paras[0] || "").slice(0, 1500), verdict: el.dataset.jevVerdict, answers: JSON.parse(el.dataset.jevAnswers) };
  }), SEL);
  let added = 0;
  for (const row of rows) { if (!row.id || seen.has(row.id)) continue; seen.add(row.id); fs.appendFileSync(out, JSON.stringify({ site, ...row }) + "\n"); added++; }
  total += added; console.log(`refresh ${r + 1}: ${rows.length} judged on screen, ${added} new (total ${total})`);
}
await page.close(); await browser.close();
