# Transfer v61 .env + data tarball to the VPS and extract into /opt/v61.
import os
import sys

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"
V61 = r"c:\Users\hp\v61-football-engine"
TAR = os.path.join(BASE, "temp_media", "v61_data.tar.gz")


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
    if not os.path.exists(TAR):
        print("tar missing:", TAR)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("connecting...")
    client.connect(HOST, port=22, username=USER, password=pw, timeout=20)

    # .env via SFTP (small)
    sftp = client.open_sftp()
    sftp.put(os.path.join(V61, ".env"), "/opt/v61/.env")
    sftp.close()
    print(".env transferred")

    # data tar streamed over the exec channel (SFTP is flaky for ~40MB)
    stdin, stdout, stderr = client.exec_command(
        "cat > /tmp/v61_data.tar.gz && "
        "cd /opt/v61 && tar -xzf /tmp/v61_data.tar.gz && rm /tmp/v61_data.tar.gz && "
        "echo ---count---; find data -type f | wc -l",
        timeout=600,
    )
    size = os.path.getsize(TAR)
    with open(TAR, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            stdin.write(chunk)
    stdin.channel.shutdown_write()
    print("tar streamed (", size // 1048576, "MB )")
    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if err.strip():
        print("STDERR:", err.strip()[:1200])
    print("exit=", rc)
    client.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
