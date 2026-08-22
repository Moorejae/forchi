# Install + start the ForChi systemd service on the VPS (SFTP-writes the unit file,
# so no shell quoting issues). Prints service status + recent logs.
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"

UNIT = """[Unit]
Description=ForChi Telegram bot + workflows
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/forchi
ExecStart=/usr/bin/node src/bot.js
Restart=always
RestartSec=10
Environment=FORCHI_BASE=/opt/forchi
# .env is loaded by the app itself (dotenv reads cwd/.env); do NOT use EnvironmentFile
# (systemd would choke on special chars in secret values).

[Install]
WantedBy=multi-user.target
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
    print("connecting...")
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)

    sftp = client.open_sftp()
    with sftp.open("/etc/systemd/system/forchi.service", "w") as f:
        f.write(UNIT)
    sftp.close()
    print("unit written.")

    remote = (
        "systemctl daemon-reload && "
        "systemctl enable forchi >/dev/null 2>&1 && "
        "systemctl restart forchi; "
        "sleep 5; "
        "echo ===STATUS===; systemctl status forchi --no-pager -l | head -14; "
        "echo ===LOGS===; journalctl -u forchi -n 25 --no-pager"
    )
    stdin, stdout, stderr = client.exec_command(remote, timeout=120)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    if err.strip():
        print("STDERR:", err.strip()[:1200])
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
