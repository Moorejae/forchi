#!/usr/bin/env python3
"""V10 voice via the Contabo CPU worker (voice_synthesizer.py --worker).

Uploads the run's manifest.json to the VPS jobs dir, waits for the worker to
render rXX.wav per scene, downloads them into the local voice dir.

SELF-HEALING / RESUME (2026-08-30): the job ID is a content-hash of the manifest
(not a timestamp), so if the pipeline retries or re-runs the same manifest, it
re-submits the SAME job -> the worker renders into the SAME per-job subdir and
skips scenes whose rNN.wav already exists (it caches by existing non-empty wav).
That turns a failed build's retry from "re-render all N scenes" into "render only
the missing ones".

Usage:
    python tools/_v10_contabo_voice.py <manifest.json> <local_voice_dir> [--timeout 3600]
"""
import os, sys, json, time, argparse, stat, hashlib

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


def run_remote(c, cmd, timeout=120):
    i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    rc = o.channel.recv_exit_status()
    return rc, out, err


class ResilientSSH:
    """Reconnect on dropped SSH connections (the VPS kills idle keepalives under
    heavy CPU load from F5 rendering). Without this, a 30-60 min voice render
    would drop mid-wait and force an unnecessary Higgs/ZeroGPU fallback."""

    def __init__(self):
        self.c = None
        self._connect()

    def _connect(self):
        self.c = connect()
        try:
            self.c.get_transport().set_keepalive(15)
        except Exception:
            pass

    def run(self, cmd, timeout=120):
        for attempt in range(8):
            try:
                if self.c is None:
                    self._connect()
                return run_remote(self.c, cmd, timeout=timeout)
            except (EOFError, OSError, paramiko.SSHException) as e:
                print(f"[v10voice] conn lost ({type(e).__name__}: {str(e)[:60]}) — reconnecting...", flush=True)
                try:
                    self.c.close()
                except Exception:
                    pass
                self.c = None
                time.sleep(3 * (attempt + 1))
        raise RuntimeError("could not reconnect after 8 attempts")

    def sftp(self):
        if self.c is None:
            self._connect()
        return self.c.open_sftp()

    def close(self):
        try:
            self.c.close()
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", help="local run manifest.json")
    ap.add_argument("voice_dir", help="local output dir for rXX.wav")
    ap.add_argument("--timeout", type=int, default=1800, help="max seconds to wait")
    args = ap.parse_args()

    man = json.load(open(args.manifest, encoding="utf-8"))
    scenes = man.get("scenes", [])
    n_scenes = len(scenes)
    print(f"[v10voice] {n_scenes} scenes -> Contabo CPU worker", flush=True)

    os.makedirs(args.voice_dir, exist_ok=True)
    # Deterministic job ID from the manifest content, so retries/re-runs reuse the
    # same per-job subdir and the worker skips already-rendered scenes.
    digest = hashlib.sha1(json.dumps({"scenes": scenes}, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    job = REMOTE_JOBS.rstrip("/") + f"/job_{digest}.json"

    c = ResilientSSH()
    try:
        c.run(f"mkdir -p {REMOTE_JOBS} {REMOTE_VOICE}")
        # Atomic write: create as .tmp then rename into the jobs dir so the worker
        # never globs a half-written .json (paramiko SFTP close() can race the poll).
        sftp = c.sftp()
        tmp = job + ".tmp"
        with sftp.open(tmp, "w") as f:
            f.write(json.dumps({"scenes": scenes}))
        sftp.rename(tmp, job)
        sftp.close()
        print(f"[v10voice] submitted {job} — waiting for worker...", flush=True)

        t0 = time.time()
        base = job.rsplit(".", 1)[0]
        done = base + ".done"
        failed = base + ".failed"
        while time.time() - t0 < args.timeout:
            rc, out, _ = c.run(f"ls {done} {failed} 2>/dev/null")
            if done.split("/")[-1] in out:
                print("[v10voice] worker completed ✓", flush=True)
                break
            if failed.split("/")[-1] in out:
                rc2, errout, _ = c.run(f"cat {failed} 2>/dev/null; ls -la {REMOTE_VOICE}")
                print(f"[v10voice] worker FAILED: {errout}", flush=True)
                sys.exit(2)
            print(f"[v10voice] ... {round(time.time()-t0)}s elapsed (waiting)", flush=True)
            time.sleep(20)
        else:
            print(f"[v10voice] TIMEOUT after {args.timeout}s", file=sys.stderr)
            sys.exit(3)

        # download rXX.wav for each scene (from the per-job subdir — the worker
        # now renders each job into /opt/voice/out/<job_stem>/ so stale wavs from
        # earlier jobs are never mistaken for this job's output)
        job_stem = os.path.basename(job).rsplit(".", 1)[0]
        remote_dir = REMOTE_VOICE.rstrip("/") + "/" + job_stem
        got = 0
        missing = []
        for i in range(1, n_scenes + 1):
            remote = remote_dir + f"/r{i:02d}.wav"
            local = os.path.join(args.voice_dir, f"r{i:02d}.wav")
            try:
                sftp = c.sftp()
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
                # connection dropped mid-download -> reconnect and retry this file
                try:
                    c.close()
                except Exception:
                    pass
                c._connect()
                try:
                    sftp = c.sftp()
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
        print(f"[v10voice] downloaded {got}/{n_scenes} wavs -> {args.voice_dir}", flush=True)
        if missing:
            print("[v10voice] MISSING:", ", ".join(missing), file=sys.stderr)
            sys.exit(4)
    finally:
        c.close()


if __name__ == "__main__":
    main()
