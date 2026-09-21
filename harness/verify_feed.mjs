// Drives a running Chrome (CDP) that has Jev Lens loaded: opens a feed, scrolls, and asserts the badges.
// Usage: node harness/verify_feed.mjs x|linkedin [cdp-url]
// Exit 0 when: ≥1 READ with a visible border, ≥1 SKIP dimmed, no page actions taken (we only read and scroll).
import { chromium } from "playwright-core";

const site = process.argv[2] || "x";
const cdp = process.argv[3] || process.env.CDP || "http://127.0.0.1:9222";
const url = site === "x" ? "https://x.com/home" : "https://www.linkedin.com/feed/";
const SEL = site === "x"
  ? 'article[data-testid="tweet"]'
  : '[data-testid="mainFeed"] div[role="listitem"][componentkey^="update-card-focus"]';

const browser = await chromium.connectOverCDP(cdp);
const context = browser.contexts()[0];
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const t0 = Date.now();
let scrolls = 0;
for (; scrolls < 25; scrolls++) {
  await page.evaluate(() => { const m = document.querySelector("main#workspace"); if (m && m.scrollHeight > m.clientHeight) m.scrollTop += 800; else window.scrollBy(0, 800); });
  await page.waitForTimeout(1800);
  const seen = await page.evaluate((SEL) => [...document.querySelectorAll(SEL)].some((el) => el.dataset.jevVerdict === "read"), SEL);
  if (seen && scrolls >= 5) break;
}

const report = await page.evaluate((SEL) => {
  const items = [...document.querySelectorAll(SEL)];
  const rows = items.map((el) => {
    const cs = getComputedStyle(el);
    return {
      verdict: el.dataset.jevVerdict || "none",
      pill: el.querySelector(".jev-pill")?.textContent || "",
      why: el.querySelector(".jev-why")?.textContent || "",
      bordered: cs.boxShadow !== "none" && cs.boxShadow.includes("rgb"),
      opacity: Number(cs.opacity),
      text: (el.innerText || "").replace(/\s+/g, " ").replace(/^.*?(ms\/\d+|promoted)\s*/i, "").slice(0, 80),
    };
  });
  const counts = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
  return { total: items.length, counts, counter: document.getElementById("jev-lens-counter")?.textContent || null, rows };
}, SEL);

const reads = report.rows.filter((r) => r.verdict === "read");
const skips = report.rows.filter((r) => r.verdict === "skip");
const checks = {
  content_script_alive: !!report.counter,
  posts_found: report.total > 0,
  some_judged: (report.counts.read || 0) + (report.counts.maybe || 0) + (report.counts.skip || 0) > 0,
  read_seen: reads.length > 0,
  read_has_border: reads.every((r) => r.bordered),
  skip_is_dimmed: skips.length > 0 && skips.every((r) => r.opacity < 0.6),
  no_errors: !(report.counts.error > 0),
};
console.log(`site=${site} posts=${report.total} scrolls=${scrolls} counts=${JSON.stringify(report.counts)} in ${((Date.now() - t0) / 1000).toFixed(1)}s | ${report.counter}`);
for (const r of report.rows.filter((r) => r.verdict !== "none").slice(0, 12)) console.log(`  ${r.verdict.padEnd(6)} ${r.pill.padEnd(12)} ${r.why.slice(0, 44).padEnd(44)} ${r.text.slice(0, 50)}`);
console.log("checks:", JSON.stringify(checks));
await page.close();
await browser.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
