// Jev Lens adapter: x.com. Finds tweets in the timeline and extracts what Jev needs.
// Contract (same for every adapter): window.JevLensAdapter = { site, root(), posts(), extract(el) }
(function () {
  const site = "x";

  function root() {
    return document.querySelector('main[role="main"]') || document.body;
  }

  // Every rendered tweet in the DOM. Quote-tweets nest an article inside an article; keep only the outer one.
  function posts() {
    return [...document.querySelectorAll('article[data-testid="tweet"]')].filter(
      (a) => !a.parentElement.closest('article[data-testid="tweet"]')
    );
  }

  function extract(el) {
    const statusLink = [...el.querySelectorAll('a[href*="/status/"]')].find((a) => a.querySelector("time")) ||
      el.querySelector('a[href*="/status/"]');
    const m = statusLink && statusLink.getAttribute("href").match(/\/status\/(\d+)/);
    const id = m ? m[1] : null;
    const texts = [...el.querySelectorAll('[data-testid="tweetText"]')].map((t) => t.innerText.trim());
    const user = el.querySelector('[data-testid="User-Name"]');
    const author = user ? user.innerText.split("\n")[0].trim() : "";
    const social = el.querySelector('[data-testid="socialContext"]');
    const isAd = !!el.closest('[data-testid="placementTracking"]');
    return {
      id: id ? `x:${id}` : null,
      site,
      author,
      text: texts[0] || "",
      quoted_text: texts[1] || "",
      has_media: !!el.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="card.wrapper"]'),
      is_repost: !!(social && /reposted/i.test(social.innerText)),
      is_ad: isAd,
      url: id && statusLink ? "https://x.com" + statusLink.getAttribute("href").replace(/\/analytics.*$/, "") : "",
    };
  }

  window.JevLensAdapter = { site, root, posts, extract };
})();
