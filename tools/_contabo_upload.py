# Upload local files to the Contabo VPS via SFTP (with chmod +x).
# Usage: python tools/_contabo_upload.py <remote_dir> <local_file> [<local_file>...]
import os, sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    if len(sys.argv) < 3:
        print("usage: python tools/_contabo_upload.py <remote_dir> <local_file>...")
        return 1
    remote_dir = sys.argv[1]
    files = sys.argv[2:]
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD in .env")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, password=pw, timeout=30)
    sftp = c.open_sftp()
    try:
        sftp.mkdir(remote_dir)
    except IOError:
        pass
    for f in files:
        remote = (remote_dir.rstrip("/") + "/" + os.path.basename(f))
        sftp.put(f, remote)
        print(f"uploaded {f} -> {remote}")
    sftp.close()
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
