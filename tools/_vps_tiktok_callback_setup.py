# Set up the myzelva.com TLS path to the ForChi bot on the Contabo VPS:
#  1) install Caddy (if missing) + open 80/443 in ufw if it's active
#  2) write Caddyfile: forchi.myzelva.com -> 127.0.0.1:7860 (auto Let's Encrypt)
#  3) set TIKTOK_CALLBACK_URL=https://forchi.myzelva.com/tiktok_callback in /opt/forchi/.env
#  4) restart caddy + forchi, then print verification
#
# The bash script is SFTP-written to /tmp/callback_setup.sh then executed, so
# there are NO argv quoting issues (Windows strips double quotes).
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
CALLBACK = "https://forchi.myzelva.com/tiktok_callback"

SETUP_SH = r'''#!/bin/bash
set -u
echo "=== [1/6] apt + ufw ==="
apt-get update -y >/dev/null 2>&1 || echo "apt update failed (nonfatal)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "ufw active - opening 80/443"
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw reload >/dev/null 2>&1 || true
else
  echo "ufw not active (nothing to open)"
fi
echo "=== [2/6] install caddy ==="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1 || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y caddy
fi
caddy version
echo "=== [3/6] write Caddyfile ==="
cat > /etc/caddy/Caddyfile <<'CADDYEOF'
forchi.myzelva.com {
	reverse_proxy 127.0.0.1:7860
}
CADDYEOF
caddy validate --config /etc/caddy/Caddyfile || echo "caddy validate FAILED"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
echo "caddy active: $(systemctl is-active caddy)"
echo "=== [4/6] update /opt/forchi/.env ==="
sed -i 's|^TIKTOK_CALLBACK_URL=.*|TIKTOK_CALLBACK_URL=CALLBACK_PLACEHOLDER|' /opt/forchi/.env
grep '^TIKTOK_CALLBACK_URL=' /opt/forchi/.env
echo "=== [5/6] restart forchi ==="
systemctl restart forchi
sleep 6
echo "forchi active: $(systemctl is-active forchi)"
echo "=== [6/6] listeners ==="
ss -ltn | grep -E ':(80|443|7860)\b' || true
echo DONE
'''

SETUP_SH = SETUP_SH.replace("CALLBACK_PLACEHOLDER", CALLBACK)


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
        print("missing CONTABO_LOGIN_PASSWORD in .env")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=30)
    sftp = client.open_sftp()
    with sftp.open("/tmp/callback_setup.sh", "w") as f:
        f.write(SETUP_SH)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /tmp/callback_setup.sh", timeout=600)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if err.strip():
        print("STDERR:", err.strip()[:2000])
    print("exit=", rc)
    client.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
