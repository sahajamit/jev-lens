// Jev Lens adapter: linkedin.com feed (2026 markup). Posts are role=listitem cards inside [data-testid=mainFeed].
// LinkedIn hashes its class names, so we lean on stable attributes: componentkey, role, aria-labels.
(function () {
  const site = "linkedin";

  function root() {
    return document.querySelector('[data-testid="mainFeed"]') || document.querySelector("main") || document.body;
  }

  function posts() {
    return [...document.querySelectorAll('[data-testid="mainFeed"] div[role="listitem"][componentkey^="update-card-focus"]')];
  }

  function extract(el) {
    const key = (el.getAttribute("componentkey") || "").replace(/^update-card-focus/, "");
    const menu = el.querySelector('button[aria-label^="Open control menu for post by"]');
    const author = menu ? menu.getAttribute("aria-label").replace(/^Open control menu for post by\s*/, "").trim() : "";
    const head = el.innerText.slice(0, 400);
    // The commentary is the longest paragraph that is not the reactions line or the actor headline.
    const paras = [...el.querySelectorAll("p")]
      .map((p) => p.innerText.trim())
      .filter((t) => t.length > 20 && !/\b(reacted|others|comments?|reposts?)\s*$/i.test(t) && !/^\d[\d,]* (comments|reposts)/i.test(t));
    paras.sort((a, b) => b.length - a.length);
    return {
      id: key ? `li:${key}` : null,
      site,
      author,
      text: paras[0] || "",
      quoted_text: "",
      has_media: el.querySelectorAll("img").length > 2 || !!el.querySelector("video"),
      is_repost: /\b(reposted|likes this|loves this|celebrates this|commented on this)\b/i.test(head),
      is_ad: /\bPromoted\b/.test(head),
      url: "",
    };
  }

  window.JevLensAdapter = { site, root, posts, extract };
})();
