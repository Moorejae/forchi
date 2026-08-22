# Dry-run the v2 weekly render (per-sport messages) + explain-why on the VPS.
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
import sys
from datetime import date
sys.path.insert(0, "/opt/v61")
import telegram_bot as t

hist, ni, lib = t.load_runtime()
msgs = t.render_weekly_messages(date.today(), hist, ni, lib)
print("MESSAGE_COUNT:", len(msgs), flush=True)
for i, m in enumerate(msgs):
    print("=== MSG %d (first 500 chars) ===" % i, flush=True)
    print(m[:500], flush=True)

print("=== EXPLAIN (sample) ===", flush=True)
picks = t.scan_football_day(date.today(), hist, ni, lib)
if picks:
    r = picks[0]["fixture"].get("reason")
    print("REASON:", r, flush=True)
else:
    print("no picks today", flush=True)

print("=== SUMMARY ===", flush=True)
print(t.today_picks_summary(hist, ni, lib)[:400], flush=True)
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
    with sftp.open("/tmp/v61v2.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command(
        "cd /opt/v61 && timeout 240 /opt/v61/.venv/bin/python -u /tmp/v61v2.py",
        timeout=260)
    o.channel.settimeout(240)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:1000])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
