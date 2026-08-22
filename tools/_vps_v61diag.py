# Diagnose the v61 Telegram 409 conflict: read the v61 token on the VPS and
# probe getUpdates to see exactly what Telegram returns.
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

DIAG = r"""
import json, urllib.request, urllib.error
tok = None
for line in open("/opt/v61/.env", encoding="utf-8"):
    if line.startswith("TELEGRAM_BOT_TOKEN="):
        tok = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
print("token_found", bool(tok))
url = "https://api.telegram.org/bot%s/getUpdates?timeout=1" % tok
try:
    r = urllib.request.urlopen(url, timeout=15)
    d = json.loads(r.read().decode())
    print("OK", json.dumps(d)[:300])
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print("HTTP", e.code, body[:500])
except Exception as ex:
    print("ERR", repr(ex)[:300])
"""


def env(k):
    try:
        with open(os.path.join(BASE, ".env"), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(k + "="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return os.environ.get(k, "").strip()


def main():
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, password=pw, timeout=30)
    sftp = c.open_sftp()
    with sftp.open("/tmp/v61diag.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command("/opt/v61/.venv/bin/python /tmp/v61diag.py", timeout=60)
    o.channel.settimeout(45)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:500])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
