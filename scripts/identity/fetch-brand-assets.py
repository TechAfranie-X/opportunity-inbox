#!/usr/bin/env python3
"""
Developer tool, run once: fetches each company's OWN published icon (the SVG or apple-touch-icon its homepage declares) into public/brands/.
The product never fetches logos at run time. Nothing about any user is sent: the requests are plain public GETs of company homepages.
A human must LOOK at every file before it is added to lib/identity/brand-assets.ts (a challenge page or a placeholder is not a logo).
Usage: fetch-brand-assets.py <out dir> slug=domain [slug=domain ...]
"""
import re, sys, os, urllib.request, urllib.parse

UA = "Mozilla/5.0 (compatible; opportunity-inbox-dev-asset-fetch/1.0)"
def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read(3_000_000)
        return data if binary else data.decode("utf-8", "ignore"), r.geturl(), r.headers.get("content-type", "")

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for pair in sys.argv[2:]:
    slug, domain = pair.split("=")
    try:
        html, base, _ = get(f"https://{domain}/")
    except Exception as e:
        print(slug, "homepage failed", type(e).__name__); continue
    links = []
    for tag in re.findall(r"<link\b[^>]*>", html, re.I):
        rel = re.search(r'rel=["\']([^"\']+)', tag, re.I); href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if not rel or not href or "icon" not in rel.group(1).lower(): continue
        size = re.search(r'sizes=["\'](\d+)x', tag, re.I); typ = re.search(r'type=["\']([^"\']+)', tag, re.I)
        links.append((urllib.parse.urljoin(base, href.group(1)), int(size.group(1)) if size else 0, (typ.group(1) if typ else ""), rel.group(1).lower()))
    links.append((urllib.parse.urljoin(base, "/favicon.ico"), 16, "", "fallback"))
    # prefer: svg > apple-touch-icon (largest) > largest png > ico
    def rank(l):
        u, s, t, r = l
        return (0 if u.split("?")[0].endswith(".svg") or "svg" in t else 1 if "apple" in r else 2 if u.split("?")[0].endswith(".png") else 3, -s)
    for u, s, t, r in sorted(links, key=rank):
        try:
            data, final, ctype = get(u, binary=True)
        except Exception:
            continue
        ext = "svg" if (b"<svg" in data[:600] or "svg" in ctype) else "png" if data[:4] == b"\x89PNG" else "ico" if data[:4] in (b"\x00\x00\x01\x00",) else None
        if not ext or len(data) < 120: continue
        open(os.path.join(out, f"{slug}.{ext}"), "wb").write(data)
        print(slug, "->", f"{slug}.{ext}", len(data), "bytes from", urllib.parse.urlparse(final).netloc, r, s); break
    else:
        print(slug, "no icon found")
