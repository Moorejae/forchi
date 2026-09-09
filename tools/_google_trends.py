"""tools/_google_trends.py — dependency-free Google Trends "Daily Search Trends"
sparks for the Python side of the pipeline (Shorts). Mirrors src/llm/googleTrends.js.

Endpoint: https://trends.google.com/trending/rss?geo=XX (public RSS, no key).
BEST EFFORT ONLY: any failure returns [] so the Shorts pipeline never breaks on
Google being unreachable. Cached ~3h in temp_media/google_trends_sparks.json.

Usage:
    python tools/_google_trends.py            # print fresh sparks
    from _google_trends import fetch_trend_sparks
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from _paths import BASE
except Exception:
    BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

RSS_URL = "https://trends.google.com/trending/rss"
CACHE_PATH = os.path.join(BASE, "temp_media", "google_trends_sparks.json")
CACHE_TTL = 3 * 60 * 60  # 3h
GEO_DEFAULT = ("US", "NG", "GB")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"


def _read_cache():
    try:
        with open(CACHE_PATH, encoding="utf-8") as f:
            c = json.load(f)
        if c and isinstance(c.get("terms"), list) and time.time() - c.get("at", 0) < CACHE_TTL:
            return c["terms"]
    except Exception:
        pass
    return None


def _write_cache(terms):
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump({"at": time.time(), "terms": terms}, f, ensure_ascii=False)
    except Exception:
        pass


def _clean(term):
    term = re.sub(r"<!\[CDATA\[|\]\]>", "", term or "")
    term = (term.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&apos;", "'"))
    term = re.sub(r"\s+", " ", term).strip()
    if not term or term.lower() == "daily search trends":
        return None
    letters = len(re.sub(r"[^A-Za-z\u00C0-\u00FF]", "", term)) or 1
    non_ascii = len(re.sub(r"[\x00-\x7f]", "", term))
    if non_ascii / letters > 0.25:
        return None
    return term


def _fetch_geo(geo):
    url = "%s?geo=%s" % (RSS_URL, urllib.parse.quote(geo))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, text/xml, */*"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read().decode("utf-8", "replace")
        root = ET.fromstring(data)
        terms = []
        for item in root.iter("item"):
            title = item.findtext("title")
            c = _clean(title)
            if c:
                terms.append(c)
        return terms[:25]
    except Exception as e:
        print("[googleTrends] geo=%s failed: %s" % (geo, str(e)[:80]), file=sys.stderr)
        return []


def fetch_trend_sparks(geos=GEO_DEFAULT, max_per_geo=15, max_total=35, force=False):
    """Return today's trending search terms across the given geos (best-effort)."""
    if not force:
        cached = _read_cache()
        if cached:
            return cached[:max_total]
    seen, out = set(), []
    for geo in geos:
        for term in _fetch_geo(geo):
            key = term.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(term)
            if len(out) >= max_per_geo:
                break
        if len(out) >= max_total:
            break
    if out:
        _write_cache(out)
    return out


if __name__ == "__main__":
    sparks = fetch_trend_sparks(force=True)
    print("sparks (%d):" % len(sparks))
    for s in sparks:
        print("-", s)
