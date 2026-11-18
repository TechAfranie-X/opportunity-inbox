#!/usr/bin/env python3
"""
Developer tool, run once: builds the bundled company-logo pack from PUBLIC data, selected by POPULARITY (Wikipedia sitelink count), never by anyone's
mailbox. Nothing about any user is sent anywhere.
  1. Wikidata slices (JSON files from query.wikidata.org: entities with official website P856, logo P154 and >= 5 sitelinks), in <wd dir>
  2. the top N by sitelinks (deduplicated by normalized name)
  3. Wikimedia Commons licence check per file (extmetadata): only public-domain / CC0 / copyright-ineligible files are kept (no attribution burden)
  4. a 96 px PNG thumbnail per kept file from Commons (Special:FilePath?width=96)
Output: public/brands/wd/<id>.png and lib/identity/wd-logos.generated.ts ({ key: file }). Skipped files and the reason are printed.
Usage: build-logo-pack.py <wd dir> <N>
"""
import glob, json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "oi-brand-pack/1.0 (local developer tool; public Commons assets)"
wd, N = sys.argv[1], int(sys.argv[2])
root = os.path.join(os.path.dirname(__file__), "../..")
out = os.path.join(root, "public/brands/wd"); os.makedirs(out, exist_ok=True)

SUF = re.compile(r"\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|holdings?|group|technologies|technology|the)\b\.?", re.I)
def flat(s): return re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "and"))
def core(s): return flat(SUF.sub(" ", s)) or flat(s)

ents = {}
for f in glob.glob(os.path.join(wd, "*.json")):
    for b in json.load(open(f))["results"]["bindings"]:
        name = b["cLabel"]["value"]
        if re.match(r"^Q\d+$", name) or "logo" not in b: continue
        k = core(name); sl = int(b["sl"]["value"])
        if k and (k not in ents or sl > ents[k]["sl"]):
            ents[k] = {"name": name, "sl": sl, "file": urllib.parse.unquote(b["logo"]["value"].rsplit("/", 1)[-1])}
top = sorted(ents.items(), key=lambda kv: -kv[1]["sl"])[:N]
print(len(ents), "candidates;", len(top), "selected by sitelinks (min", top[-1][1]["sl"], ")")

def get(url, binary=True, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                d = r.read(2_000_000); return d if binary else d.decode()
        except Exception:
            time.sleep(1 + i)
    return None

# licence check, 50 titles per call
OK = re.compile(r"public domain|^pd\b|pd-|cc0|copyright[- ]?ineligible|no copyright|ineligible for copyright|textlogo|simple", re.I)
lic = {}
files = [v["file"] for _, v in top]
for i in range(0, len(files), 50):
    chunk = files[i:i + 50]
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "extmetadata", "iiextmetadatafilter": "LicenseShortName|License|NonFree|Restrictions", "titles": "|".join("File:" + f for f in chunk)})
    d = get(url, binary=False)
    if not d: continue
    for p in json.loads(d).get("query", {}).get("pages", {}).values():
        em = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
        lic[p.get("title", "")[5:].replace("_", " ")] = (em.get("LicenseShortName", {}).get("value", "") + " " + em.get("License", {}).get("value", "")).strip()
    time.sleep(0.3)
print("licences checked:", len(lic), flush=True)
kept = {}; skipped = {}
def work(item):
    k, v = item
    l = lic.get(v["file"].replace("_", " "), "")
    if not OK.search(l): return k, None, f"licence: {l or 'unknown'}"
    name = k[:40]
    for ext in ("svg", "png"):
        if os.path.exists(os.path.join(out, name + "." + ext)): return k, name + "." + ext, ""
    base = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(v["file"])
    if v["file"].lower().endswith(".svg"):
        data = get(base)  # the vector original: crisp at any size, usually a few KB
        if data and b"<svg" in data[:2000] and len(data) <= 40_000 and b"<script" not in data.lower():
            open(os.path.join(out, name + ".svg"), "wb").write(data)
            return k, name + ".svg", ""
    data = get(base + "?width=96")
    if not data or data[:4] != b"\x89PNG": return k, None, "no thumbnail"
    if len(data) > 30_000: return k, None, "too large"
    open(os.path.join(out, name + ".png"), "wb").write(data)
    return k, name + ".png", ""
def aliases(k, v):
    # "Stanford University" is also "Stanford"; "MIT" style names keep their own key
    base = re.sub(r"(university|college|instituteoftechnology)$", "", k)
    return {k, base} if len(base) >= 4 else {k}
with ThreadPoolExecutor(3) as ex:
    for i, (k, f, why) in enumerate(ex.map(work, top)):
        if i % 100 == 0: print("progress", i, "kept", len(kept), flush=True)
        if f:
            for a in aliases(k, None): kept.setdefault(a, f)
        else: skipped[why.split(":")[0] if why.startswith("licence") else why] = skipped.get(why.split(":")[0] if why.startswith("licence") else why, 0) + 1
print("kept", len(kept), "skipped", skipped)
size = sum(os.path.getsize(os.path.join(out, f)) for f in kept.values())
print("pack size", size // 1024, "KB")
open(os.path.join(root, "lib/identity/wd-logos.generated.ts"), "w").write("/* GENERATED by scripts/identity/build-logo-pack.py from public Wikidata + Wikimedia Commons (public-domain / CC0 files only). key -> file in public/brands/wd. Do not edit. */\nexport const WD_LOGOS: Record<string, string> = " + json.dumps(kept, separators=(",", ":")) + ";\n")
