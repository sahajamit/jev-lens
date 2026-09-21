// Jev Lens service worker: holds the API key, talks to Jev, turns answers into verdicts, keeps stats and feedback.
const API = "https://api.typesafe.ai/v1/systemone";
const PRICE_PER_MTOK = 0.042;

const DEFAULTS = {
  apiKey: "",
  model: "jev-latest",
  mode: "dim", // dim | collapse
  enabled: { x: true, linkedin: true },
  thresholds: { readFit: 0.65, readDepth: 1.0, skipFit: 0.3, skipAi: 0.4, promoNeedsFit: 0.6, strongFit: 0.8 },
  profileVersion: 3,
  persona: "a hands-on software engineer who builds and tests AI agents",
  profile:
    "Agentic engineering: how people actually build and run AI agents (harnesses, tool design, Claude Code, Codex, OpenCode, MCP, skills, AGENTS.md), with first-hand detail. Anything hands-on about Jev, TypeSafe, System One models or RLCD: benchmarks, cost numbers, things people built with it. Evals, verification and calibration of models; RL post-training (RLHF, RLVR, RLCD, SFT, DPO, GRPO) explained hands-on, including repos you can run. Spec-driven development with coding agents (specs, acceptance tests, EARS, requirements to code). Browser agents and AI-driven test automation, QA with agents, mobile automation without scripts, flaky-test triage, LLM-as-judge with numbers. Harness design guides. Developer tooling launches with concrete capabilities and real benchmarks. Build logs: someone tried a thing, reports what worked, what broke, cost and latency. Research results explained by the people who did them. An author linking to their own article, video or tool about these topics still counts as READ when the post says concretely what is in it. Examples of READ: 'I spent 11 cents processing 3.1 million tokens with Jev, here is what I learned'; 'Claude Code Skills explained by building them into a real test automation project, video inside'; 'AGENTS.md support lands in Claude Code 2.1, here is how the loading order works'.",
  antiProfile:
    "Generic AI news reposts with no added insight; motivational or career-advice posts; listicles ('10 tools you must know', " +
    "'bookmark this thread'); AI-generated hype with no specifics; certificates, badges and course completions; crypto, " +
    "trading, politics; product ads and funnels; LinkedIn-voice storytelling with a lesson at the end and no technical " +
    "content; engagement bait ('agree?', 'thoughts?'); job posts and hiring announcements. Examples of SKIP: " +
    "'I just became a Claude Certified Architect'; 'This is the cheapest AI provider, every model discounted'.",
};

const cache = new Map(); // post id -> result
let stats = { requests: 0, posts: 0, input_tokens: 0, cost: 0, read: 0, maybe: 0, skip: 0, errors: 0 };

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULTS, ...(settings || {}) };
  if ((settings?.profileVersion || 1) < DEFAULTS.profileVersion) {
    // Profile upgrade shipped with a new version. Keeps the key and toggles; replaces persona, profile, anti-profile, thresholds.
    Object.assign(s, { persona: DEFAULTS.persona, profile: DEFAULTS.profile, antiProfile: DEFAULTS.antiProfile, thresholds: DEFAULTS.thresholds, profileVersion: DEFAULTS.profileVersion });
  }
  await chrome.storage.local.set({ settings: s });
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "defaults") { sendResponse({ persona: DEFAULTS.persona, profile: DEFAULTS.profile, antiProfile: DEFAULTS.antiProfile, thresholds: DEFAULTS.thresholds }); return; }
  if (msg.type === "judge") { judge(msg.posts).then(sendResponse).catch((e) => sendResponse({ error: String(e.message || e) })); return true; }
  if (msg.type === "stats") { sendResponse(stats); return; }
  if (msg.type === "feedback") { appendFeedback(msg.entry).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === "resetStats") { stats = { requests: 0, posts: 0, input_tokens: 0, cost: 0, read: 0, maybe: 0, skip: 0, errors: 0 }; sendResponse(stats); return; }
  if (msg.type === "test") { testKey(msg.apiKey).then(sendResponse); return true; }
});

async function settings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}), thresholds: { ...DEFAULTS.thresholds, ...(settings?.thresholds || {}) }, enabled: { ...DEFAULTS.enabled, ...(settings?.enabled || {}) } };
}

