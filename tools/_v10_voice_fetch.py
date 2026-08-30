#!/usr/bin/env python3
"""Wait for an EXISTING Contabo voice job to finish, then download its rNN.wavs.

Unlike _v10_contabo_voice.py (which submits a NEW job), this just waits for a
job already in flight (e.g. after a pipeline crash) and pulls the wavs into a
local voice dir — used to resume the v10Pipeline from the voice stage without
re-submitting a duplicate render job.

Usage:
    python tools/_v10_voice_fetch.py --job job_1788036871 --voice <local_voice_dir> [--n 11] [--timeout 5400]
"""
import os, sys, json, time, argparse

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import paramiko

HOST = "217.77.1.187"
USER = "root"
BASE = r"c:\Users\hp\forchi"
REMOTE_JOBS = "/opt/voice/jobs"
REMOTE_VOICE = "/opt/voice/out"


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


def connect():
    pw = env("CONTABO_LOGIN_PASSWORD")
    if not pw:
        print("missing CONTABO_LOGIN_PASSWORD in .env", file=sys.stderr)
        sys.exit(1)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=22, username=USER, password=pw, timeout=30)
    return c


def run_remote(c, cmd, timeout=60):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    rc = o.channel.recv_exit_status()
    return rc, out, err


class ResilientSSH:
    """Wrapper that reconnects when the SSH connection drops (the VPS kills
    idle keepalives under heavy CPU load from F5 rendering)."""

    def __init__(self):
        self.c = None
        self._connect()

    def _connect(self):
        self.c = connect()
        # keepalive so the VPS doesn't consider us idle while we sleep between polls
        try:
            self.c.get_transport().set_keepalive(15)
        except Exception:
            pass

    def run(self, cmd, timeout=60):
        for attempt in range(5):
            try:
                if self.c is None:
                    self._connect()
                return run_remote(self.c, cmd, timeout=timeout)
            except (EOFError, OSError, paramiko.SSHException) as e:
                print(f"[voicefetch] conn lost ({type(e).__name__}: {str(e)[:60]}) — reconnecting...", flush=True)
                try:
                    self.c.close()
                except Exception:
                    pass
                self.c = None
                time.sleep(3 * (attempt + 1))
        raise RuntimeError("could not reconnect after 5 attempts")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True, help="job basename, e.g. job_1788036871 (no extension)")
    ap.add_argument("--voice", required=True, help="local dir to put rNN.wav")
    ap.add_argument("--n", type=int, default=11, help="how many scenes/wavs to expect")
    ap.add_argument("--timeout", type=int, default=5400, help="max seconds to wait")
    args = ap.parse_args()

    base = args.job if args.job.endswith(".json") else args.job + ".json"
    done = args.job + ".done"
    failed = args.job + ".failed"
    os.makedirs(args.voice, exist_ok=True)

    rssh = ResilientSSH()
    try:
        t0 = time.time()
        # First check if it's already done (crash-resume case)
        rc, out, _ = rssh.run(f"ls {REMOTE_JOBS}/{done} {REMOTE_JOBS}/{failed} 2>/dev/null")
        if failed.split("/")[-1] in out:
            rc2, errout, _ = rssh.run(f"cat {REMOTE_JOBS}/{failed} 2>/dev/null")
            print(f"[voicefetch] job already FAILED: {errout}", file=sys.stderr)
            sys.exit(2)
        if done.split("/")[-1] in out:
            print("[voicefetch] job already done ✓")
        else:
            print(f"[voicefetch] waiting for {REMOTE_JOBS}/{done} (job in flight)...", flush=True)
            last_report = 0
            while time.time() - t0 < args.timeout:
                rc, out, _ = rssh.run(f"ls {REMOTE_JOBS}/{done} {REMOTE_JOBS}/{failed} 2>/dev/null")
                if done.split("/")[-1] in out:
                    print("[voicefetch] job done ✓", flush=True)
                    break
                if failed.split("/")[-1] in out:
                    rc2, errout, _ = rssh.run(f"cat {REMOTE_JOBS}/{failed} 2>/dev/null")
                    print(f"[voicefetch] job FAILED: {errout}", file=sys.stderr)
                    sys.exit(2)
                # report wav progress every ~120s
                elapsed = round(time.time() - t0)
                if elapsed - last_report >= 120:
                    last_report = elapsed
                    job_stem = os.path.basename(args.job).rsplit(".", 1)[0]
                    rc3, wc, _ = rssh.run(f"ls {REMOTE_VOICE}/{job_stem}/r*.wav 2>/dev/null | wc -l")
                    print(f"[voicefetch] ... {elapsed}s elapsed, {wc.strip()} wavs so far", flush=True)
                time.sleep(20)
            else:
                print(f"[voicefetch] TIMEOUT after {args.timeout}s", file=sys.stderr)
                sys.exit(3)

        # Download r01..rNN.wav from the per-job subdir (worker renders each job
        # into /opt/voice/out/<job_stem>/ so stale wavs from earlier jobs are never
        # mistaken for this job's output). Reconnect-safe: retry the sftp get a few times.
        job_stem = os.path.basename(args.job).rsplit(".", 1)[0]
        remote_dir = REMOTE_VOICE.rstrip("/") + "/" + job_stem
        got = 0
        missing = []
        for i in range(1, args.n + 1):
            remote = remote_dir + f"/r{i:02d}.wav"
            local = os.path.join(args.voice, f"r{i:02d}.wav")
            try:
                sftp = rssh.c.open_sftp()
                try:
                    st = sftp.stat(remote)
                    if st.st_size > 0:
                        sftp.get(remote, local)
                        got += 1
                    else:
                        missing.append(f"r{i:02d} (0 bytes)")
                finally:
                    sftp.close()
            except (FileNotFoundError, IOError):
                missing.append(f"r{i:02d} (absent)")
            except (EOFError, OSError, paramiko.SSHException):
                # connection dropped mid-download -> reconnect and retry this file once
                try:
                    rssh.c.close()
                except Exception:
                    pass
                rssh.c = None
                rssh._connect()
                try:
                    sftp = rssh.c.open_sftp()
                    try:
                        st = sftp.stat(remote)
                        if st.st_size > 0:
                            sftp.get(remote, local)
                            got += 1
                        else:
                            missing.append(f"r{i:02d} (0 bytes)")
                    finally:
                        sftp.close()
                except Exception as ex:
                    missing.append(f"r{i:02d} (dl retry: {type(ex).__name__})")
        print(f"[voicefetch] downloaded {got}/{args.n} wavs -> {args.voice}", flush=True)
        if missing:
            print("[voicefetch] MISSING:", ", ".join(missing), file=sys.stderr)
            sys.exit(4)
    finally:
        try:
            rssh.c.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
