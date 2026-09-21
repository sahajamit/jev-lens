"""Re-score collected posts against a profile/threshold config with the SAME questions the extension asks, and compare
with hand labels. Usage: TYPESAFE_API_KEY=... python harness/eval_profile.py posts.jsonl labels.json config.json
(posts.jsonl from collect_feed.mjs; labels.json = {"<index>": "read"|"maybe"|"skip"}; config.json = profile, kinds, thresholds)"""
import json, os, sys, time, urllib.request

posts = [json.loads(l) for l in open(sys.argv[1])]
labels = json.load(open(sys.argv[2]))          # {index: "read"|"maybe"|"skip"}
cfg = json.load(open(sys.argv[3]))
API = "https://api.typesafe.ai/v1/systemone"; KEY = os.environ["TYPESAFE_API_KEY"]

KINDS = cfg["kinds"]
def questions(batch):
    q = {}
    for i, p in enumerate(batch):
        ref = f"`posts[{i}]`"
        q[f"p{i}_ai"] = {"type": "noul", "instructions": f"{ref} is substantively about AI, machine learning, LLMs, AI agents, AI developer tooling, or AI applied to software testing. Mentioning AI in passing does not count."}
        q[f"p{i}_kind"] = {"type": "choice", "instructions": f"What kind of post is {ref}? Judge by its text.", "criteria": KINDS}
        q[f"p{i}_depth"] = {"type": "score", "instructions": cfg["depth_instructions"].replace("{ref}", ref), "criteria": cfg["depth_levels"]}
        q[f"p{i}_fit"] = {"type": "noul", "instructions": cfg["fit_instructions"].replace("{ref}", ref), "criteria": {"true": "Posts the reader wants to read: " + cfg["profile"], "false": "Posts the reader wants to skip: " + cfg["antiProfile"]}}
    return q

def verdict(a, t):
    if a["kind"] in t["hard_skip_kinds"] or a["ai"] < t["skipAi"] or a["fit"] < t["skipFit"]: return "skip"
    if a["kind"] == "self_promo_or_job" and a["fit"] < t.get("promoNeedsFit", 1.0): return "skip"
    if a["fit"] >= t["readFit"] and a["depth"] >= t["readDepth"] and a["kind"] not in t.get("no_read_kinds", []): return "read"
    if a["fit"] >= t.get("strongFit", 1.1): return "read"   # very high fit overrides depth (truncated text)
    return "maybe"

results = []; tokens = 0
BS = int(os.environ.get("BATCH", 8))
for s in range(0, len(posts), BS):
    batch = posts[s:s+BS]
    body = {"model": "jev-latest", "state": {"posts": [{"i": i, "site": p["site"], "author": p["author"], "text": p["text"][:3000], "has_media": False, "is_repost": False} for i, p in enumerate(batch)]}, "questions": questions(batch)}
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    data = json.load(urllib.request.urlopen(req, timeout=60)); tokens += data["usage"]["input_tokens"]
    for i, p in enumerate(batch):
        an = data["answers"]; a = {"ai": an[f"p{i}_ai"]["noul"], "kind": an[f"p{i}_kind"]["choice"], "depth": an[f"p{i}_depth"]["score"], "fit": an[f"p{i}_fit"]["noul"]}
        results.append({"idx": s + i, "author": p["author"], "text": p["text"][:70].replace("\n", " "), "answers": a, "verdict": verdict(a, cfg["thresholds"]), "label": labels.get(str(s + i))})

from collections import Counter
lab_read = [r for r in results if r["label"] == "read"]; jev_read = [r for r in results if r["verdict"] == "read"]
tp = [r for r in jev_read if r["label"] == "read"]
exact = sum(1 for r in results if r["label"] == r["verdict"])
print(f"config: {cfg['name']} | tokens {tokens} (${tokens*0.042/1e6:.4f})")
print(f"exact agreement {exact}/{len(results)} = {exact/len(results):.0%} | READ precision {len(tp)}/{len(jev_read)} | READ recall {len(tp)}/{len(lab_read)}")
print("MISSED (label read, jev not read):"); [print(f"  [{r['idx']:02d}] jev={r['verdict']:5} fit={r['answers']['fit']:.2f} depth={r['answers']['depth']:.1f} kind={r['answers']['kind']:22} {r['author'][:20]} | {r['text']}") for r in lab_read if r["verdict"] != "read"]
print("FALSE READ (jev read, label not read):"); [print(f"  [{r['idx']:02d}] label={r['label']:5} fit={r['answers']['fit']:.2f} depth={r['answers']['depth']:.1f} kind={r['answers']['kind']:22} {r['author'][:20]} | {r['text']}") for r in jev_read if r["label"] != "read"]
print("label maybe -> jev skip:", [r["idx"] for r in results if r["label"] == "maybe" and r["verdict"] == "skip"], "| label skip -> jev maybe:", [r["idx"] for r in results if r["label"] == "skip" and r["verdict"] == "maybe"])
json.dump(results, open(f"artifacts/eval-{cfg['name']}.json", "w"), indent=1)
