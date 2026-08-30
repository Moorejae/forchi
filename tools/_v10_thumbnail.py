"""V10 thumbnail — "Epic Movie Poster" style, 2026-08-30 v3 (from scratch).

CONCEPT (per user):
  * Create an EPIC cinematic scene, like a movie poster — full-frame dramatic
    artwork (not a whiteboard narrator). The scene is generated via Vertex.
  * Then write the CAPTION on top: a bold hook PLUS a readable caption line so
    viewers who can't hear understand what is being said. Use a good bold font
    (Anton for the headline, a clean sans for the caption body).

Design pillars:
  * 1280x720 canvas, FULL-FRAME epic movie-poster scene (Vertex art or a video
    frame), cinematic grade, no text baked into the art.
  * BOTTOM caption band: dark cinematic gradient where the caption + stamp live
    (readable over any scene).
  * HOOK: 2-4 words ALL CAPS in ANTON (ultra-bold), white + RED accent word,
    heavy shadow — top zone.
  * CAPTION: 1-2 line readable sentence (--caption) that tells viewers what's
    being said — mid/bottom, bold sans, so deaf viewers still get the message.
  * SAFE ZONE: bottom-right ~200x90 left clean (YouTube timestamp badge).

Usage:
    .venv\\Scripts\\python.exe tools/_v10_thumbnail.py --art "<epic scene prompt>" \\
        --title "The Danger of Winning" --hook "THE PYRRHIC TRAP" --accent 2 \\
        --caption "He won every battle... and lost everything." \\
        [--out thumb.jpg] [--fontsize 92]
    # or frame mode:
    .venv\\Scripts\\python.exe tools/_v10_thumbnail.py video.mp4 --title "..." --hook "..." --caption "..."
"""
import os, sys, shutil, subprocess, argparse, math, tempfile
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = (os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe())

