import sys
import json
import requests

def call_telegram():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Missing token or method"}))
        return

    token = sys.argv[1]
    method = sys.argv[2]
    payload = json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else {}

    url = f"https://api.telegram.org/bot{token}/{method}"
    headers = {"User-Agent": "ForChiBot/1.0"}
    
    try:
        if payload:
            res = requests.post(url, json=payload, headers=headers, timeout=15)
        else:
            res = requests.get(url, headers=headers, timeout=15)
        print(res.text)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    call_telegram()
