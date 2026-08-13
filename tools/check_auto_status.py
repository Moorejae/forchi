import requests, time

for i in range(30):
    try:
        r = requests.get("https://forchi.onrender.com/status", timeout=30)
        j = r.json() if r.status_code == 200 else {}
        if "autoMode" in j:
            print(f"[{i*15}s] autoMode={j.get('autoMode')} utc={j.get('utc')}")
            break
        print(f"[{i*15}s] status={r.status_code} (deploying?)")
    except Exception as e:
        print(f"[{i*15}s] ERR {str(e)[:70]}")
    time.sleep(15)
