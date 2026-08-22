# Deploy v2 changes to the VPS:
#  1) pull forchi + restart forchi (video scheduler -> ~5 posts/day)
#  2) SFTP new v61 telegram_bot.py (per-sport weekly + explain-why)
#  3) v61-post.timer -> Sunday 08:00 Africa/Lagos (Nigerian time)
#  4) restart v61-bot + timer
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

WEEKLY_TIMER = """[Unit]
Description=Run v61 weekly picks post (Sunday 08:00 Nigerian time)

[Timer]
OnCalendar=Sun *-*-* 07:00:00
Timezone=UTC
Persistent=true

[Install]
WantedBy=timers.target
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
    with sftp.open("/etc/systemd/system/v61-post.timer", "w") as f:
        f.write(WEEKLY_TIMER)
    sftp.close()
    print("files written")

    remote = """
set -e
# 1) forchi (video scheduler -> ~5 posts/day)
cd /opt/forchi && git pull --ff-only origin main 2>&1 | tail -1
systemctl restart forchi
# 2/3/4) v61 bot + sunday timer
systemctl daemon-reload
systemctl restart v61-bot
systemctl enable v61-post.timer >/dev/null 2>&1
systemctl restart v61-post.timer
sleep 2
echo FORCHI=$(systemctl is-active forchi)
echo V61BOT=$(systemctl is-active v61-bot)
echo TIMER=$(systemctl is-active v61-post.timer)
timedatectl | grep "Time zone"
systemctl list-timers --no-pager | grep v61
"""
    i, o, e = c.exec_command(remote, timeout=150)
    o.channel.settimeout(120)
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
