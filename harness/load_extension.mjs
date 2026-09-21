// Load the unpacked extension into a running Chrome (launched with --enable-unsafe-extension-debugging) over CDP.
import { chromium } from "playwright-core";
const cdp = process.env.CDP || "http://127.0.0.1:9222";
const path = process.argv[2];
const browser = await chromium.connectOverCDP(cdp);
const session = await browser.newBrowserCDPSession();
try {
  const r = await session.send("Extensions.loadUnpacked", { path });
  console.log(JSON.stringify({ loaded: true, id: r.id }));
} catch (e) {
  console.log(JSON.stringify({ loaded: false, error: String(e.message || e) }));
}
await browser.close();
