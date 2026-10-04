#!/usr/bin/env python3
"""Tell IndexNow search engines (Bing, Yandex, …) about every URL in public/sitemap.xml."""
import json, pathlib, re, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOST = "askgifty.com"
key = next(p.stem for p in (ROOT / "public").glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem))
urls = re.findall(r"<loc>(.*?)</loc>", (ROOT / "public" / "sitemap.xml").read_text())
body = json.dumps({"host": HOST, "key": key, "keyLocation": f"https://{HOST}/{key}.txt", "urlList": urls}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                             headers={"Content-Type": "application/json; charset=utf-8"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("IndexNow", r.status, f"({len(urls)} urls)")
except urllib.error.HTTPError as e:
    print("IndexNow", e.code, e.read()[:200])