W, H = 1280, 720
# ---- Movie-poster palette (light text on cinematic dark) ----
WHITE = (255, 255, 255)
RED = (229, 57, 53)            # #E53935 — accent keyword
GOLD = (212, 160, 23)          # #D4A017 — rule / stamp
BLACK = (8, 10, 14)            # #080A0E — deep cinematic
# Ultra-bold display fonts. Anton is the headline (downloaded in temp_media/fonts);
# Montserrat variable renders THIN in PIL so it stays last.
FONT_CANDIDATES = [
    os.path.join(BASE, "temp_media", "fonts", "Anton-Regular.ttf"),
    os.path.join(BASE, "temp_media", "fonts", "BebasNeue-Regular.ttf"),
    r'C:\Windows\Fonts\bahnschrift.ttf',
    r'C:\Windows\Fonts\ariblk.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
# Clean readable bold sans for the CAPTION BODY (deaf-viewer legibility).
CAPTION_FONT_CANDIDATES = [
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\bahnschrift.ttf',
    r'C:\Windows\Fonts\ariblk.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
STOPWORDS = {"the", "of", "a", "an", "and", "or", "to", "for", "in", "on", "with", "how", "why", "is", "are", "it", "that", "this", "your", "you", "at", "by", "from"}


def vertex_python():
    if sys.platform == "win32":
        return os.path.join(BASE, ".venv", "Scripts", "python.exe")
    return os.path.join(BASE, ".venv", "bin", "python")


def has_content(png, min_nonwhite=8000):
    """Detect whether the generated art is a real image (not a blank/white canvas).
    Vertex is non-deterministic and sometimes returns an empty white scene."""
    try:
        im = Image.open(png).convert("RGB")
    except Exception:
        return False
    w, h = im.size
    px = im.load()
    nonwhite = 0
    for x in range(0, w, 4):
        for y in range(0, h, 4):
            r, g, b = px[x, y]
            if not (r > 235 and g > 235 and b > 235):
                nonwhite += 1
    return nonwhite >= min_nonwhite


def generate_art(prompt, out_png, max_attempts=3):
    """Generate a purpose-built epic thumbnail artwork via image_generator.py
    (Vertex), retrying until a real scene (not blank) is returned."""
    import time as _t
    for attempt in range(1, max_attempts + 1):
        tmp = tempfile.mkdtemp(prefix="v10_thumb_art_")
        try:
            subprocess.run(
                [vertex_python(), os.path.join("image_generator.py"), "--prompts", prompt,
                 "--out", tmp, "--concurrency", "1"],
                cwd=BASE, timeout=300, capture_output=True, text=True, check=True)
            pngs = [f for f in os.listdir(tmp) if f.endswith(".png")]
            if not pngs:
                raise RuntimeError("Vertex returned no png")
            cand = os.path.join(tmp, pngs[0])
            if has_content(cand):
                shutil.move(cand, out_png)
                print(f"[thumb] scene ok on attempt {attempt}")
                return out_png
            print(f"[thumb] attempt {attempt}: blank scene, retrying...")
        except Exception as e:
            print(f"[thumb] attempt {attempt} error: {e}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        _t.sleep(1.5 * attempt)
    return None


# ---- EPIC MOVIE-POSTER art style (full-frame scene, NO baked text) ----
DEFAULT_ART_STYLE = (
    "EPIC cinematic movie-poster illustration, full-frame dramatic scene, rich "
    "colours, deep shadows, golden-hour or moody atmospheric lighting, sweeping "
    "composition with strong depth, premium blockbuster film-poster look, "
    "16:9 widescreen. Highly detailed, crisp focus on the main subject. "
    "NO text, NO letters, NO numbers, NO logos, NO subtitles, NO watermarks."
)


def build_art_prompt(title="", extra=""):
    """Compose the epic scene prompt. --art extra supplies the subject/scene."""
    return (DEFAULT_ART_STYLE + " " + extra).strip()


def extract_frame(src, at_sec, out_png):
    r = subprocess.run([FF, "-y", "-ss", str(at_sec), "-i", src, "-frames:v", "1", "-q:v", "2", out_png],
                       capture_output=True, text=True, errors="ignore")
    if r.returncode != 0 or not os.path.exists(out_png):
        raise RuntimeError("frame extract failed: " + (r.stderr or "")[-200:])


def load_font(size, candidates=None):
    """Return a font handle, preferring a heavy geometric sans."""
    candidates = candidates or FONT_CANDIDATES
    last = None
    for cand in candidates:
        if os.path.exists(cand):
            try:
                return ImageFont.truetype(cand, size)
            except Exception as e:
                last = e
    if last:
        print(f"[thumb] all fonts failed ({last}); using default")
    return ImageFont.load_default()


def derive_hook(title, max_words=4):
    """Fallback: build a short all-caps hook from the title (drop stopwords)."""
    words = [w for w in title.replace(":", " ").replace("'", "").split() if w.lower() not in STOPWORDS]
    if not words:
        words = [w for w in title.split() if w.lower() not in ("the", "of")][:max_words]
    return " ".join(words[:max_words]).upper() or "THE STORY"


def derive_caption(title):
    """Fallback caption from the title (what the video is about)."""
    return title.strip() or "A true story."


def _wrap_text(d, text, font, max_w):
    """Wrap text into lines that fit max_w pixels."""
    words = text.split()
    lines, cur = [], ""
    for wd in words:
        trial = (cur + " " + wd).strip()
        if d.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def _draw_shadow_text(im, box, text, font, fill, stroke, stroke_w=3, shadow=(0, 0, 0), sh_dx=4, sh_dy=6):
    """Text with heavy shadow + stroke for legibility over any scene."""
    d = ImageDraw.Draw(im)
    # soft shadow pass
    d.text((box[0] + sh_dx, box[1] + sh_dy), text, font=font, fill=shadow,
           stroke_width=stroke_w, stroke_fill=shadow)
    # crisp top pass
    d.text(box, text, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=stroke)
    return im


def make_thumbnail(src, title, out_jpg, at_sec=30, fontsize=96, hook=None, accent=None,
                   caption=None, cap_fontsize=40):
    tmp = os.path.join(BASE, "temp_media", "_thumb_frame.png")
    if src.lower().endswith((".png", ".jpg", ".jpeg")):
        im = Image.open(src).convert("RGB")
    else:
        extract_frame(src, at_sec, tmp)
        im = Image.open(tmp).convert("RGB")

    # cover-crop to 1280x720
    ratio = W / H
    iw, ih = im.size
    ir = iw / ih
    if ir > ratio:
        nw = int(ih * ratio); x0 = (iw - nw) // 2; im = im.crop((x0, 0, x0 + nw, ih))
    else:
        nh = int(iw / ratio); y0 = (ih - nh) // 2; im = im.crop((0, y0, iw, y0 + nh))
    im = im.resize((W, H), Image.LANCZOS)

    # ---- cinematic grade ----
    im = ImageEnhance.Color(im).enhance(1.08)
    im = ImageEnhance.Contrast(im).enhance(1.12)
    im = ImageEnhance.Brightness(im).enhance(1.02)
    # subtle vignette (edges) — mask=255 keeps scene, 0 -> dark. Draw full lines
    # (not sparse points) so the mask isn't mostly black after blur.
    w, h = im.size
    cx, cy = w / 2, h / 2
    max_d = math.hypot(cx, cy)
    mask = Image.new("L", (w, h), 255)
    md = ImageDraw.Draw(mask)
    for y in range(0, h, 2):
        dist = abs(y - cy) / max_d
        v = int(max(0.0, 1.0 - dist * 0.42) * 255)
        md.line([(0, y), (w, y)], fill=v)
    mask = mask.filter(ImageFilter.GaussianBlur(60))
    dark = Image.new("RGB", (w, h), (4, 5, 8))
    im = Image.composite(im, dark, mask)

    # ---- RIGHT-side caption scrim (keeps faces/subject clear) ----
    # A soft dark gradient from the right edge only, so the caption column reads
    # over any scene without covering characters' faces in the centre/left.
    # composite(im, black, mask): mask=255 keeps scene, 0 -> black. The mask is
    # 255 on the left fading to ~0 at the right edge => dark panel on the right.
    scrim_w = int(w * 0.44)          # right 44% is the caption panel
    scrim = Image.new("L", (w, h), 255)
    sd = ImageDraw.Draw(scrim)
    for x in range(w - scrim_w, w):
        t = (x - (w - scrim_w)) / scrim_w
        a = int(255 * (1.0 - (0.25 + 0.75 * t ** 1.25)))
        sd.line([(x, 0), (x, h)], fill=a)
    scrim = scrim.filter(ImageFilter.GaussianBlur(24))
    black = Image.new("RGB", (w, h), (4, 5, 8))
    im = Image.composite(im, black, scrim)

    d = ImageDraw.Draw(im)

    # ---- HOOK ----
    hook = (hook or derive_hook(title)).upper()
    hook = " ".join(hook.split()[:4])
    words = hook.split()
    accent = int(accent) if accent is not None else (len(words) - 1)
    accent = max(0, min(accent, len(words) - 1))

    lines, cur = [], []
    for i, wd in enumerate(words):
        cur.append(wd)
        if len(cur) >= 2 or i == len(words) - 1:
            lines.append(" ".join(cur)); cur = []
    if cur:
        lines.append(" ".join(cur))
    lines = lines[:2]

    font = load_font(fontsize)
    line_h = int(fontsize * 1.02)
    x_left = 48
    y_start = int(H * 0.16)
    # gold rule above the hook
    d.rectangle([x_left, y_start - 34, x_left + int(fontsize * 0.66), y_start - 25], fill=GOLD)

    # hook text: white + heavy black shadow/stroke
    stroke_w = max(3, int(fontsize * 0.045))
    for li, ln in enumerate(lines):
        y = y_start + li * line_h
        _draw_shadow_text(im, (x_left, y), ln, font, WHITE, (0, 0, 0), stroke_w=stroke_w)

    # accent word in RED (matched baseline/position)
    pos = 0
    for li, ln in enumerate(lines):
        lw = ln.split()
        for j, wd in enumerate(lw):
            if pos == accent:
                prefix = " ".join(lw[:j])
                y = y_start + li * line_h
                pre_w = d.textlength(prefix + " " if prefix else "", font=font)
                _draw_shadow_text(im, (x_left + pre_w, y), wd, font, RED, (0, 0, 0), stroke_w=stroke_w)
            pos += 1

    # ---- CAPTION (what's being said — deaf-viewer legible) — RIGHT COLUMN ----
    # Caption lives ONLY on the right side so it never covers the characters.
    cap_text = (caption or derive_caption(title)).strip()
    cap_font = load_font(cap_fontsize, CAPTION_FONT_CANDIDATES)
    cap_col_x = int(W * 0.58)            # left edge of the caption column
    cap_col_w = int(W * 0.90) - cap_col_x
    cap_lines = _wrap_text(d, cap_text, cap_font, cap_col_w)[:3]
    line_gap = int(cap_fontsize * 1.2)
    cap_y = int(H * 0.44)
    for ci, cl in enumerate(cap_lines):
        _draw_shadow_text(im, (cap_col_x, cap_y + ci * line_gap), cl, cap_font,
                          WHITE, (0, 0, 0), stroke_w=max(2, int(cap_fontsize * 0.05)),
                          sh_dx=3, sh_dy=4)

    # ---- TRUE STORY stamp (under hook, LEFT side) ----
    stamp_text = "TRUE STORY"
    try:
        st_font = load_font(int(fontsize * 0.30))
        tw = d.textlength(stamp_text, font=st_font)
        bw = int(tw + fontsize * 0.36)
        bh = int(fontsize * 0.48)
        bx = x_left; by = y_start + len(lines) * line_h + 24
        od = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        oo = ImageDraw.Draw(od)
        oo.rounded_rectangle([bx, by, bx + bw, by + bh], radius=8,
                             outline=(255, 214, 0, 235), width=max(2, int(fontsize * 0.04)),
                             fill=(0, 0, 0, 140))
        im = Image.alpha_composite(im.convert("RGBA"), od).convert("RGB")
        d = ImageDraw.Draw(im)
        d.text((bx + int(fontsize * 0.18), by + int(fontsize * 0.08)), stamp_text,
               font=st_font, fill=(255, 214, 0), stroke_width=2, stroke_fill=(0, 0, 0))
    except Exception as e:
        print("[thumb] stamp skip:", e)

    # ---- SAFE ZONE: darken bottom-right ~210x95 (YouTube timestamp badge) ----
    safe_zone = im.crop((W - 210, H - 95, W, H))
    dark_safe = Image.new("RGB", safe_zone.size, (8, 10, 14))
    im.paste(dark_safe, (W - 210, H - 95))

    im.save(out_jpg, "JPEG", quality=92)
    if os.path.exists(tmp):
        os.remove(tmp)
    return out_jpg


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default="", help="mp4 video path or source image (frame mode)")
    ap.add_argument("--art", default="", help="EPIC-SCENE mode: generate a full-frame movie-poster scene via Vertex from this prompt, then overlay hook + caption")
    ap.add_argument("--title", default="")
    ap.add_argument("--hook", default="", help="2-4 word curiosity hook (ALL CAPS recommended)")
    ap.add_argument("--accent", type=int, default=None, help="0-based index of the red accent word in --hook")
    ap.add_argument("--caption", default="", help="readable caption line (what's being said — for deaf viewers)")
    ap.add_argument("--out", default=os.path.join(BASE, "temp_media", "v10_thumb.jpg"))
    ap.add_argument("--at", type=float, default=30)
    ap.add_argument("--fontsize", type=int, default=92)
    ap.add_argument("--capfontsize", type=int, default=40)
    a = ap.parse_args()

    if a.art:
        # ---- EPIC-SCENE MODE (movie poster) ----
        prompt = build_art_prompt(a.title, a.art)
        print("[thumb] generating epic scene via Vertex...")
        art_png = os.path.join(BASE, "temp_media", "_v10_thumb_art.png")
        ok = generate_art(prompt, art_png)
        if not ok:
            print("[thumb] WARNING: could not get a real scene after retries; using last art anyway")
            if not os.path.exists(art_png):
                sys.exit("no art produced")
        print("[thumb] scene ok, overlaying hook + caption...")
        p = make_thumbnail(art_png, a.title, a.out, a.at, a.fontsize,
                           hook=a.hook or None, accent=a.accent,
                           caption=a.caption or None, cap_fontsize=a.capfontsize)
        if os.path.exists(art_png):
            os.remove(art_png)
        print("thumbnail ->", p, os.path.getsize(p), "bytes")
    else:
        if not a.src:
            ap.error("provide a video/image (frame mode) or --art <prompt>")
        p = make_thumbnail(a.src, a.title, a.out, a.at, a.fontsize,
                           hook=a.hook or None, accent=a.accent,
                           caption=a.caption or None, cap_fontsize=a.capfontsize)
        print("thumbnail ->", p, os.path.getsize(p), "bytes")
