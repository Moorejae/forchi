"""ForChi video pipeline - produce one Short MP4 end-to-end.

Usage:
  python tools/_video_run.py --script "text..." [--mode clean|whisper|whisper_ref] [--topic X] [--name out] [--no-music] [--seed 42]
  python tools/_video_run.py --generate [--topic X] ...   # generate script via Gemini first
"""
import os, sys, argparse, json

from _paths import BASE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', help='literal script text (or omit for a default)')
    ap.add_argument('--generate', action='store_true', help='generate script via Gemini first')
    ap.add_argument('--topic', default=None)
    ap.add_argument('--style', default=None, choices=[None, 'philosophical', 'romantic'])
    ap.add_argument('--mode', default='clean', choices=['clean', 'whisper', 'whisper_ref'])
    ap.add_argument('--name', default='forchi_short')
    ap.add_argument('--no-music', action='store_true')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--max-len', type=int, default=220)
    args = ap.parse_args()

    # 1. script
    script = args.script
    if args.generate or not script:
        from _video_script import generate_script_checked
        script = generate_script_checked(model='gemini-3.6-flash', topic=args.topic, style=args.style, min_words=60)
        print(f'[run] generated script ({len(script.split())} words, style={args.style}):\n{script}\n')
    if not script:
        script = ("The graveyard is full of words people waited too long to say. "
                  "We hoard tomorrow like it owes us a favour. "
                  "But the shadow does not wait, and the light does not beg. "
                  "Say it now, because silence becomes a second grave.")

    # 2. voice (Higgs)
    from _video_voice import render_script, durations, split_phrases
    parts = os.path.join(BASE, 'temp_media', f'{args.name}_parts')
    res = render_script(script, parts, mode=args.mode, seed=args.seed, max_len=args.max_len)
    phrases = [r['text'] for r in res]
    wavs = [r['wav'] for r in res]
    durs = durations(wavs)

    # 2b. enforce max duration: if narration is too long, trim INTERIOR phrases
    # so the opening AND the final anchor line always survive (never end mid-poem).
    MAX_NARR = 54.0  # slow baritone pace; leaves room under the 58s cap
    total_narr = sum(durs)
    while total_narr > MAX_NARR and len(phrases) > 2:
        # drop a middle interior phrase (keep the first + last sentence)
        idx = 1 + (len(phrases) - 2) // 2
        phrases.pop(idx)
        wavs.pop(idx)
        durs.pop(idx)
        total_narr = sum(durs)
        print(f'[run] narration {total_narr:.1f}s > cap -> trimmed interior to '
              f'{len(phrases)} phrases')
    print(f'[run] narration {total_narr:.1f}s, {len(phrases)} phrases')

    # 3. stitch clips
    from _video_stitch import pick_clips
    clips = pick_clips(phrases, seed=args.seed)
    for c, d in zip(clips, durs):
        print(f'[run]   clip {c["color_temp"]:5} {c["mood"]:12} {d:.1f}s  {c["file"]}')

    # 4. assemble
    from _video_assemble import assemble
    from _video_music import pick_for_phrases
    out = assemble(phrases, wavs, clips, args.name, music=not args.no_music, seed=args.seed)
    print(f'[run] DONE {out}')

    # write a run manifest (script, timing, mood) for the uploader/DB
    try:
        mood = os.path.basename(pick_for_phrases(phrases)).replace('piano_', '').replace('.wav', '')
    except Exception:
        mood = 'reflection'
    manifest = {
        'script': script,
        'mode': args.mode,
        'style': args.style,
        'seed': args.seed,
        'mood': mood,
        'topic': args.topic,
        'phrases': phrases,
        'durations': durs,
        'clips': clips,
        'output': out,
        'duration_total': round(sum(durs), 2),
    }
    with open(os.path.join(BASE, 'temp_media', f'{args.name}_run.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
