# Deploy the interactive v61 bot to the VPS:
#  - new telegram_bot.py (Qwen-only chat + --serve + --weekly)
#  - v61-bot.service (self-healing: Restart=always)
#  - v61-post.timer -> weekly (Mon 07:00) + run_weekly.sh
#  - LLM_ENDPOINT=http://127.0.0.1:8080 in /opt/v61/.env
#  - pre-seed data/chat_id.txt so weekly posts don't need getUpdates
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
import paramiko

HOST = "217.77.1.187"
USER = "root"
LOCAL_REPO = r"c:\Users\hp\v61-football-engine"

BOT_SERVICE = """[Unit]
Description=V61 Telegram bot (Qwen chat + weekly picks)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/v61
ExecStart=/opt/v61/.venv/bin/python telegram_bot.py --serve
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
"""

WEEKLY_TIMER = """[Unit]
Description=Run v61 weekly picks post

[Timer]
OnCalendar=Mon *-*-* 07:00:00
Persistent=true

[Install]
WantedBy=timers.target
"""

RUN_WEEKLY = """#!/bin/bash
cd /opt/v61
START=$(date -u +%F)
/opt/v61/.venv/bin/python telegram_bot.py --weekly "$START" >> /opt/v61/data/bot_weekly.log 2>&1
for i in 1 2 3 4 5 6 7; do
  D=$(date -u -d "$i days ago" +%F)
  /opt/v61/.venv/bin/python telegram_bot.py --record "$D" >> /opt/v61/data/bot_weekly.log 2>&1
done
"""


def env(k):
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", ".env"), "r", encoding="utf-8") as f:
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
    bot = open(os.path.join(LOCAL_REPO, "telegram_bot.py"), "r", encoding="utf-8").read()

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, password=pw, timeout=30)
    sftp = c.open_sftp()
    with sftp.open("/opt/v61/telegram_bot.py", "w") as f:
        f.write(bot)
    with sftp.open("/etc/systemd/system/v61-bot.service", "w") as f:
        f.write(BOT_SERVICE)
    with sftp.open("/etc/systemd/system/v61-post.timer", "w") as f:
        f.write(WEEKLY_TIMER)
    with sftp.open("/opt/v61/run_weekly.sh", "w") as f:
        f.write(RUN_WEEKLY)
    sftp.close()
    print("files written")

    remote = """
set -e
chmod +x /opt/v61/run_weekly.sh
# Qwen-only endpoint in v61 env
grep -q "^LLM_ENDPOINT=" /opt/v61/.env || echo "LLM_ENDPOINT=http://127.0.0.1:8080" >> /opt/v61/.env
grep "^LLM_ENDPOINT" /opt/v61/.env
# pre-seed chat id (known from earlier getUpdates)
mkdir -p /opt/v61/data
echo 6514724034 > /opt/v61/data/chat_id.txt
cat /opt/v61/data/chat_id.txt
# units
systemctl daemon-reload
systemctl enable v61-bot >/dev/null 2>&1
systemctl restart v61-bot
systemctl enable v61-post.timer >/dev/null 2>&1
systemctl restart v61-post.timer
sleep 2
echo BOT=$(systemctl is-active v61-bot)
echo TIMER=$(systemctl is-active v61-post.timer)
systemctl list-timers --no-pager | grep v61
"""
    i, o, e = c.exec_command(remote, timeout=120)
    o.channel.settimeout(90)
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
