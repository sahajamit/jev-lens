// Jev Lens content script. Watches the feed, batches posts to the worker (which calls Jev), draws badges.
// Reads the page and styles it. Never clicks, likes, hides, follows or posts.
(function () {
  const A = window.JevLensAdapter;
  if (!A || window.__jevLensLoaded) return;
  window.__jevLensLoaded = true;

  const PRE_ZONE = "800px 0px 800px 0px"; // judge posts well before they reach the viewport
  const BATCH = 8;
  const state = { settings: null, queue: [], timer: null, inflight: 0, seen: new Map(), counts: { read: 0, maybe: 0, skip: 0, judged: 0 } };

  chrome.storage.local.get(["settings"], (r) => {
    state.settings = r.settings || {};
    if (!state.settings.enabled?.[A.site]) return; // per-site toggle, default set by popup on first run
    boot();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) state.settings = changes.settings.newValue;
    if (changes.settings && changes.settings.newValue?.mode !== changes.settings.oldValue?.mode) applyModeClass();
  });

  let io = null, ioRoot = undefined;
  // The feed may scroll inside an element (LinkedIn's <main>) rather than the window; the observer must use that
  // as its root or the pre-zone is measured against the wrong box and posts below the fold never get judged.
  function scrollRootOf(el) {
    for (let e = el && el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 20) return e;
    }
    return null;
  }
  function ensureObserver(sample) {
    const root = scrollRootOf(sample);
    if (io && root === ioRoot) return io;
    if (io) io.disconnect();
    ioRoot = root;
    io = new IntersectionObserver(onIntersect, { root, rootMargin: PRE_ZONE, threshold: 0 });
    A.posts().forEach((el) => { if (!el.dataset.jevVerdict) io.observe(el); });
    return io;
  }

  function boot() {
    document.documentElement.classList.add("jev-site-" + A.site); // lets styles.css place the badge per site
    applyModeClass();
    const scan = () => {
      const posts = A.posts();
      if (!posts.length) return;
      const obs = ensureObserver(posts[0]);
      posts.forEach((el) => { if (!el.dataset.jevSeen) { el.dataset.jevSeen = "1"; obs.observe(el); } });
    };
    scan();
    // Observe body, not the feed root: SPAs (LinkedIn) replace <main> after load, which would strand a narrower observer.
    new MutationObserver(debounce(scan, 150)).observe(document.body, { childList: true, subtree: true });
    counter();
  }

  function applyModeClass() {
    document.documentElement.classList.toggle("jev-collapse", state.settings?.mode === "collapse");
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      if (el.dataset.jevVerdict) continue;
      const post = A.extract(el);
      if (!post.id || (!post.text && !post.quoted_text)) continue;
      if (post.is_ad) { render(el, { verdict: "skip", why: "ad / promoted", answers: null }, post); continue; }
      if (state.seen.has(post.id)) { render(el, state.seen.get(post.id), post); continue; }
      el.dataset.jevVerdict = "pending";
      renderPending(el);
      state.queue.push({ el, post });
      schedule();
    }
  }

  function schedule() {
    if (state.queue.length >= BATCH) return flush();
    clearTimeout(state.timer);
    state.timer = setTimeout(flush, 120);
  }

  function flush() {
    clearTimeout(state.timer);
    while (state.queue.length) {
      const batch = state.queue.splice(0, BATCH);
      state.inflight++;
      chrome.runtime.sendMessage({ type: "judge", posts: batch.map((b) => b.post) }, (res) => {
        state.inflight--;
        if (!res || res.error) {
          batch.forEach((b) => renderError(b.el, (res && res.error) || "no response"));
          return;
        }
        batch.forEach((b, i) => {
          const r = res.results[i];
          state.seen.set(b.post.id, r);
          render(b.el, r, b.post);
        });
        counter();
      });
    }
  }

  // ---- rendering ----
  function badgeHost(el) {
    let host = el.querySelector(":scope > .jev-lens-badge");
    if (!host) {
      host = document.createElement("div");
      host.className = "jev-lens-badge";
      el.prepend(host);
    }
    return host;
  }

  function renderPending(el) {
    el.dataset.jevVerdict = "pending";
    badgeHost(el).innerHTML = '<span class="jev-pill jev-pending">jev…</span>';
  }

  function renderError(el, msg) {
    el.dataset.jevVerdict = "error";
    badgeHost(el).innerHTML = `<span class="jev-pill jev-error" title="${escapeHtml(msg)}">jev: ${escapeHtml(msg.slice(0, 40))}</span>`;
  }

  function render(el, r, post) {
    el.dataset.jevVerdict = r.verdict;
    if (r.answers) el.dataset.jevAnswers = JSON.stringify(r.answers); // debug/eval hook: readable from the page
    el.classList.remove("jev-read", "jev-maybe", "jev-skip");
    el.classList.add("jev-" + r.verdict);
    const p = r.answers ? ` · ${(r.answers.fit * 100).toFixed(0)}%` : "";
    const host = badgeHost(el);
    host.innerHTML =
      `<span class="jev-pill jev-${r.verdict}">${r.verdict.toUpperCase()}${p}</span>` +
      `<span class="jev-why">${escapeHtml(r.why || "")}</span>` +
      (r.answers
        ? `<span class="jev-fb" title="Disagree? Record what you would have done.">` +
          (r.verdict !== "read" ? `<button class="jev-fbtn" data-label="read">read</button>` : "") +
          (r.verdict !== "skip" ? `<button class="jev-fbtn" data-label="skip">skip</button>` : "") +
          `</span>`
        : "");
    host.querySelectorAll(".jev-fbtn").forEach((b) =>
      b.addEventListener("click", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        chrome.runtime.sendMessage({ type: "feedback", entry: { ts: Date.now(), site: post.site, id: post.id, url: post.url, author: post.author, text: post.text.slice(0, 2000), answers: r.answers, verdict: r.verdict, label: b.dataset.label } });
        b.textContent = "noted"; b.disabled = true;
      })
    );
    if (r.answers) { state.counts[r.verdict]++; state.counts.judged++; }
  }

  function counter() {
    let c = document.getElementById("jev-lens-counter");
    if (!c) { c = document.createElement("div"); c.id = "jev-lens-counter"; document.body.appendChild(c); }
    chrome.runtime.sendMessage({ type: "stats" }, (s) => {
      if (!s) return;
      c.textContent = `Jev Lens · ${state.counts.read} read · ${state.counts.maybe} maybe · ${state.counts.skip} skip · $${s.cost.toFixed(4)}`;
    });
  }

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
})();
