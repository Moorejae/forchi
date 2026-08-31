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
# ---- Cream-top storybook palette (user's reorganized look) ----
CREAM = (248, 243, 230)        # warm cream top band
INK = (24, 22, 20)             # near-black hook text on cream
WHITE = (255, 255, 255)
RED = (229, 57, 53)            # #E53935 — accent keyword
GOLD = (212, 160, 23)          # #D4A017 — stamp
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


CURIOSITY_WORDS = {"why", "how", "what", "who"}

def derive_hook(title, max_words=4):
    """Fallback: build a short all-caps hook from the title. A LEADING curiosity
    word (WHY/HOW/WHAT/WHO) is kept AND the words stay intact (no stopword
    stripping) so the hook reads naturally: "WHY WINNING IS MORE DANGEROUS".
    Without a curiosity opener we fall back to the punchy stopword-stripped
    2-4 word style ("THE PYRRHIC TRAP")."""
    tokens = title.replace(":", " ").replace("'", "").split()
    if tokens and tokens[0].lower() in CURIOSITY_WORDS:
        return " ".join(tokens[:max_words]).upper() or "THE STORY"
    words = [w for w in tokens if w.lower() not in STOPWORDS]
    if not words:
        words = [w for w in tokens if w.lower() not in ("the", "of")][:max_words]
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

    # ---- light cinematic grade (keep the scene bright/clean) ----
    im = ImageEnhance.Color(im).enhance(1.06)
    im = ImageEnhance.Contrast(im).enhance(1.08)
    im = ImageEnhance.Brightness(im).enhance(1.04)

    # ---- TOP CREAM BAND (the user's reorganized look): a warm cream panel across
    # the TOP ~40% where the centered black hook sits; the scene shows below. ----
    band_bottom = int(H * 0.42)
    # mask: 255 = keep cream on top, 0 = keep scene below, soft blend at the seam.
    band = Image.new("L", (W, H), 255)
    bd = ImageDraw.Draw(band)
    for y in range(0, H):
        if y < band_bottom - 40:
            a = 255
        elif y < band_bottom + 40:
            t = (y - (band_bottom - 40)) / 80
            a = int(255 * (1.0 - t))
        else:
            a = 0
        bd.line([(0, y), (W, y)], fill=a)
    band = band.filter(ImageFilter.GaussianBlur(24))
    cream = Image.new("RGB", (W, H), CREAM)
    im = Image.composite(cream, im, band)

    # subtle top-edge shadow line under the cream band for depth
    d0 = ImageDraw.Draw(im)
    d0.line([(0, band_bottom + 2), (W, band_bottom + 2)], fill=(0, 0, 0, 60))

    d = ImageDraw.Draw(im)

    # ---- HOOK: centered bold black text on the cream band ----
    hook = (hook or derive_hook(title)).upper()
    hook = " ".join(hook.split()[:5])
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
    line_h = int(fontsize * 1.05)
    # center the whole hook block vertically in the cream band, horizontally centered
    block_h = len(lines) * line_h
    y_start = (band_bottom - block_h) // 2 + int(H * 0.02)
    for li, ln in enumerate(lines):
        tw = d.textlength(ln, font=font)
        x0 = (W - tw) // 2
        y = y_start + li * line_h
        # near-black text with a soft light shadow (reads on cream)
        d.text((x0 + 3, y + 4), ln, font=font, fill=(0, 0, 0, 90))
        d.text((x0, y), ln, font=font, fill=INK)

    # accent word in RED (centered block: recompute the accent word's x offset)
    pos = 0
    for li, ln in enumerate(lines):
        lw = ln.split()
        for j, wd in enumerate(lw):
            if pos == accent:
                prefix = " ".join(lw[:j])
                y = y_start + li * line_h
                pre_w = d.textlength(prefix + " " if prefix else "", font=font)
                tw = d.textlength(ln, font=font)
                x0 = (W - tw) // 2
                d.text((x0 + 3, y + 4), wd, font=font, fill=(0, 0, 0, 90))
                d.text((x0 + pre_w, y), wd, font=font, fill=RED)
            pos += 1

    # ---- CAPTION (what's being said — deaf-viewer legible) at the BOTTOM ----
    # A compact 1-2 line band at the very bottom over a subtle dark scrim so it
    # reads on the scene without covering characters' faces (faces live mid-frame).
    cap_text = (caption or derive_caption(title)).strip()
    cap_font = load_font(cap_fontsize, CAPTION_FONT_CANDIDATES)
    cap_w = int(W * 0.86)
    cap_lines = _wrap_text(d, cap_text, cap_font, cap_w)[:2]
    line_gap = int(cap_fontsize * 1.2)
    block_h2 = len(cap_lines) * line_gap
    cap_y = H - block_h2 - 26
    # Soft scrim ONLY on the bottom strip. composite(im, black, mask): mask=255
    # keeps im, 0 -> black. So the mask is 255 everywhere except a darkening
    # band at the very bottom (0 = black there) — the rest of the scene is kept.
    scrim = Image.new("L", (W, H), 255)
    sd = ImageDraw.Draw(scrim)
    scrim_top = cap_y - 22
    for y in range(scrim_top, H):
        t = (y - scrim_top) / max(1, (H - scrim_top))
        a = int(255 * (1.0 - 0.9 * t))
        sd.line([(0, y), (W, y)], fill=max(0, min(255, a)))
    scrim = scrim.filter(ImageFilter.GaussianBlur(14))
    black = Image.new("RGB", (W, H), (6, 8, 12))
    im = Image.composite(im, black, scrim)
    d = ImageDraw.Draw(im)
    for ci, cl in enumerate(cap_lines):
        tw = d.textlength(cl, font=cap_font)
        _draw_shadow_text(im, ((W - tw) // 2, cap_y + ci * line_gap), cl, cap_font,
                          WHITE, (0, 0, 0), stroke_w=max(2, int(cap_fontsize * 0.05)),
                          sh_dx=3, sh_dy=4)

    # ---- TRUE STORY stamp (small, top-left under the cream seam) ----
    stamp_text = "TRUE STORY"
    try:
        st_font = load_font(int(fontsize * 0.26))
        tw = d.textlength(stamp_text, font=st_font)
        bw = int(tw + fontsize * 0.30)
        bh = int(fontsize * 0.40)
        bx = 28; by = H - bh - 22  # bottom-left, above the caption safe-zone
        od = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        oo = ImageDraw.Draw(od)
        oo.rounded_rectangle([bx, by, bx + bw, by + bh], radius=8,
                             outline=(255, 214, 0, 235), width=max(2, int(fontsize * 0.04)),
                             fill=(0, 0, 0, 130))
        im = Image.alpha_composite(im.convert("RGBA"), od).convert("RGB")
        d = ImageDraw.Draw(im)
        d.text((bx + int(fontsize * 0.14), by + int(fontsize * 0.06)), stamp_text,
               font=st_font, fill=(255, 214, 0), stroke_width=2, stroke_fill=(0, 0, 0))
    except Exception as e:
        print("[thumb] stamp skip:", e)

    # ---- SAFE ZONE: darken bottom-right ~210x95 (YouTube timestamp badge) ----
    safe_zone = im.crop((W - 210, H - 95, W, H))
    dark_safe = Image.new("RGB", safe_zone.size, (10, 12, 16))
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
