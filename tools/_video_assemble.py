"""ForChi video assembler - ffmpeg: 9:16 shorts with hard cuts, word captions, watermark, music.

Inputs:
  - phrase wavs (from _video_voice.py) + their durations
  - picked clips (from _video_stitch.py)
  - a phrase/word timing manifest

Output: temp_media/<name>.mp4 (1080x1920, h264)
"""
import os, subprocess, json, re, shutil
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
# reference caption style = script/handwritten bold-italic font (Ink Free / Segoe Script)
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\Inkfree.ttf',
    r'C:\Windows\Fonts\segoesc.ttf',
    r'C:\Windows\Fonts\ariblk.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
WATERMARK = 'Victor Moore'
MAX_SEC = 50.0  # hard cap for YouTube Shorts

# map font file -> libass family name
FONT_FAMILY = {
    r'C:\Windows\Fonts\Inkfree.ttf': 'Ink Free',
    r'C:\Windows\Fonts\segoesc.ttf': 'Segoe Script',
    r'C:\Windows\Fonts\ariblk.ttf': 'Arial Black',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf': 'DejaVu Sans',
}
FONTNAME = 'Ink Free'


def probe_dur(path):
    r = subprocess.run([FF, '-i', path], capture_output=True, text=True, errors='ignore')
    m = re.search(r'Duration:\s*([\d:.]+)', r.stderr)
    if not m:
        return 0.0
    hh, mm, ss = m.group(1).split(':')
    return float(hh) * 3600 + float(mm) * 60 + float(ss)


def word_timings(phrase, phrase_start, phrase_dur, lead=0.12):
    """Proportional word timings within a phrase. Returns [{word,start,end}]."""
    words = phrase.split()
    if not words:
        return []
    total = sum(len(w) for w in words)
    out = []
    t = phrase_start + lead
    for w in words:
        frac = len(w) / total
        dur = phrase_dur * frac
        out.append({'word': w, 'start': t, 'end': t + dur})
        t += dur
    return out


def build_ass(phrases, phrase_starts, phrase_durs, ass_path, fontsize=62):
    """Build an .ass subtitle file - reference style: SINGLE WORD per event, lowercase,
    no punctuation, script font, white fill + subtle drop shadow, lower-third."""
    import re as _re
    header = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,"
        " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,"
        " Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: VM, {FONTNAME}, {fontsize}, &H00FFFFFF, &H000000FF, &H00000000, &H00000000, 0, 0, 0, 0,"
        f" 100, 100, 1, 0, 1, 1, 1, 2, 60, 60, 300, 1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = [header]
    for i, phrase in enumerate(phrases):
        wt = word_timings(phrase, phrase_starts[i], phrase_durs[i])
        for w in wt:
            word = w['word'].lower()
            word = _re.sub(r'[^a-z0-9\x27]', '', word)  # strip punctuation, keep letters
            if not word:
                continue
            s = _ass_ts(w['start'])
            e = _ass_ts(w['end'])
            lines.append(f"Dialogue: 0,{s},{e},VM,,0,0,0,,{_ass_escape(word)}")
    with open(ass_path, 'w', encoding='utf-8-sig') as f:
        f.write('\n'.join(lines))


