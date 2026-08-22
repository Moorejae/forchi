# Run an arbitrary remote shell command on the Contabo VPS.
# Uses paramiko with the root password from .env (password never printed). This
# is the reliable path here — the local id_ed25519 key is passphrase-encrypted
# and the agent can't unlock it non-interactively, while password auth works.
# Usage: python tools/_contabo_cmd.py 'remote command here'
import os
import sys

import paramiko

HOST = "217.77.1.187"
USER = "root"
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
    cmd = sys.argv[1] if len(sys.argv) > 1 else "echo hi"
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD in .env")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=600)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("STDERR:", err.strip()[:1500])
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
