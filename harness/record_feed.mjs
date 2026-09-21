// Records the feed with Jev Lens active: CDP screencast + a smooth human-like scroll. Frames go to <out>/frames.
// Usage: node harness/record_feed.mjs linkedin|x <outdir> [seconds] [cdp-url]
import { chromium } from "playwright-core";
import fs from "node:fs";

const site = process.argv[2] || "linkedin"; const out = process.argv[3] || "artifacts/record"; const seconds = Number(process.argv[4] || 50);
const cdp = process.argv[5] || process.env.CDP || "http://127.0.0.1:9222";
const url = site === "x" ? "https://x.com/home" : "https://www.linkedin.com/feed/";
fs.mkdirSync(out + "/frames", { recursive: true });

const browser = await chromium.connectOverCDP(cdp);
const context = browser.contexts()[0];
const page = await context.newPage();
const cdps = await context.newCDPSession(page);
const VW = Number(process.env.VW || 1440), VH = Number(process.env.VH || 900);
await cdps.send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
if (site === "x" && process.env.X_TAB) { // e.g. X_TAB=Following: switch timeline tab before recording
  try { await page.getByRole("tab", { name: process.env.X_TAB }).click(); await page.waitForTimeout(4000); } catch (e) { console.error("tab switch failed:", e.message); }
}
// let the first screen get judged before the recording starts
await page.waitForTimeout(2500);

const epoch = Date.now(); let n = 0;
cdps.on("Page.screencastFrame", async (p) => {
  const ts = Math.max(0, Math.round(p.metadata.timestamp * 1000 - epoch));
  fs.writeFileSync(`${out}/frames/${String(ts).padStart(7, "0")}.jpg`, Buffer.from(p.data, "base64")); n++;
  try { await cdps.send("Page.screencastFrameAck", { sessionId: p.sessionId }); } catch {}
});
await cdps.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1440, maxHeight: Math.round(1440 * VH / VW), everyNthFrame: 1 });

// Log every change of the on-page counter with its timestamp, so a highlight can be cut where verdicts land.
const counterLog = []; let lastCounter = "";
const SEL = site === "x" ? 'article[data-testid="tweet"]' : '[data-testid="mainFeed"] div[role="listitem"][componentkey^="update-card-focus"]';
const JUDGED_JS = `[...document.querySelectorAll(${JSON.stringify(SEL)})].filter((el) => el.dataset.jevVerdict && el.dataset.jevVerdict !== "pending").map((el) => {
  const who = el.querySelector('button[aria-label^="Open control menu for post by"]')?.getAttribute("aria-label")?.replace(/^Open control menu for post by\\s*/, "") || el.querySelector('[data-testid="User-Name"]')?.innerText.split("\\n")[0] || "";
  const paras = [...el.querySelectorAll('p, [data-testid="tweetText"]')].map((p) => p.innerText.trim()).filter((t) => t.length > 20); paras.sort((a, b) => b.length - a.length);
  const id = el.getAttribute("componentkey") || (el.querySelector('a[href*="/status/"]')?.getAttribute("href") || "").match(/status\\/(\\d+)/)?.[1] || (who + "|" + (paras[0] || "").slice(0, 40));
  return { id, author: who, verdict: el.dataset.jevVerdict, why: el.querySelector(".jev-why")?.textContent || "", answers: el.dataset.jevAnswers ? JSON.parse(el.dataset.jevAnswers) : null, text: (paras[0] || "").slice(0, 600) };
})`;
const judgedAll = new Map(); // accumulate across the take; virtualised feeds drop posts from the DOM as you scroll
const pollCounter = setInterval(async () => {
  try {
    const c = await page.evaluate(() => document.getElementById("jev-lens-counter")?.textContent || ""); if (c && c !== lastCounter) { lastCounter = c; counterLog.push({ t: Date.now() - epoch, counter: c }); }
    for (const row of await page.evaluate(JUDGED_JS)) if (!judgedAll.has(row.id)) judgedAll.set(row.id, { t: Date.now() - epoch, ...row });
  } catch {}
}, 400);
// Human-like scroll: read a screen, glide down, pause, repeat. ~55% of time paused on content.
const scroller = site === "x" ? "window" : "main";
const t0 = Date.now();
while (Date.now() - t0 < seconds * 1000) {
  await page.waitForTimeout(Number(process.env.PAUSE_MIN || 1500) + Math.random() * Number(process.env.PAUSE_JIT || 1200));
  const px = Number(process.env.PX_MIN || 380) + Math.floor(Math.random() * Number(process.env.PX_JIT || 320));
  await page.evaluate(([px, scroller]) => new Promise((res) => {
    const el = scroller === "main" ? document.querySelector("main#workspace") : null;
    const start = el ? el.scrollTop : window.scrollY; const t0 = performance.now(); const dur = 700 + px;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); const y = start + px * e;
      if (el) el.scrollTop = y; else window.scrollTo(0, y); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  }), [px, scroller]);
}
await page.waitForTimeout(1500);
clearInterval(pollCounter);
await cdps.send("Page.stopScreencast");
fs.writeFileSync(out + "/counter-log.json", JSON.stringify(counterLog, null, 1));
// All posts judged during this take (accumulated while scrolling), with Jev's answers, so the take can be graded.
const judged = [...judgedAll.values()];
fs.writeFileSync(out + "/judged.json", JSON.stringify(judged, null, 1));
console.log(JSON.stringify({ frames: n, seconds: (Date.now() - epoch) / 1000 }));
await page.close(); await browser.close();
