# AGENTS.md

Plain-JS Manifest V3 Chrome extension, no build step, no framework. Keep it that way: it must load unpacked on any machine.

- `extension/adapters/*.js` expose `window.JevLensAdapter = { site, root(), posts(), extract(el) }`. Add a site by adding an adapter and a `content_scripts` entry; never put site specifics in `content.js`.
- `extension/worker.js` owns the Jev request shape (`questionsFor`) and the verdict rules (`verdictFor`). Keep questions atomic. User taste lives in settings (`persona`, `profile`, `antiProfile`, `thresholds`), never in code. Bump `DEFAULTS.profileVersion` when shipping a changed default profile; the migration in `onInstalled` replaces the stored one.
- Never add page actions (click, like, hide, follow, post, message). The extension reads and styles only.
- Never log, print or commit an API key. Keys live in `chrome.storage.local` only.
- Badge placement is per site (`html.jev-site-<site>` on the root): X tweets are flex rows, LinkedIn cards are blocks. See `styles.css`.
- Verify with `node harness/verify_feed.mjs x` and `... linkedin` against a Chrome started with `--remote-debugging-port=9222 --enable-unsafe-extension-debugging`, after `node harness/load_extension.mjs /abs/path/extension`.
- Prose style: no em dashes, no emojis.
