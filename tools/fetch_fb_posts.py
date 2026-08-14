# Fetch the page's recent posts via the Graph API to analyze the writing style.
import os, requests, json

def get_env():
    env = {}
    for line in open(r"c:\Users\hp\forchi\.env", encoding="utf-8"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env

env = get_env()
page_id = env.get("FACEBOOK_PAGE_ID", "104975031401620")
token = env.get("FACEBOOK_PAGE_ACCESS_TOKEN") or env.get("FACEBOOK_PAGE_TOKEN")
print("page_id:", page_id, "| token present:", bool(token))

url = f"https://graph.facebook.com/v19.0/{page_id}/posts"
params = {"fields": "message,created_time,permalink_url", "limit": 25, "access_token": token}
r = requests.get(url, params=params, timeout=30)
data = r.json()
if "error" in data:
    print("API ERROR:", json.dumps(data["error"], indent=2))
    raise SystemExit(1)

posts = data.get("data", [])
print(f"\n=== {len(posts)} posts ===\n")
for i, p in enumerate(posts):
    msg = (p.get("message") or "").strip()
    if not msg:
        continue
    print(f"--- POST {i+1} | {p.get('created_time','')} ---")
    print(msg)
    print()
