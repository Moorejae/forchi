# Upload a LOCAL bash script to the Contabo VPS and run it (no quoting issues).
# Usage: python tools/_contabo_script.py <local_script_path> [args...]
import os, sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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
    if len(sys.argv) < 2:
        print("usage: python tools/_contabo_script.py <local_script.sh>")
        return 1
    local = sys.argv[1]
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD in .env")
        return 1
    script = open(local, "r", encoding="utf-8").read()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)
    sftp = client.open_sftp()
    with sftp.open("/tmp/script.sh", "w") as f:
        f.write(script + "\n")
    sftp.close()
    stdin, stdout, stderr = client.exec_command("bash /tmp/script.sh", timeout=3600)
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if err.strip():
        print("STDERR:", err.strip()[:1500])
    print("exit=", rc)
    client.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
