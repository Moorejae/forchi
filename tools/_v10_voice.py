"""V10 narrator voice renderer — Higgs TTS 3, voice = "V10 Narrator (clean)".

Renders each scene's narration beat into a per-scene WAV with narrator prosody
tokens (<|prosody:speed_slow|><|prosody:pitch_low|>) for the deep slow
documentary narrator. Shorts voice is untouched (separate dropdown entry).

Usage:
    .venv\\Scripts\\python.exe tools/_v10_voice.py <scenes.json> <out_dir> [--limit N] [--dry-run]
"""
import os, sys, time, shutil, json, wave, struct, subprocess, re
from gradio_client import Client
from _paths import BASE
import imageio_ffmpeg

HIGGS_SPACE = "slymun/higgs-tts3"
V10_VOICE = "V10 Narrator (clean)"
NARRATOR_TOKENS = "<|prosody:speed_slow|><|prosody:pitch_low|>"


def _token():
    for line in open(os.path.join(BASE, '.env'), encoding='utf-8'):
        if line.startswith('HF_ACCESS_TOKEN='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('HF_ACCESS_TOKEN not found')


def get_client(timeout_min=15):
    t = _token()
    start = time.time()
    while time.time() - start < timeout_min * 60:
        try:
            c = Client(HIGGS_SPACE, headers={'Authorization': f'Bearer {t}'})
            c.view_api()
            print('  [v10voice] higgs ready', flush=True)
            return c
        except Exception as e:
            print(f'  [v10voice] waiting: {str(e)[:60]}', flush=True)
            time.sleep(20)
    raise SystemExit('higgs space not ready')


def restart_space(timeout_min=8):
    import urllib.request
    print('  [v10voice] space broken -> restarting (self-heal)', flush=True)
    try:
        req = urllib.request.Request(
            f'https://huggingface.co/api/spaces/{HIGGS_SPACE}/restart',
            data=b'', method='POST',
            headers={'Authorization': f'Bearer {_token()}'})
        urllib.request.urlopen(req, timeout=90)
    except Exception as e:
        print(f'  [v10voice] restart call failed: {str(e)[:80]}', flush=True)
    start = time.time()
    while time.time() - start < timeout_min * 60:
        try:
            import json as _json
            r = urllib.request.urlopen(f'https://huggingface.co/api/spaces/{HIGGS_SPACE}', timeout=30)
            d = _json.load(r)
            rt = d.get('runtime') or {}
            stage = rt.get('stage')
            dom = (rt.get('domains') or [{}])[0].get('stage')
            print(f'  [v10voice] stage={stage} domain={dom}', flush=True)
            if stage == 'RUNNING' and dom == 'READY':
                return
        except Exception:
            pass
        time.sleep(20)
    print('  [v10voice] WARNING: space not READY; continuing anyway', flush=True)


def synthesize(client, text, temperature=0.7, seed=-1, max_tokens=8192):
    res = client.predict(
        NARRATOR_TOKENS + text, V10_VOICE, None, '',
        temperature, 0.95, 50, max_tokens, seed,
        api_name='/predict',
    )
    return res if isinstance(res, str) else res[0]


def tighten_silences(wav_path, max_sil=0.25, lead=0.05, tail=0.10, threshold=0.02):
    """Cap long silence runs (same fix as the shorts voice). In-place."""
    if not os.path.exists(wav_path):
        return
    with wave.open(wav_path, 'rb') as w:
        sr = w.getframerate(); ch = w.getnchannels(); sw = w.getsampwidth(); n = w.getnframes()
        raw = w.readframes(n)
    if ch != 1 or sw != 2:
        return
    samples = list(struct.unpack(f'<{n}h', raw))
    is_sil = [abs(s) < threshold * 32767 for s in samples]
    runs = []
    i = 0; N = len(samples)
    while i < N:
        if is_sil[i]:
            j = i
            while j < N and is_sil[j]:
                j += 1
            runs.append((i, j)); i = j
        else:
            i += 1
    max_s = int(max_sil * sr); lead_s = int(lead * sr); tail_s = int(tail * sr)
    out = []; pos = 0
    for (a, b) in runs:
        out.extend(samples[pos:a])
        run_len = b - a
        if a == 0:
            keep = min(lead_s, run_len)
        elif b == N:
            keep = min(tail_s, run_len)
        else:
            keep = min(max_s, run_len)
        if keep > 0:
            out.extend(samples[a:a + keep])
        pos = b
    out.extend(samples[pos:N])
    tmp = wav_path + '.tmp.wav'
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(struct.pack(f'<{len(out)}h', *out))
    os.replace(tmp, wav_path)


def render_scenes(scenes, out_dir, limit=None, resume=True):
    """Render each scene's narration beat -> out_dir/sNN.wav. Returns [{index, beat, wav, duration}]."""
    os.makedirs(out_dir, exist_ok=True)
    sel = scenes[:limit] if limit else scenes
    client = get_client()
    space_restarted = False
    results = []
    for i, sc in enumerate(sel, 1):
        text = (sc.get('beat') or '').strip()
        if not text:
            continue
        raw = os.path.join(out_dir, f's{i:03d}.wav')
        if os.path.exists(raw) and os.path.getsize(raw) > 0 and resume:
            print(f'  [v10voice] scene {i} cached', flush=True)
        else:
            ok = False
            for attempt in range(4):
                try:
                    src = synthesize(client, text)
                    shutil.copy(src, raw)
                    ok = True
                    print(f'  [v10voice] scene {i} ({len(text.split())}w) done', flush=True)
                    break
                except Exception as e:
                    print(f'  [v10voice] scene {i} attempt {attempt+1}: {str(e)[:60]}', flush=True)
                    time.sleep(10)
            if not ok and not space_restarted:
                print('  [v10voice] all failed -> self-heal restart', flush=True)
                restart_space()
                client = get_client(timeout_min=8)
                space_restarted = True
                for attempt in range(4):
                    try:
                        src = synthesize(client, text)
                        shutil.copy(src, raw)
                        ok = True
                        print(f'  [v10voice] scene {i} post-heal done', flush=True)
                        break
                    except Exception as e:
                        print(f'  [v10voice] post-heal {attempt+1}: {str(e)[:60]}', flush=True)
                        time.sleep(10)
            if not ok:
                raise SystemExit(f'scene {i} failed')
        tighten_silences(raw)
        results.append({'index': i, 'beat': text, 'wav': raw})
    # durations
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    for r in results:
        p = subprocess.run([ff, '-i', r['wav']], capture_output=True, text=True, errors='ignore')
        m = re.search(r'Duration:\s*([\d:.]+)', p.stderr)
        if m:
            hh, mm, ss = m.group(1).split(':')
            r['duration'] = float(hh) * 3600 + float(mm) * 60 + float(ss)
        else:
            r['duration'] = 0.0
    return results


if __name__ == '__main__':
    scenes_file = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'temp_media', 'v10_alfonso_scenes.json')
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BASE, 'temp_media', 'v10_voice_parts')
    limit = None
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    with open(scenes_file, encoding='utf-8') as f:
        scenes = json.load(f)['scenes']
    res = render_scenes(scenes, out_dir, limit=limit)
    print(f'  [v10voice] total {sum(r["duration"] for r in res):.1f}s across {len(res)} scenes')
