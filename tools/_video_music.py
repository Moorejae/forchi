"""ForChi piano music library - synthesize soft piano-style instrumental beds per mood.

Generates 5-10 tracks (60s each) into media/music/ using additive piano synthesis
(plucked harmonics + exponential decay). Selected by script emotional weight.
"""
import numpy as np
import wave, os, struct
from _paths import BASE

SR = 24000
DUR = 60
OUT_DIR = os.path.join(BASE, 'media', 'music')
os.makedirs(OUT_DIR, exist_ok=True)

# note frequencies (A4=440)
def f(note):
    return 440.0 * 2 ** ((note - 69) / 12)

NOTES = {n: f(i) for i, n in enumerate(
    ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])}
def nf(letter, octv):
    return NOTES[letter] * 2 ** (octv - 4)


def piano_note(freq, dur, vel=0.9):
    """A soft piano-ish note: harmonics with exponential decay + slight inharmonicity."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    partials = [1.0, 2.00, 3.00, 4.00, 5.0, 6.0]
    amps = [1.0, 0.42, 0.25, 0.12, 0.06, 0.03]
    # slight inharmonicity like a real piano (higher partials stretched)
    stretch = [1.0, 1.0004, 1.0009, 1.0016, 1.0025, 1.0036]
    env = np.exp(-t / (0.25 + 0.6 * (1 / (freq / 200))))  # faster decay for higher notes
    env[:int(SR * 0.004)] *= np.linspace(0, 1, int(SR * 0.004))  # attack
    s = np.zeros_like(t)
    for p, a, st in zip(partials, amps, stretch):
        s += a * np.sin(2 * np.pi * freq * p * st * t)
    s *= env * vel
    # soft lowpass via smoothing
    s = np.convolve(s, np.ones(12) / 12, mode='same')
    return s


def piano_chord(notes, dur, spread=0.06, vel=0.8):
    """Notes = list of (freq, delay). Returns a chord with slight arpeggio."""
    total = int(SR * (dur + spread * len(notes)))
    buf = np.zeros(total)
    for i, freq in enumerate(notes):
        seg = piano_note(freq, dur, vel=vel)
        start = int(SR * spread * i)
        buf[start:start + len(seg)] += seg[:len(buf) - start]
    return buf


def mix_to(track, buf, gain=0.8):
    """Overlay buf onto track (looped-safe)."""
    n = min(len(buf), len(track))
    track[:n] += buf[:n] * gain


def make_track(prog, rhythm, dur=DUR, seed=0):
    """prog: list of (chord_notes, chord_beats). rhythm: secs per beat.
    Continuous bed: chords overlap (~60% sustain, next starts before prev ends)
    so there is NEVER silence - a flowing piano background."""
    rng = np.random.default_rng(seed)
    track = np.zeros(int(SR * dur))
    t = 0.0
    ci = 0
    while t < dur - 8:
        notes, beats = prog[ci % len(prog)]
        ci += 1
        chord_dur = beats * rhythm
        # long sustain + overlap for a continuous flowing bed
        buf = piano_chord(notes, chord_dur * 2.2, spread=rhythm * 0.4, vel=rng.uniform(0.55, 0.85))
        start = int(SR * t)
        end = min(start + len(buf), len(track))
        track[start:end] += buf[:end - start]
        t += chord_dur * 0.62  # next chord starts before the previous ends -> no gaps
    # normalize
    track = track / (np.max(np.abs(track)) + 1e-9)
    # gentle room: add tiny reverb-ish tail (simple feedback delay)
    delay = int(SR * 0.4)
    wet = np.zeros_like(track)
    wet[delay:] += track[:-delay] * 0.3
    track = track + wet
    track = track / (np.max(np.abs(track)) + 1e-9)
    return (track * 0.8).astype(np.float32)


def save(name, track):
    p = os.path.join(OUT_DIR, f'{name}.wav')
    data = (track * 32767).astype(np.int16)
    with wave.open(p, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print('  [music]', name, f'{len(track)/SR:.0f}s')
    return p


A = nf('A', 3); C = nf('C', 4); E = nf('E', 4); F = nf('F', 3); G = nf('G', 3)
D = nf('D', 4); B = nf('B', 3); C3 = nf('C', 3); E3 = nf('E', 3); G3 = nf('G', 3)
D3 = nf('D', 3); A3 = nf('A', 3); B3 = nf('B', 3); F3 = nf('F', 3); Gb = nf('F#', 3)
Bb = nf('A#', 3); Db = nf('C#', 4); Cs = nf('C#', 4); Fs = nf('F#', 3)

# progressions per mood (chord, beats)
PROGS = {
    # romantic/sad: Am F C G (i VI III VII)
    'romantic': [([A, C, E], 4), ([F, A, C], 4), ([C, E, G], 4), ([G, B, D], 4)],
    # melancholic: Em C G D
    'melancholic': [([E, G, B], 4), ([C, E, G], 4), ([G, B, D], 4), ([D, Fs, A], 4)],
    # hopeful/warm: C G Am F
    'hopeful': [([C, E, G], 4), ([G, B, D], 4), ([A, C, E], 4), ([F, A, C], 4)],
    # calm: Cmaj7 Fmaj7 (airy, sparse)
    'calm': [([C, E, G, B], 4), ([F, A, C, E], 4)],
    # tense/dark: Dm Bb Gm A (suspenseful)
    'tense': [([D, F, A], 4), ([Bb, D, F], 4), ([G, Bb, D], 4), ([A, Cs, E], 4)],
    # epic/emotional: Am F C G (faster, fuller)
    'epic': [([A, C, E], 2), ([F, A, C], 2), ([C, E, G], 2), ([G, B, D], 2)],
}
RHYTHM = {'romantic': 0.62, 'melancholic': 0.66, 'hopeful': 0.5,
          'calm': 0.85, 'tense': 0.58, 'epic': 0.4}

MOOD_TRACK = {
    'romantic': 'piano_romantic', 'melancholic': 'piano_melancholic', 'hopeful': 'piano_hopeful',
    'calm': 'piano_calm', 'tense': 'piano_tense', 'epic': 'piano_epic',
    'dark': 'piano_tense', 'isolation': 'piano_calm', 'love': 'piano_romantic',
}


def pick_for_phrases(phrases):
    """Choose a track by the majority mood of the script phrases."""
    from _video_stitch import phrase_mood
    votes = {}
    for ph in phrases:
        mood, _ = phrase_mood(ph)
        votes[mood] = votes.get(mood, 0) + 1
    top = max(votes, key=votes.get)
    track = MOOD_TRACK.get(top, 'piano_romantic')
    return os.path.join(OUT_DIR, f'{track}.wav')


INSTR_DIR = os.path.join(BASE, '.instrumental')


def pick_instrumental():
    """Return a random instrumental from the .instrumental folder (ogg/mp3/wav/m4a/flac) or None."""
    import random
    exts = ('.ogg', '.mp3', '.wav', '.m4a', '.flac', '.aac', '.opus')
    files = []
    for d in (INSTR_DIR, os.path.join(BASE, 'media', 'instrumental')):
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.lower().endswith(exts):
                    files.append(os.path.join(d, f))
    if not files:
        return None
    return random.choice(files)


def build_bed(src, dur_s, out_path, peak_db=-6.0, fade_out_st=None, random_offset=True):
    """Convert + LOOP any audio (ogg/mp3/wav instrumental or piano lib) to a 24k mono
    bed at a consistent peak level, faded in/out, that plays for the FULL dur_s.
    -stream_loop -1 guarantees the music runs to the END of the video even when
    the source track is shorter than the narration (previously it ended early).
    random_offset seeks into LONG tracks so different parts of each song get used
    across videos (previously only the intro was ever heard)."""
    import subprocess, shutil, imageio_ffmpeg, random, re
    if not src or not os.path.exists(src):
        print(f'  [music] bed source missing: {src}', flush=True)
        return None
    FF = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()
    peak = None
    try:
        r = subprocess.run([FF, '-i', src, '-af', 'volumedetect', '-f', 'null', '-'],
                           capture_output=True, text=True, errors='ignore')
        for l in r.stderr.splitlines():
            if 'max_volume' in l:
                peak = float(l.split(':')[1].strip().replace(' dB', ''))
    except Exception:
        pass
    gain = 1.0
    if peak is not None:
        gain = 10 ** ((peak_db - peak) / 20.0)
    st = fade_out_st if fade_out_st is not None else max(dur_s - 2, 0)
    d = min(2.0, max(dur_s - st, 0)) if st < dur_s else 0.0
    af = f'volume={gain:.4f},afade=t=in:d=1.5,afade=t=out:st={st:.2f}:d={d:.2f}'
    seek = []
    if random_offset:
        try:
            r = subprocess.run([FF, '-i', src], capture_output=True, text=True, errors='ignore')
            m = re.search(r'Duration:\s*(\d+):(\d+):([\d.]+)', r.stderr)
            if m:
                src_dur = float(m.group(1)) * 3600 + float(m.group(2)) * 60 + float(m.group(3))
                if src_dur > dur_s + 2:
                    seek = ['-ss', f'{random.uniform(0, src_dur - dur_s):.2f}']
        except Exception:
            pass
    subprocess.run([FF, '-y', *seek, '-stream_loop', '-1', '-i', src, '-t', f'{dur_s:.2f}',
                    '-af', af, '-ar', '24000', '-ac', '1', out_path], capture_output=True)
    return out_path if os.path.exists(out_path) else None


if __name__ == '__main__':
    for mood in PROGS:
        save('piano_' + mood, make_track(PROGS[mood], RHYTHM[mood], seed=hash(mood) % 100))
    print('  [music] library ready in', OUT_DIR)
