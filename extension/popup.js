// Jev Lens popup: settings in chrome.storage.local, stats from the worker, feedback export.
const $ = (id) => document.getElementById(id);
const sliders = ["readFit", "readDepth", "skipFit", "skipAi"];

async function load() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  $("apiKey").value = s.apiKey || "";
  $("persona").value = s.persona || "";
  $("profile").value = s.profile || "";
  $("antiProfile").value = s.antiProfile || "";
  const t = s.thresholds || {};
  sliders.forEach((k) => { $(k).value = t[k]; $(k + "V").textContent = Number(t[k]).toFixed(2); });
  $("enX").checked = !!(s.enabled?.x ?? true);
  $("enLi").checked = !!(s.enabled?.linkedin ?? true);
  ($("mode" + ((s.mode || "dim") === "collapse" ? "Collapse" : "Dim"))).checked = true;
  chrome.runtime.sendMessage({ type: "stats" }, (st) => {
    if (!st) return;
    $("sPosts").textContent = st.posts; $("sRead").textContent = st.read; $("sReq").textContent = st.requests; $("sCost").textContent = "$" + st.cost.toFixed(4);
  });
}

async function save() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = { ...(settings || {}) };
  s.apiKey = $("apiKey").value.trim();
  s.persona = $("persona").value.trim() || "a hands-on software engineer who builds and tests AI agents";
  s.profile = $("profile").value.trim();
  s.antiProfile = $("antiProfile").value.trim();
  s.thresholds = { ...(s.thresholds || {}), ...Object.fromEntries(sliders.map((k) => [k, Number($(k).value)])) };
  s.enabled = { x: $("enX").checked, linkedin: $("enLi").checked };
  s.mode = $("modeCollapse").checked ? "collapse" : "dim";
  await chrome.storage.local.set({ settings: s });
  $("saveMsg").textContent = "saved · reload the feed tab";
  setTimeout(() => ($("saveMsg").textContent = ""), 2500);
}

sliders.forEach((k) => $(k).addEventListener("input", () => ($(k + "V").textContent = Number($(k).value).toFixed(2))));
$("save").addEventListener("click", save);
$("restore").addEventListener("click", () => chrome.runtime.sendMessage({ type: "defaults" }, (d) => {
  $("persona").value = d.persona; $("profile").value = d.profile; $("antiProfile").value = d.antiProfile;
  sliders.forEach((k) => { $(k).value = d.thresholds[k]; $(k + "V").textContent = Number(d.thresholds[k]).toFixed(2); });
  $("saveMsg").textContent = "defaults restored, click Save";
}));
$("test").addEventListener("click", () => {
  $("keyMsg").className = "msg"; $("keyMsg").textContent = "testing…";
  chrome.runtime.sendMessage({ type: "test", apiKey: $("apiKey").value.trim() }, (r) => {
    $("keyMsg").className = "msg" + (r?.ok ? "" : " bad");
    $("keyMsg").textContent = r?.ok ? "key ok · models: " + r.models.join(", ") : "key failed: " + (r?.error || "unknown");
  });
});
$("export").addEventListener("click", async () => {
  const { feedback } = await chrome.storage.local.get("feedback");
  const blob = new Blob([JSON.stringify(feedback || [], null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `jev-lens-feedback-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  $("saveMsg").textContent = `${(feedback || []).length} feedback entries exported`;
});
load();