function questionsFor(posts, s) {
  const q = {};
  posts.forEach((p, i) => {
    const ref = `\`posts[${i}]\``;
    q[`p${i}_ai`] = {
      type: "noul",
      instructions: `${ref} is substantively about AI, machine learning, LLMs, AI agents, AI developer tooling, or AI applied to software testing. Mentioning AI in passing does not count.`,
    };
    q[`p${i}_kind`] = {
      type: "choice",
      instructions: `What kind of post is ${ref}? Judge by its text (and quoted_text if present).`,
      criteria: {
        research_or_release: "A research result, model or product release, explained with specifics",
        practitioner_insight: "First-hand experience building, testing, benchmarking or operating something, with concrete details, including when the author links to their own write-up or video about it",
        tool_launch: "Announces a tool, library, feature or integration and says what it does",
        tutorial: "Explains how to do something step by step",
        opinion_hot_take: "An argument or opinion about the field, with or without evidence",
        news_repost: "Relays news or someone else's content with little or no added insight",
        listicle_or_bait: "List of tools/tips, thread bait, 'bookmark this', engagement questions, hype with no specifics",
        self_promo_or_job: "Certificates, badges, new-job announcements, hiring, 'open to work', event or course sales pitches, with no technical content. NOT this: an author sharing their own technical article, video, benchmark, experiment or tool with a concrete description of what is in it, which is practitioner_insight or tutorial",
        not_ai: "Not about AI at all",
      },
    };
    q[`p${i}_depth`] = {
      type: "score",
      instructions: `How much concrete, actionable technical substance does ${ref} contain?`,
      criteria: [
        "Slogan, vibe or announcement with no specifics",
        "One concrete claim or fact, no evidence or mechanism",
        "Specific mechanism, numbers, code or first-hand observations",
        "Novel technical insight with evidence the reader could act on",
      ],
    };
    q[`p${i}_fit`] = {
      type: "noul",
      instructions: `The reader, ${s.persona}, would stop scrolling to read ${ref}. Judge the post against the criteria.`,
      criteria: { true: "Posts the reader wants to read: " + s.profile, false: "Posts the reader wants to skip: " + s.antiProfile },
    };
  });
  return q;
}

function verdictFor(a, t) {
  const ai = a.ai, fit = a.fit, depth = a.depth, kind = a.kind;
  if (kind === "listicle_or_bait" || ai < t.skipAi || fit < t.skipFit) return "skip";
  if (kind === "self_promo_or_job" && fit < (t.promoNeedsFit ?? 0.6)) return "skip"; // promo survives only when it clearly fits
  if (fit >= t.readFit && depth >= t.readDepth && kind !== "news_repost") return "read";
  if (fit >= (t.strongFit ?? 0.8)) return "read"; // very high fit wins even when truncated text kept depth low
  return "maybe";
}

async function judge(posts) {
  const s = await settings();
  if (!s.apiKey) throw new Error("no API key: open the Jev Lens popup");
  const todo = posts.filter((p) => !cache.has(p.id));
  if (todo.length) {
    const body = {
      model: s.model,
      state: { posts: todo.map((p, i) => ({ i, site: p.site, author: p.author, text: p.text.slice(0, 3000), quoted_text: p.quoted_text.slice(0, 1000), has_media: p.has_media, is_repost: p.is_repost })) },
      questions: questionsFor(todo, s),
    };
    const t0 = Date.now();
    const res = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${s.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { stats.errors++; throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`); }
    const data = await res.json();
    const ms = Date.now() - t0;
    stats.requests++; stats.posts += todo.length; stats.input_tokens += data.usage?.input_tokens || 0; stats.cost = (stats.input_tokens / 1e6) * PRICE_PER_MTOK;
    todo.forEach((p, i) => {
      const an = data.answers;
      const a = { ai: an[`p${i}_ai`].noul, kind: an[`p${i}_kind`].choice, kind_conf: an[`p${i}_kind`].confidence, depth: an[`p${i}_depth`].score, depth_conf: an[`p${i}_depth`].confidence, fit: an[`p${i}_fit`].noul };
      const verdict = verdictFor(a, s.thresholds);
      stats[verdict]++;
      cache.set(p.id, { verdict, answers: a, why: `${a.kind.replace(/_/g, " ")} · depth ${a.depth.toFixed(1)}/3 · ai ${(a.ai * 100).toFixed(0)}% · ${ms} ms/${todo.length}`, model: data.model });
    });
  }
  return { results: posts.map((p) => cache.get(p.id)) };
}

async function appendFeedback(entry) {
  const { feedback } = await chrome.storage.local.get("feedback");
  const list = feedback || [];
  list.push(entry);
  await chrome.storage.local.set({ feedback: list.slice(-2000) });
}

async function testKey(apiKey) {
  try {
    const res = await fetch("https://api.typesafe.ai/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const d = await res.json();
    return { ok: true, models: (d.models || []).map((m) => m.name) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
