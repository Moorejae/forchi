"""V10 replication assembler — fixed-duration frame-by-frame replication.

Holds each still for the REFERENCE video's exact cut duration, hard cuts, and
overlays the reference's on-screen labels + bottom text programmatically (so
text is always LEGIBLE — no AI-gibberish). Voice = per-scene narration aligned
to each scene slot. No keystrokes, no music.

Usage:
    .venv\\Scripts\\python.exe tools/_v10_repl_assemble.py [out_name] [--to-downloads]
"""
import os, sys, json, subprocess, re, shutil, wave, struct
import imageio_ffmpeg
from _paths import BASE

FF = (os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe())
W, H = 1920, 1080
FPS = 30
SR = 24000

CARD_FONTS = [
    r'C:\Windows\Fonts\ariblk.ttf',   # Arial Black
    r'C:\Windows\Fonts\segoeuib.ttf', # Segoe UI Bold
    r'C:\Windows\Fonts\Inkfree.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]


def _rgb(v, default):
    """Accept 'r,g,b' string or tuple; fall back to default."""
    if v is None:
        return default
    if isinstance(v, (tuple, list)):
        return tuple(int(x) for x in v[:3])
    try:
        parts = str(v).split(",")
        return tuple(int(p.strip()) for p in parts[:3])
    except Exception:
        return default


def make_card_image(text, out_path, accent=None, dark=False, bg=None, fg=None, bar=None):
    """Full-bleed punch card: big bold text on an EMPTY background.
    dark=True -> black bg/white text; else light. bg/fg/bar can override
    (accepts 'r,g,b' strings) e.g. cream bg + yellow bar for light mode."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("  [replasm] PIL not available for punch cards; falling back to blank")
        from PIL import Image  # will re-raise if missing
        raise
    bg = _rgb(bg, (18, 18, 18) if dark else (255, 255, 255))
    fg = _rgb(fg, (255, 255, 255) if dark else (20, 20, 20))
    acc = _rgb(accent, (200, 30, 40))
    bar = _rgb(bar, acc)
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    font = None
    for cand in CARD_FONTS:
        if os.path.exists(cand):
            try:
                font = ImageFont.truetype(cand, 150)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()
    lines = str(text).split("\n")
    # measure total block
    line_h = 170
    block_h = line_h * len(lines)
    y0 = (H - block_h) / 2
    for i, ln in enumerate(lines):
        bbox = d.textbbox((0, 0), ln, font=font)
        tw = bbox[2] - bbox[0]
        x = (W - tw) / 2
        y = y0 + i * line_h
        d.text((x, y), ln, font=font, fill=fg)
    # accent bar under the block
    bar_w = 220
    bar_y = y0 + block_h + 30
    d.rectangle([(W - bar_w) / 2, bar_y, (W + bar_w) / 2, bar_y + 12], fill=bar)
    img.save(out_path)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\Inkfree.ttf',
    r'C:\Windows\Fonts\segoesc.ttf',
    r'C:\Windows\Fonts\ariblk.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]

def probe_dur(p):
    r = subprocess.run([FF, "-i", p], capture_output=True, text=True, errors="ignore")
    m = re.search(r"Duration:\s*([\d:.]+)", r.stderr)
    if not m:
        return 0.0
    hh, mm, ss = m.group(1).split(":")
    return float(hh) * 3600 + float(mm) * 60 + float(ss)

def esc(s):
    return s.replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")


# ---- MICRO-FRAME SFX LAYER (research: tick/whoosh/thud/chime at frame boundaries) ----
def _synth_tone(out, freq, dur, vol, decay):
    fade = min(0.6, dur)
    st = max(0.0, dur - fade)
    subprocess.run(
        [FF, "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={dur}",
         "-af", (f"volume={vol},afade=t=out:st={st:.3f}:d={fade:.3f},"
                 f"aformat=sample_rates=24000:channel_layouts=mono"),
         "-ar", "24000", "-ac", "1", out],
        capture_output=True, text=True, errors="ignore")


def _synth_whoosh(out, dur, vol):
    subprocess.run(
        [FF, "-y", "-f", "lavfi", "-i", f"anoisesrc=colour=pink:duration={dur}:amplitude={vol}",
         "-af", (f"highpass=f=300,lowpass=f=1400,afade=t=in:d=0.15,afade=t=out:st={max(0.0, dur - 0.15):.3f}:d=0.15,"
                 f"aformat=sample_rates=24000:channel_layouts=mono"),
         "-ar", "24000", "-ac", "1", out],
        capture_output=True, text=True, errors="ignore")


def build_sfx_track(events, work, out):
    """Place each sfx event at its absolute timestamp via adelay + amix. Returns True on success."""
    if not events:
        return False
    inputs, fc = [], []
    for i, (ts, kind, vol) in enumerate(events):
        w = os.path.join(work, f"sfx{i}_{kind}.wav")
        if kind == "tick":
            _synth_tone(w, 1500, 0.10, vol, 4)
        elif kind == "thud":
            _synth_tone(w, 95, 0.22, vol, 8)
        elif kind == "chime":
            _synth_tone(w, 880, 0.9, vol, 6)
        elif kind == "whoosh":
            _synth_whoosh(w, 0.5, vol)
        else:
            _synth_tone(w, 500, 0.15, vol, 5)
        if not os.path.exists(w) or os.path.getsize(w) == 0:
            continue
        inputs += ["-i", w]
        idx = (len(inputs) // 2) - 1   # inputs list holds "-i", path pairs
        ms = int(ts * 1000)
        # mono source -> all=1 avoids the `|` filter-graph separator (500|500 would break parsing)
        fc.append(f"[{idx}:a]adelay={ms}:all=1[e{idx}]")
    if not fc:
        return False
    n_in = len(inputs) // 2
    mixin = "".join(f"[e{i}]" for i in range(n_in))
    fc.append(f"{mixin}amix=inputs={n_in}:duration=longest:normalize=0[sfx]")
    subprocess.run([FF, "-y", *inputs, "-filter_complex", ";".join(fc),
                    "-map", "[sfx]", "-ar", "24000", "-ac", "1", out],
                   capture_output=True, text=True, errors="ignore")
    return os.path.exists(out) and os.path.getsize(out) > 0


def assemble(manifest_path, images_dir, wavs_dir, out_name, to_downloads=True, cards=None, plan=None,
             no_overlays=False, kenburns=True, sfx=True):
    with open(manifest_path, encoding="utf-8") as f:
        m = json.load(f)
    scenes = m["scenes"]
    work = os.path.join(BASE, "temp_media", "v10_repl_build")
    os.makedirs(work, exist_ok=True)
    if no_overlays:
        cards = []  # no punch cards / captions in this mode
    plan_by_scene = {}
    if plan:
        for ps in plan.get("scenes", []):
            plan_by_scene[ps["scene"]] = ps["plan"]
        print(f"  [replasm] shot plan loaded: {len(plan_by_scene)} scenes planned")
    # scenes with NO available images -> drop from BOTH video and audio
    drop_scenes = set()
    for sc in range(1, len(scenes) + 1):
        has = any(os.path.exists(os.path.join(images_dir, f"rep_{sc:02d}_{j:02d}.png")) for j in range(1, 9))
        if not has:
            drop_scenes.add(sc)
    if drop_scenes:
        print(f"  [replasm] dropping scenes with no frames (video+audio): {sorted(drop_scenes)}")

    # font for drawtext (relative path, avoids Windows-colon escaping)
    font_rel = None
    for cand in FONT_CANDIDATES:
        if os.path.exists(cand):
            shutil.copy(cand, os.path.join(work, "font.ttf"))
            font_rel = "font.ttf"
            break
    if not font_rel:
        print("  [replasm] WARNING: no font found")
        return None

    HOLD_EMPTY = 0.45  # short visual beat for shots with no narration (keeps voice==video)
    # 0. flatten scenes x shots; per scene, one continuous narration phrase
    shots = []
    for i, s in enumerate(scenes):
        scene_words = sum(len(sh.get("text", "").split()) for sh in s["shots"])
        for j, sh in enumerate(s["shots"]):
            shots.append({"scene": i + 1, "shot": j + 1, "s": s, "sh": sh,
                          "words": len(sh.get("text", "").split()), "scene_words": scene_words})
    print(f"  [replasm] {len(shots)} shots ({len(scenes)} scenes) — natural word-proportional sync")

    # 1. per-SHOT still segments: text shots hold proportional to their words of the
    #    scene's phrase; empty shots = short visual holds. No forced gaps.
    #    PUNCH CARDS: a critical word/phrase gets a full-bleed text card on an EMPTY
    #    background for ~card.dur seconds at the start of its shot, then the scene.
    cards_by_shot = {}
    if cards:
        for c in cards:
            cards_by_shot[(int(c["scene"]), int(c["shot"]))] = c

    segs = []
    starts = []
    durs = []
    seg_owner = []   # shot index for each segment (None = punch card)
    seg_plan = []    # True when segment comes from the director's shot plan
    t = 0.0

    def add_seg(img_path, dur, shot_k, is_card, is_plan=False):
        nonlocal t
        seg = os.path.join(work, f"seg{len(segs)}.mp4")
        # SLOW KEN BURNS (research: 1.0x -> ~1.08x) — upscale 2x, zoompan, down to target.
        # Output is capped by -t (timestamp-exact) so total video == narration (no drift);
        # d is generous so the zoom always has frames to accumulate across.
        kb = ""
        if kenburns:
            kb = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,"
                  f"crop={W * 2}:{H * 2},"
                  f"zoompan=z='min(zoom+0.0008,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                  f"d={max(2, int(dur * FPS) + 2)}:s={W}x{H}:fps={FPS},")
        subprocess.run(
            [FF, "-y", "-loop", "1", "-framerate", str(FPS), "-i", img_path,
             "-vf", kb + f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p",
             "-t", f"{dur:.2f}",
             "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", seg],
            capture_output=True)
        segs.append(seg)
        starts.append(t)
        durs.append(dur)
        seg_owner.append(None if is_card else shot_k)
        seg_plan.append(is_plan)
        t += dur

    # Per-scene timing: the visual timeline MUST equal the narration wav duration EXACTLY
    # (prevents drift/misplaced frames). Only shots with narration words get a hold;
    # empty shots are skipped (they were the "dead frames").
    scene_dur = {}
    scene_text_words = {}
    for st in shots:
        sc = st["scene"]
        if sc not in scene_dur:
            scene_dur[sc] = probe_dur(os.path.join(wavs_dir, f"r{sc:02d}.wav"))
            scene_text_words[sc] = 0
        if st["words"] > 0:
            scene_text_words[sc] += st["words"]

    planned_scenes = set()
    for k, st in enumerate(shots):
        sc = st["scene"]
        if sc in planned_scenes:
            continue
        pd = scene_dur.get(sc, HOLD_EMPTY)
        if sc in plan_by_scene:
            # ---- DIRECTOR-PLAN MODE ----
            planned_scenes.add(sc)
            plan_segs = plan_by_scene[sc]
            raw = []
            for seg in plan_segs:
                frame = int(seg.get("frame") or 1)
                img = os.path.join(images_dir, f"rep_{sc:02d}_{frame:02d}.png")
                if not os.path.exists(img):
                    img = None
                    for j in range(1, 9):
                        cand = os.path.join(images_dir, f"rep_{sc:02d}_{j:02d}.png")
                        if os.path.exists(cand):
                            img = cand
                            break
                if img:
                    raw.append({"img": img, "hold": max(0.4, float(seg.get("hold") or 0.4)),
                                "text": str(seg.get("text") or ""), "card": seg.get("card") or None})
            if not raw:
                continue
            # normalize holds to EXACTLY match the narration wav duration (no drift)
            tot = sum(r["hold"] for r in raw)
            if tot > 0 and pd and pd > 0:
                for r in raw:
                    r["hold"] = max(0.4, r["hold"] * pd / tot)
                s2 = sum(r["hold"] for r in raw)
                raw[-1]["hold"] = max(0.4, raw[-1]["hold"] + (pd - s2))
            # punch cards (scene-keyed) pop at word offset inside the matching segment
            cards_scene = [c for c in (cards or []) if int(c["scene"]) == sc]
            for card in cards_scene:
                w = str(card.get("word", "")).lower()
                for r in raw:
                    words = re.findall(r"\S+", r["text"].lower())
                    idx = next((i for i, wd in enumerate(words) if w and w in wd), None)
                    if idx is None or not words:
                        continue
                    before = r["hold"] * idx / len(words)
                    if before < 0.12:
                        before = 0.0
                    card_dur = min(float(card.get("dur", 1.3)), max(0.5, r["hold"] - before - 0.1))
                    after = max(0.0, r["hold"] - before - card_dur)
                    card_img = os.path.join(work, f"cardp{sc}.png")
                    make_card_image(card.get("text", "!"), card_img,
                                    accent=card.get("accent"), dark=bool(card.get("dark")),
                                    bg=card.get("bg"), fg=card.get("fg"), bar=card.get("bar"))
                    if before > 0:
                        add_seg(r["img"], before, k, False, True)
                    add_seg(card_img, card_dur, k, True, True)
                    if after > 0.15:
                        add_seg(r["img"], after, k, False, True)
                    r["_carded"] = True
                    print(f"  [replasm] plan punch scene{sc}: {card.get('text','')[:40]} "
                          f"@word{idx}/{len(words)} ({card_dur:.1f}s)", flush=True)
                    break
            for r in raw:
                if r.get("_carded"):
                    continue
                add_seg(r["img"], r["hold"], k, False, True)
            print(f"  [replasm] plan scene{sc}: {len(raw)} segments (wav {pd:.1f}s)", flush=True)
            continue
        tw = scene_text_words.get(sc, 0)
        if st["words"] > 0 and tw > 0:
            hold = pd * st["words"] / tw
        else:
            continue  # empty shot -> no visual (kills dead frames + drift)
        img = os.path.join(images_dir, f"rep_{st['scene']:02d}_{st['shot']:02d}.png")
        if not os.path.exists(img):
            for jj in range(1, 9):
                cand = os.path.join(images_dir, f"rep_{st['scene']:02d}_{jj:02d}.png")
                if os.path.exists(cand):
                    img = cand
                    break
        card = cards_by_shot.get((st["scene"], st["shot"]))
        if card and os.path.exists(img):
            # Place the card at the exact spoken phrase: find its word offset in the shot
            # text, so the card pops when the narrator SAYS it (not at shot start).
            phrase_word = str(card.get("word", "")).lower()
            shot_words = re.findall(r"\S+", st["sh"].get("text", "").lower())
            total_w = len(shot_words)
            idx = next((i for i, w in enumerate(shot_words) if phrase_word and phrase_word in w), None)
            fraction = (idx / total_w) if (idx is not None and total_w > 0) else 0.0
            before = hold * fraction
            if before < 0.12:
                before = 0.0
            card_dur = min(float(card.get("dur", 1.3)), max(0.5, hold - before - 0.1))
            after = max(0.0, hold - before - card_dur)
            card_img = os.path.join(work, f"card{k}.png")
            make_card_image(card.get("text", "!"), card_img,
                            accent=card.get("accent"), dark=bool(card.get("dark")),
                            bg=card.get("bg"), fg=card.get("fg"), bar=card.get("bar"))
            if before > 0:
                add_seg(img, before, k, False)
            add_seg(card_img, card_dur, k, True)
            if after > 0.15:
                add_seg(img, after, k, False)
            print(f"  [replasm] punch card scene{st['scene']} shot{st['shot']}: {card.get('text','')[:40]} "
                  f"@word{idx}/{total_w} ({card_dur:.1f}s)", flush=True)
        else:
            add_seg(img, hold, k, False)
    total = t
    print(f"  [replasm] natural durations (total {total:.1f}s)")

    # ---- MICRO-FRAME SFX LAYER: plan sound events at micro-frame boundaries ----
    sfx_events = []
    if sfx:
        try:
            by_scene = {}
            for si, owner in enumerate(seg_owner):
                if owner is None:
                    continue
                by_scene.setdefault(shots[owner]["scene"], []).append(si)
            last_scene = max(by_scene) if by_scene else None
            for sc, idxs in by_scene.items():
                if not idxs:
                    continue
                for si in idxs:
                    ts = starts[si]
                    if ts < 0.2:
                        continue
                    if sc == last_scene and si == idxs[-1]:
                        sfx_events.append((ts, "chime", 0.12))     # final scene climax
                    elif si == idxs[-1]:
                        sfx_events.append((ts, "thud", 0.08))      # scene climax
                    elif si == idxs[0]:
                        sfx_events.append((ts, "whoosh", 0.10))    # scene boundary
                    else:
                        sfx_events.append((ts, "tick", 0.05))      # micro-frame mutation
            print(f"  [replasm] sfx: {len(sfx_events)} micro-frame sound events", flush=True)
        except Exception as e:
            print(f"  [replasm] sfx planning failed (continuing without): {e}", flush=True)
            sfx_events = []
    vlist = os.path.join(work, "vlist.txt")
    with open(vlist, "w") as f:
        for s in segs:
            f.write("file '" + s.replace("\\", "/") + "'\n")
    vcat = os.path.join(work, "vcat.mp4")
    r = subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", vlist, "-c", "copy", vcat],
                       capture_output=True)
    if not os.path.exists(vcat):
        subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", vlist,
                        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", vcat], capture_output=True)
    print(f"  [replasm] video concat OK ({total:.1f}s, {os.path.getsize(vcat)//1024}KB)")

    # 2. narration = ONE continuous phrase per scene, back-to-back (no silence gaps)
    #    IMPORTANT: use ABSOLUTE paths in alist (concat demuxer resolves relative paths
    #    against the LIST FILE's dir, not cwd) and remove stale narr.wav so a failed
    #    concat can never silently reuse old audio. Scenes with no frames are dropped.
    alist = []
    for i, s in enumerate(scenes, 1):
        if i in drop_scenes:
            continue
        wav = os.path.join(wavs_dir, f"r{i:02d}.wav")
        alist.append("file '" + os.path.abspath(wav).replace("\\", "/") + "'\n")
    with open(os.path.join(work, "alist.txt"), "w") as f:
        f.writelines(alist)
    narr = os.path.join(work, "narr.wav")
    if os.path.exists(narr):
        os.remove(narr)
    nrun = subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(work, "alist.txt"),
                           "-c", "copy", narr], capture_output=True, text=True, errors="ignore")
    if nrun.returncode != 0 or not os.path.exists(narr):
        print("  [replasm] NARRATION CONCAT FAILED", (nrun.stderr or "")[-400:])
        return None
    print(f"  [replasm] continuous narration built ({os.path.getsize(narr)//1024}KB)")

    # 3. narration gain (peak, deterministic — no loudnorm)
    narr_gain = "volume=1.0"
    try:
        meas = subprocess.run([FF, "-i", narr, "-af", "volumedetect", "-f", "null", "-"],
                              capture_output=True, text=True, errors="ignore")
        peak = None
        for l in meas.stderr.splitlines():
            if "max_volume" in l:
                peak = float(l.split(":")[1].strip().replace(" dB", ""))
        if peak is not None:
            g = -1.5 - peak
            narr_gain = f"volume={g:.2f}dB,alimiter=limit=0.95"
            print(f"  [replasm] narr peak {peak:.1f}dB -> gain {g:+.1f}dB")
    except Exception:
        pass

    # 4. drawtext overlays — labels/bottom attached to their specific SHOT segment windows.
    #    (Punch-card segments own no overlay; the card carries its own text.)
    vf = []
    if not no_overlays:
        for si, owner in enumerate(seg_owner):
            if owner is None:
                continue
            st = shots[owner]
            s = st["s"]
            plan_mode = seg_plan[si]
            s0, s1 = starts[si], starts[si] + durs[si]
            show_label = plan_mode or ((not s.get("label_shot")) or s.get("label_shot") == st["shot"])
        labels = []
        if s.get("label") and show_label:
            labels.append((s["label"], 0))
        if s.get("label2") and show_label:
            labels.append((s["label2"], 1))
        if s.get("label3") and show_label:
            labels.append((s["label3"], 2))
        for (txt, idx) in labels:
            y = 90 + idx * 90
            vf.append(
                f"drawtext=fontfile={font_rel}:text='{esc(txt)}':fontsize=64:fontcolor=white:"
                f"borderw=6:bordercolor=black@0.9:x=(w-text_w)/2:y={y}:"
                f"enable='between(t,{s0:.2f},{s1:.2f})'")
        if s.get("bottom") and (plan_mode or (not s.get("bottom_shot") or s.get("bottom_shot") == st["shot"])):
            vf.append(
                f"drawtext=fontfile={font_rel}:text='{esc(s['bottom'])}':fontsize=40:fontcolor=white:"
                f"borderw=4:bordercolor=black@0.85:line_spacing=8:x=(w-text_w)/2:y=h-200:"
                f"enable='between(t,{s0:.2f},{s1:.2f})'")
    vfstr = ",".join(vf) if vf else "null"

    # 5. final mux
    out_dir = os.path.join(BASE, "temp_media")
    out = os.path.join(out_dir, f"{out_name}.mp4")
    sfx_path = os.path.join(work, "sfx.wav")
    has_sfx = False
    if sfx and sfx_events:
        try:
            has_sfx = build_sfx_track(sfx_events, work, sfx_path)
        except Exception as e:
            print(f"  [replasm] sfx render failed (continuing without): {e}", flush=True)
            has_sfx = False
    if has_sfx:
        cmd = [FF, "-y", "-i", vcat, "-i", narr, "-i", sfx_path,
               "-filter_complex",
               f"[0:v]{vfstr}[v];[1:a]{narr_gain}[na];[2:a]volume=0.9[sf];"
               f"[na][sf]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.97[a]",
               "-map", "[v]", "-map", "[a]",
               "-c:v", "libx264", "-crf", "19", "-preset", "veryfast",
               "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", out]
    else:
        cmd = [FF, "-y", "-i", vcat, "-i", narr,
               "-filter_complex",
               f"[0:v]{vfstr}[v];[1:a]{narr_gain}[a]",
               "-map", "[v]", "-map", "[a]",
               "-c:v", "libx264", "-crf", "19", "-preset", "veryfast",
               "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", out]
    rr = subprocess.run(cmd, capture_output=True, text=True, errors="ignore")
    if not os.path.exists(out):
        print("  [replasm] FAILED", (rr.stderr or "")[-400:])
        return None
    print(f"  [replasm] WROTE {out} ({os.path.getsize(out)//1024}KB, {probe_dur(out):.1f}s)")
    mp3 = out.rsplit(".", 1)[0] + ".mp3"
    subprocess.run([FF, "-y", "-i", out, "-map", "0:a", "-c:a", "libmp3lame", "-b:a", "192k",
                    "-ar", "44100", "-ac", "2", mp3], capture_output=True)
    if to_downloads:
        dl = os.path.join(os.path.expanduser("~"), "Downloads")
        try:
            os.makedirs(dl, exist_ok=True)
            shutil.copy2(out, os.path.join(dl, os.path.basename(out)))
            if os.path.exists(mp3):
                shutil.copy2(mp3, os.path.join(dl, os.path.basename(mp3)))
            print(f"  [replasm] COPIED to {dl}")
        except Exception as e:
            # A convenience copy must NEVER fail the build (e.g. no ~/Downloads on the VPS).
            print(f"  [replasm] Downloads copy skipped: {e}")
    return out

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = set(a for a in sys.argv[1:] if a.startswith("--"))
    out_name = args[0] if args else "v10_replication_2min"
    to_dl = "--to-downloads" in flags

    def val(flag, default):
        for i, a in enumerate(sys.argv):
            if a == flag and i + 1 < len(sys.argv):
                return sys.argv[i + 1]
        return default

    manifest = val("--manifest", os.path.join(BASE, "temp_media", "v10_replication3.json"))
    images = val("--images", os.path.join(BASE, "temp_media", "v10_replication3"))
    wavs = val("--wavs", os.path.join(BASE, "temp_media", "v10_repl_voice"))
    cards = None
    cards_path = val("--cards", "")
    if cards_path and os.path.exists(cards_path):
        cards = json.load(open(cards_path, encoding="utf-8"))
        print(f"  [replasm] loaded {len(cards)} punch cards from {cards_path}")
    plan = None
    plan_path = val("--plan", "")
    if plan_path and os.path.exists(plan_path):
        plan = json.load(open(plan_path, encoding="utf-8"))
        print(f"  [replasm] loaded shot plan from {plan_path}")
    assemble(manifest, images, wavs, out_name, to_downloads=to_dl, cards=cards, plan=plan,
             no_overlays="--no-overlays" in flags,
             kenburns="--no-kenburns" not in flags,
             sfx="--no-sfx" not in flags)
