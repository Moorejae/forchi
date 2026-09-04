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
    MIN_WORDS = 75  # ~40-45s spoken slowly; guarantees a proper Short (not a 22s clip)
    if args.generate or not script:
        from _video_script import generate_script_checked
        # Re-generate until the script is long enough. Gemini occasionally returns
        # a short (~40-50 word) draft that would render a ~20s video; the checked
        # generator expands internally, and this extra loop is a hard backstop so
        # a too-short script NEVER gets voiced/uploaded.
        for attempt in range(4):
            script = generate_script_checked(model='gemini-3.6-flash', topic=args.topic,
                                             style=args.style, min_words=MIN_WORDS)
            wc = len(script.split())
            print(f'[run] generated script ({wc} words, style={args.style}):\n{script}\n')
            if wc >= MIN_WORDS:
                break
            print(f'[run] script too short ({wc}w < {MIN_WORDS}w) -> regenerating (try {attempt + 1})', flush=True)
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

    # 2b. enforce max duration — NEVER end mid-poem. The final anchor sentence
    # MUST always play in full, so we trim to fit under the Shorts 58s hard cap
    # (see _video_assemble.MAX_SEC), accounting for the inter-phrase gaps (0.35s)
    # and the 1.5s closure tail the assembler adds. Trim INTERIOR phrases first
    # (keeps the opening hook + the closing anchor); if it still can't fit, drop
    # the OPENING phrase(s) so the last statement is never cut.
    GAP = 0.35      # inter-phrase gap the assembler inserts (matches _video_assemble)
    TAIL = 1.5      # closure tail after the final word (matches _video_assemble)
    CAP = 58.0      # hard cap for YouTube Shorts (matches _video_assemble.MAX_SEC)
    SAFETY = 1.5    # headroom so the video never sits exactly on the cap
    MIN_TOTAL = 28.0  # a Short under 28s looks broken/too short — reject it

    def total_len(ds):
        return sum(ds) + (len(ds) - 1) * GAP + TAIL

    total = total_len(durs)
    print(f'[run] narration {sum(durs):.1f}s, {len(phrases)} phrases -> assembled ~{total:.1f}s')
    # 1) trim interior phrases (keep first + last anchor line)
    while total > CAP - SAFETY and len(phrases) > 2:
        idx = 1 + (len(phrases) - 2) // 2
        phrases.pop(idx)
        wavs.pop(idx)
        durs.pop(idx)
        total = total_len(durs)
        print(f'[run] assembled {total:.1f}s > cap -> trimmed interior to {len(phrases)} phrases')
    # 2) still over: drop the OPENING phrase(s) — the closing anchor must play in full
    while total > CAP - SAFETY and len(phrases) > 1:
        phrases.pop(0)
        wavs.pop(0)
        durs.pop(0)
        total = total_len(durs)
        print(f'[run] assembled {total:.1f}s > cap -> dropped opening phrase (anchor kept)')
    # 3) hard guard: if the final assembled length is still too short to be a real
    #    Short, fail loudly instead of uploading a broken 20s clip.
    if total < MIN_TOTAL:
        raise SystemExit(
            f'[run] assembled length {total:.1f}s < {MIN_TOTAL:.0f}s minimum — script too short '
            f'({len(phrases)} phrases, {sum(durs):.1f}s narration). Not uploading a broken clip.')
    print(f'[run] final narration {sum(durs):.1f}s, {len(phrases)} phrases -> assembled {total:.1f}s')

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
