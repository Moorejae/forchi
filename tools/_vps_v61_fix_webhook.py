# Delete the stale webhook on the v61 bot token (set by the old Render service)
# so the VPS bot can use getUpdates, then run --send-test to confirm delivery.
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
# 1) delete the webhook so getUpdates is allowed again
u = "https://api.telegram.org/bot%s/deleteWebhook" % tok
r = urllib.request.urlopen(u, timeout=15)
print("deleteWebhook:", json.loads(r.read().decode()))
# 2) confirm getUpdates now works
u2 = "https://api.telegram.org/bot%s/getUpdates?timeout=1" % tok
r2 = urllib.request.urlopen(u2, timeout=15)
d2 = json.loads(r2.read().decode())
print("getUpdates ok:", d2.get("ok"))
if d2.get("result"):
    for upd in d2["result"][:3]:
        m = upd.get("message") or {}
        print("  chat", m.get("chat", {}).get("id"), m.get("chat", {}).get("type"))
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
    with sftp.open("/tmp/v61fix.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command("/opt/v61/.venv/bin/python /tmp/v61fix.py", timeout=60)
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
