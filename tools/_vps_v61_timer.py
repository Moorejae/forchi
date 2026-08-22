# Install the v61 daily-picks systemd timer on the VPS (mirrors run_daily.ps1:
# post today's picks, then record yesterday's outcomes). Runs 06:30 UTC = 07:30 Nigeria.
import os
import sys

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

RUN_DAILY = """#!/bin/bash
cd /opt/v61
YESTERDAY=$(date -u -d "yesterday" +%F)
/opt/v61/.venv/bin/python telegram_bot.py --post >> /opt/v61/data/bot_daily.log 2>&1
/opt/v61/.venv/bin/python telegram_bot.py --record "$YESTERDAY" >> /opt/v61/data/bot_daily.log 2>&1
"""

SERVICE = """[Unit]
Description=V61 daily picks post
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/v61/run_daily.sh
"""

TIMER = """[Unit]
Description=Run v61 daily picks post

[Timer]
OnCalendar=*-*-* 06:30:00
Persistent=true

[Install]
WantedBy=timers.target
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
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)
    sftp = client.open_sftp()
    with sftp.open("/opt/v61/run_daily.sh", "w") as f:
        f.write(RUN_DAILY)
    with sftp.open("/etc/systemd/system/v61-post.service", "w") as f:
        f.write(SERVICE)
    with sftp.open("/etc/systemd/system/v61-post.timer", "w") as f:
        f.write(TIMER)
    sftp.close()
    print("units + run_daily.sh written")

    remote = (
        "chmod +x /opt/v61/run_daily.sh && "
        "systemctl daemon-reload && "
        "systemctl enable v61-post.timer >/dev/null 2>&1 && "
        "systemctl start v61-post.timer; "
        "systemctl list-timers v61-post.timer --no-pager | head -4"
    )
    stdin, stdout, stderr = client.exec_command(remote, timeout=60)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err.strip()[:800])
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
