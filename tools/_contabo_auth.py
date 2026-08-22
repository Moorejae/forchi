# One-time: install this PC's public SSH key into the Contabo VPS authorized_keys
# using the root password from .env (password never printed). After this, key auth
# works and the password is no longer needed.
import os
import re
import sys

import paramiko

BASE = r"c:\Users\hp\forchi"


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
    host = env("CONTABO_IP_ADDRESS")
    user = env("CONTABO_LOGIN_USERNAME") or "root"
    pw = env("CONTABO_LOGIN_PASSWORD")
    pub_path = os.path.join(os.path.expanduser("~"), ".ssh", "id_ed25519.pub")
    if not os.path.exists(pub_path):
        print("no pubkey at", pub_path)
        return 1
    pub = open(pub_path).read().strip()
    if not host or not pw:
        print("missing CONTABO_IP_ADDRESS / CONTABO_LOGIN_PASSWORD in .env")
        return 1

    cmd = (
        "mkdir -p ~/.ssh && "
        f"grep -qF '{pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '{pub}' >> ~/.ssh/authorized_keys; "
        "chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; "
        "echo KEY_INSTALLED; echo '--- authorized_keys ---'; cat ~/.ssh/authorized_keys"
    )
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"connecting to {user}@{host} ...")
    client.connect(host, port=22, username=user, password=pw, timeout=20)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print(out.strip()[:500])
    if err.strip():
        print("stderr:", err.strip()[:200])
    client.close()
    print("done. key should now be authorized.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
