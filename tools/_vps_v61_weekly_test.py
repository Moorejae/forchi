# Dry-run the v61 weekly scan: count plays across the next 7 days (no post).
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
weeks = t.weekly_picks(date.today(), hist, ni, lib)
total = 0
print("days_with_picks:", len(weeks), flush=True)
for d, picks in weeks:
    print("  %s: %d plays" % (d, len(picks)), flush=True)
    total += len(picks)
print("TOTAL_PLAYS:", total, flush=True)
print("STATUS:", t.handle_message("/status", None, hist, ni, lib).replace("\n", " | "), flush=True)
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
    with sftp.open("/tmp/v61week.py", "w") as f:
        f.write(DIAG)
    sftp.close()
    i, o, e = c.exec_command(
        "cd /opt/v61 && timeout 150 /opt/v61/.venv/bin/python -u /tmp/v61week.py",
        timeout=170)
    o.channel.settimeout(150)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:800])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
