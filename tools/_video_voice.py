"""ForChi Higgs TTS client - renders a script into per-phrase WAVs (clean / whisper voices).

Uses the slymun/higgs-tts3 Space (zero-shot clone of the Victor Moore voice).
Voice modes:
  - clean : "Victor Moore (clean)" - the deep baritone persona
  - whisper: "Victor Moore (clean)" + <|style:whispering|> token = TRUE stage whisper (verified MATCHED)
  - whisper_ref: "Whisper (user ref)" - clone of the user's whisper reference

Per phrase it synthesizes and returns the wav. Phrases are chunked by sentence.
"""
import os, time, shutil, re
from gradio_client import Client
from _paths import BASE

HIGGS_SPACE = "slymun/higgs-tts3"
DEFAULT_VOICE = "Victor Moore (clean)"
WHISPER_VOICE = "Victor Moore (clean)"
WHISPER_REF_VOICE = "Whisper (user ref)"


def _token():
    for line in open(os.path.join(BASE, '.env'), encoding='utf-8'):
        if line.startswith('HF_ACCESS_TOKEN='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('HF_ACCESS_TOKEN not found')


def get_client(timeout_min=15):
    t = _token()
    c = None
    start = time.time()
    while time.time() - start < timeout_min * 60:
        try:
            c = Client(HIGGS_SPACE, headers={'Authorization': f'Bearer {t}'})
            c.view_api()
            print('  [higgs] space ready', flush=True)
            return c
        except Exception as e:
            print(f'  [higgs] waiting: {str(e)[:60]}', flush=True)
            time.sleep(20)
    raise SystemExit('higgs space not ready')


def restart_space(timeout_min=8):
    """Self-heal: the Higgs ZeroGPU space occasionally boots into a broken state
    where predict raises RuntimeError. Restart it and wait for READY."""
    import urllib.request
    print('  [higgs] space broken -> restarting (self-heal)', flush=True)
    try:
        req = urllib.request.Request(
            f'https://huggingface.co/api/spaces/{HIGGS_SPACE}/restart',
            data=b'', method='POST',
            headers={'Authorization': f'Bearer {_token()}'})
        urllib.request.urlopen(req, timeout=90)
    except Exception as e:
        print(f'  [higgs] restart call failed: {str(e)[:80]}', flush=True)
    start = time.time()
    while time.time() - start < timeout_min * 60:
        try:
            import json as _json
            r = urllib.request.urlopen(f'https://huggingface.co/api/spaces/{HIGGS_SPACE}', timeout=30)
            d = _json.load(r)
            rt = d.get('runtime') or {}
            stage = rt.get('stage')
            dom = (rt.get('domains') or [{}])[0].get('stage')
            print(f'  [higgs] restart stage={stage} domain={dom}', flush=True)
            if stage == 'RUNNING' and dom == 'READY':
                return
        except Exception:
            pass
        time.sleep(20)
    print('  [higgs] WARNING: space did not reach READY in time; continuing anyway', flush=True)


def split_phrases(text, max_len=220):
    """Split script into sentence phrases (chunked to Higgs token limits)."""
    # split on sentence-ending punctuation, keep it as separate phrases
    parts = re.split(r'(?<=[.!?…])\s+', text.strip())
    phrases = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(p) > max_len:
            # hard-split long phrases on commas
            for sub in re.split(r'(?<=[,;:])\s+', p):
                sub = sub.strip()
                if sub:
                    phrases.append(sub)
        else:
            phrases.append(p)
    return phrases


def synthesize(client, text, mode='clean', temperature=0.7, seed=-1, max_tokens=4096):
    """Synthesize one phrase via Higgs. Returns the local wav path."""
    voice = DEFAULT_VOICE
    if mode == 'whisper':
        text = f'<|style:whispering|>{text}'
        voice = WHISPER_VOICE
    elif mode == 'whisper_ref':
        voice = WHISPER_REF_VOICE
    elif mode != 'clean':
        raise ValueError(f'unknown mode {mode}')

    res = client.predict(
        text, voice, None, '', temperature, 0.95, 50, max_tokens, seed,
        api_name='/predict',
    )
    p = res if isinstance(res, str) else res[0]
    return p  # server-side path; caller copies it


def tighten_silences(wav_path, max_sil=0.25, lead=0.05, tail=0.10, threshold=0.02):
    """Cap long silence runs in a phrase wav (fixes Higgs mid-sentence pauses that sound broken).
    Reads 24kHz mono s16, shortens any silence run > max_sil to max_sil, trims lead/trail. In-place."""
    import wave, struct
    if not os.path.exists(wav_path):
        return
    with wave.open(wav_path, 'rb') as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        sw = w.getsampwidth()
        n = w.getnframes()
        raw = w.readframes(n)
    if ch != 1 or sw != 2:
        return
    samples = list(struct.unpack(f'<{n}h', raw))
    # silence mask
    is_sil = [abs(s) < threshold * 32767 for s in samples]
    # find runs
    runs = []
    i = 0
    N = len(samples)
    while i < N:
        if is_sil[i]:
            j = i
            while j < N and is_sil[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    max_s = int(max_sil * sr)
    lead_s = int(lead * sr)
    tail_s = int(tail * sr)
    # rebuild: keep audio, shorten silences; trim leading run to lead_s, trailing run to tail_s, internal to max_s
    out = []
    pos = 0
    for (a, b) in runs:
        out.extend(samples[pos:a])  # audio before this run
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
    # write back
    tmp = wav_path + '.tmp.wav'
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack(f'<{len(out)}h', *out))
    os.replace(tmp, wav_path)


def render_script(text, out_dir, mode='clean', client=None, resume=True,
                  temperature=0.7, seed=-1, max_tokens=4096, max_len=220):
    """Render a full script -> per-phrase wavs in out_dir/pN.wav (+ manifest of timings).
    Each phrase wav is silence-tightened (caps Higgs mid-sentence pauses).
    Returns list of dicts: {index, text, wav, mode, duration}.
    """
    os.makedirs(out_dir, exist_ok=True)
    phrases = split_phrases(text, max_len=max_len)
    print(f'  [higgs] {len(phrases)} phrases', flush=True)
    if client is None:
        client = get_client()
    space_restarted = False

    results = []
    for i, ph in enumerate(phrases, 1):
        raw = os.path.join(out_dir, f'p{i}.wav')
        done = os.path.exists(raw) and os.path.getsize(raw) > 0 and resume
        if done:
            print(f'  [higgs] phrase {i} cached', flush=True)
        else:
            ok = False
            for attempt in range(4):
                try:
                    src = synthesize(client, ph, mode=mode, temperature=temperature,
                                     seed=seed, max_tokens=max_tokens)
                    shutil.copy(src, raw)
                    ok = True
                    print(f'  [higgs] phrase {i} ({len(ph.split())}w) done', flush=True)
                    break
                except Exception as e:
                    print(f'  [higgs] phrase {i} attempt {attempt+1}: {str(e)[:60]}', flush=True)
                    time.sleep(10)
            # Self-heal: if the whole space is erroring (broken boot), restart once
            # and retry this phrase with a fresh client.
            if not ok and not space_restarted:
                print('  [higgs] all attempts failed -> triggering space self-heal', flush=True)
                restart_space()
                client = get_client(timeout_min=8)
                space_restarted = True
                for attempt in range(4):
                    try:
                        src = synthesize(client, ph, mode=mode, temperature=temperature,
                                         seed=seed, max_tokens=max_tokens)
                        shutil.copy(src, raw)
                        ok = True
                        print(f'  [higgs] phrase {i} retry after self-heal done', flush=True)
                        break
                    except Exception as e:
                        print(f'  [higgs] phrase {i} post-heal attempt {attempt+1}: {str(e)[:60]}', flush=True)
                        time.sleep(10)
            if not ok:
                raise SystemExit(f'phrase {i} failed')
        tighten_silences(raw)  # cap Higgs mid-sentence pauses (fixes broken phrasing)
        results.append({'index': i, 'text': ph, 'wav': raw, 'mode': mode})

    return results


def durations(wav_paths):
    """Return [duration_s] for wavs using imageio-ffmpeg probe."""
    import subprocess, imageio_ffmpeg, re
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    durs = []
    for w in wav_paths:
        r = subprocess.run([ff, '-i', w], capture_output=True, text=True, errors='ignore')
        m = re.search(r'Duration:\s*([\d:.]+)', r.stderr)
        if m:
            hh, mm, ss = m.group(1).split(':')
            durs.append(float(hh) * 3600 + float(mm) * 60 + float(ss))
        else:
            durs.append(0.0)
    return durs


if __name__ == '__main__':
    import sys
    script = sys.argv[1] if len(sys.argv) > 1 else (
        "We love to believe that evil is a monster, born in the dark. "
        "But the truth of human nature is far more terrifying. "
        "The most dangerous darkness does not come from the wicked. "
        "It comes from the exact moment a good person finally decides to let go of their morals. "
        "Because when the righteous finally fall, they teach the rest of us exactly what hell looks like."
    )
    mode = sys.argv[2] if len(sys.argv) > 2 else 'clean'
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(BASE, 'temp_media', 'higgs_parts')
    res = render_script(script, out, mode=mode)
    durs = durations([r['wav'] for r in res])
    print(f'  [higgs] total {sum(durs):.1f}s across {len(durs)} phrases')
