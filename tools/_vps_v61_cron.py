# Install the v61 weekly post as a cron job at Sunday 08:00 Africa/Lagos
# (Nigerian time, no DST) and disable the (timezone-broken) systemd timer.
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

CRON = "TZ=Africa/Lagos\n0 8 * * 0 /bin/bash /opt/v61/run_weekly.sh\n"


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
    with sftp.open("/tmp/v61cron.txt", "w") as f:
        f.write(CRON)
    sftp.close()
    remote = """
crontab /tmp/v61cron.txt
systemctl disable --now v61-post.timer 2>&1 | tail -1
echo ---crontab---
crontab -l
echo ---timers---
systemctl list-timers --no-pager | grep v61 || echo no-v61-timer
"""
    i, o, e = c.exec_command(remote, timeout=60)
    o.channel.settimeout(45)
    try:
        print(o.read().decode(errors="replace"))
        err = e.read().decode(errors="replace")
        if err.strip():
            print("STDERR:", err.strip()[:600])
    except Exception as ex:
        print("READ_ERR:", ex)
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