def _ass_ts(sec):
    hh = int(sec // 3600)
    mm = int((sec % 3600) // 60)
    ss = sec % 60
    return f"{hh}:{mm:02d}:{ss:05.2f}"


def _ass_escape(s):
    return s.replace('{', '(').replace('}', ')').replace(',', ' ')


def make_music_bed(dur_s, out_path, seed=7):
    """Generate a subtle ambient drone bed (detuned sines + soft noise, lowpassed)."""
    subprocess.run(
        [FF, '-y', '-f', 'lavfi',
         '-i', f'sine=frequency=110:duration={dur_s}:sample_rate=24000',
         '-f', 'lavfi', '-i', f'sine=frequency=110.8:duration={dur_s}:sample_rate=24000',
         '-f', 'lavfi', '-i', f'anoisesrc=color=pink:amplitude=0.05:duration={dur_s}:seed={seed}:sample_rate=24000',
         '-filter_complex',
         '[0:a][1:a]amix=inputs=2:duration=first[drone];'
         '[drone][2:a]amix=inputs=2:duration=first[m];'
         '[m]lowpass=f=500,volume=0.16,afade=t=in:d=1.5,afade=t=out:st=' + str(max(dur_s - 2, 0)) + ':d=2[out]',
         '-map', '[out]', '-ar', '24000', '-ac', '1', out_path], capture_output=True)
    return out_path


def assemble(phrases, phrase_wavs, clips, out_name, music=True, watermark=True, seed=42, music_track=None, instrumental=None):
    """Produce the final mp4.
    phrases: [text]; phrase_wavs: [wav path]; clips: [dict with 'path'] (same length as phrases)
    music_track: optional explicit piano-lib track name (e.g. 'piano_romantic') to override mood pick.
    instrumental: optional explicit instrumental file path (from .instrumental) to force one track.
    """
    work = r'c:\Users\hp\forchi\temp_media\assemble_build'
    os.makedirs(work, exist_ok=True)

    # copy the script font into the work dir -> relative fontfile (no path escaping)
    global FONTNAME
    font_ok = False
    for cand in FONT_CANDIDATES:
        if os.path.exists(cand):
            try:
                shutil.copy(cand, os.path.join(work, 'font.ttf'))
                FONTNAME = FONT_FAMILY.get(cand, 'Ink Free')
                font_ok = True
                break
            except Exception:
                continue
    if not font_ok:
        print('  [asm] WARNING: no script font found; captions may fall back', flush=True)

    # 1. phrase durations + 0.35s inter-phrase gap; compute starts
    durs = [probe_dur(w) for w in phrase_wavs]
    gap = 0.35
    TAIL = 2.0  # seconds of silence after the final word (clean closure)
    starts = []
    t = 0.0
    for d in durs:
        starts.append(t)
        t += d + gap
    total = (t - gap + TAIL) if durs else 0.0

    # 2. build per-phrase video segments (clip looped/trimmed to phrase duration + small pad)
    segs = []
    for i, (clip, dur) in enumerate(zip(clips, durs)):
        seg_dur = dur + 0.20  # tiny pad so cuts breathe
        if i == len(durs) - 1:
            seg_dur += TAIL  # hold the final frame through the 2s closure silence
        seg = os.path.join(work, f'seg{i}.mp4')
        subprocess.run(
            [FF, '-y', '-stream_loop', '-1', '-i', clip['path'], '-t', f'{seg_dur:.2f}',
             '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
             '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', seg], capture_output=True)
        segs.append(seg)
        print(f'  [asm] seg {i} dur {seg_dur:.2f}s ({clip["file"]})', flush=True)

    # concat video segments
    with open(os.path.join(work, 'vlist.txt'), 'w') as f:
        for s in segs:
            f.write(f"file '{s}'\n")
    with open(os.path.join(work, 'vlist.txt')) as f:
        txt = f.read().replace('\\', '/')
    with open(os.path.join(work, 'vlist.txt'), 'w') as f:
        f.write(txt)
    vcat = os.path.join(work, 'vcat.mp4')
    subprocess.run([FF, '-y', '-f', 'concat', '-safe', '0', '-i', os.path.join(work, 'vlist.txt'),
                    '-c', 'copy', vcat], capture_output=True)

    # 3. narration audio: 0.35s gap between phrases, 2.0s trailing silence after final word (closure)
    sil = os.path.join(work, 'sil.wav')
    subprocess.run([FF, '-y', '-f', 'lavfi', '-i', f'anullsrc=r=24000:cl=mono',
                    '-t', f'{gap}', '-c:a', 'pcm_s16le', sil], capture_output=True)
    sil_tail = os.path.join(work, 'sil_tail.wav')
    subprocess.run([FF, '-y', '-f', 'lavfi', '-i', f'anullsrc=r=24000:cl=mono',
                    '-t', f'{TAIL}', '-c:a', 'pcm_s16le', sil_tail], capture_output=True)
    with open(os.path.join(work, 'alist.txt'), 'w') as f:
        for i, w in enumerate(phrase_wavs):
            f.write(f"file '{w}'\n")
            f.write(f"file '{sil_tail}'\n" if i == len(phrase_wavs) - 1 else f"file '{sil}'\n")
    with open(os.path.join(work, 'alist.txt')) as f:
        txt = f.read().replace('\\', '/')
    with open(os.path.join(work, 'alist.txt'), 'w') as f:
        f.write(txt)
    narr = os.path.join(work, 'narr.wav')
    subprocess.run([FF, '-y', '-f', 'concat', '-safe', '0', '-i', os.path.join(work, 'alist.txt'),
                    '-c', 'copy', narr], capture_output=True)

    # 4a. narration level: deterministic PEAK GAIN (NO loudnorm - it drops ~3s of audio in ffmpeg 7.1).
    NARR_GAIN = 'volume=1.0'
    try:
        meas = subprocess.run([FF, '-i', narr, '-af', 'volumedetect', '-f', 'null', '-'],
                              capture_output=True, text=True, errors='ignore')
        peak = None
        for l in meas.stderr.splitlines():
            if 'max_volume' in l:
                peak = float(l.split(':')[1].strip().replace(' dB', ''))
        if peak is not None:
            gain_db = -1.5 - peak  # boost to ~-1.5 dBFS
            NARR_GAIN = f'volume={gain_db:.2f}dB,alimiter=limit=0.95'
            print(f'  [asm] narr peak {peak:.1f}dB -> gain {gain_db:+.1f}dB', flush=True)
    except Exception as e:
        print(f'  [asm] gain measure failed: {str(e)[:40]}', flush=True)

    # 4. subtitles (.ass word-by-word)
    ass = os.path.join(work, 'subs.ass')
    build_ass(phrases, starts, durs, ass)

    # 5. music bed (optional) - AI instrumental (media/instrumental) or piano library
    audio_inputs = ['-i', narr]
    if music:
        bed = os.path.join(work, 'bed.wav')
        # music keeps playing at full level after the voice stops, fading only in the last second
        fade_st = max(total - 1.0, 0)
        try:
            from _video_music import pick_instrumental, pick_for_phrases, build_bed
            if instrumental:
                build_bed(instrumental, total, bed, fade_out_st=fade_st)
                print(f'  [asm] music: forced instrumental {os.path.basename(instrumental)} -> bed', flush=True)
            elif music_track:
                build_bed(os.path.join(r'c:\Users\hp\forchi\media\music', music_track + '.wav'), total, bed, fade_out_st=fade_st)
                print(f'  [asm] music: {music_track} -> bed', flush=True)
            else:
                instr = pick_instrumental()
                if instr:
                    build_bed(instr, total, bed, fade_out_st=fade_st)
                    print(f'  [asm] music: instrumental {os.path.basename(instr)} -> bed', flush=True)
                else:
                    piano = pick_for_phrases(phrases)
                    build_bed(piano, total, bed, fade_out_st=fade_st)
                    print(f'  [asm] music: {os.path.basename(piano)} -> bed', flush=True)
        except Exception as e:
            print(f'  [asm] music fallback (drone): {str(e)[:60]}', flush=True)
            make_music_bed(total, bed, seed=seed)
        audio_inputs += ['-i', bed]

    # 6. final assembly: video concat + subtitles + watermark + audio mix
    #    Run from cwd=work so subtitles=subs.ass is a relative path (no Windows-colon escaping).
    out = rf'c:\Users\hp\forchi\temp_media\{out_name}.mp4'
    vf = "subtitles=subs.ass"
    if watermark:
        # reference style: watermark top-LEFT, extra small, lowercase, static, low opacity
        vf += ",drawtext=fontfile=font.ttf:text=Victor Moore:fontsize=18:fontcolor=white@0.5:"
        vf += "x=40:y=40:shadowcolor=black@0.5:shadowx=0:shadowy=1"
    if music:
        cmd = [FF, '-y', '-i', vcat] + audio_inputs + [
            '-filter_complex',
            f'[0:v]{vf}[v];[1:a]{NARR_GAIN}[narr];'
            f'[2:a]volume=0.7[bed];'
            f'[narr][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]',
            '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-t', f'{MAX_SEC}', '-shortest', out]
    else:
        cmd = [FF, '-y', '-i', vcat, '-i', narr,
               '-filter_complex',
               f'[0:v]{vf}[v];[1:a]{NARR_GAIN}[a]',
               '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
               '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-t', f'{MAX_SEC}', '-shortest', out]
    r = subprocess.run(cmd, capture_output=True, text=True, errors='ignore', cwd=work)
    for line in (r.stderr or '').splitlines()[-6:]:
        print('  [asm]', line)
    if os.path.exists(out):
        print('  [asm] WROTE', out, f'{os.path.getsize(out)//1024}KB dur {probe_dur(out):.1f}s')
        # mp3 sidecar for local preview (VS Code can't play AAC-in-mp4)
        mp3 = out.rsplit('.', 1)[0] + '.mp3'
        subprocess.run([FF, '-y', '-i', out, '-map', '0:a', '-c:a', 'libmp3lame',
                        '-b:a', '192k', '-ar', '44100', '-ac', '2', mp3], capture_output=True)
        if os.path.exists(mp3):
            print('  [asm] WROTE mp3 preview', mp3, f'{os.path.getsize(mp3)//1024}KB')
    else:
        print('  [asm] FAILED rc', r.returncode)
    return out


if __name__ == '__main__':
    import sys
    # quick demo: use an existing render if present
    parts = r'c:\Users\hp\forchi\temp_media\higgs_parts'
    if os.path.exists(parts):
        import glob
        from _video_voice import split_phrases
        from _video_stitch import pick_clips
        script = ("We love to believe that evil is a monster, born in the dark. "
                  "But the truth of human nature is far more terrifying. "
                  "The most dangerous darkness does not come from the wicked. "
                  "It comes from the exact moment a good person finally decides to let go of their morals. "
                  "Because when the righteous finally fall, they teach the rest of us exactly what hell looks like.")
        phrases = split_phrases(script)
        wavs = [os.path.join(parts, f'p{i}.wav') for i in range(1, len(phrases) + 1)]
        clips = pick_clips(phrases, seed=42)
        out = assemble(phrases, wavs, clips, 'higgs_evil_short', music=True)
        print('DONE', out)
