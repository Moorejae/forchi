"""V10 thumbnail — "Curiosity Gap" style (reverse-engineered from BetterU/Aperture/
Veritasium-class educational documentary channels, per user's template 2026-08-30).

Design pillars implemented from the template:
  * 1280x720 canvas (YouTube thumbnail size), master grade is cinematic-dark.
  * LEFT 50-60%  = FOCAL HOOK zone: the storybook scene / narrator kept bright with
                   a spotlight + rim glow, vignetted to charcoal edges.
  * RIGHT 40-50% = POWER TEXT zone: 2-4 words, ALL CAPS, ultra-bold geometric sans,
                   WHITE base + GOLD (#FFD600) accent keyword, heavy black shadow,
                   on a dark right scrim for guaranteed legibility.
  * Accents: thin gold rule above the hook + a small diagonal gold stamp tag.
  * SAFE ZONE: bottom-right ~200x90px left clean (YouTube timestamp badge overlays).
  * Non-redundancy: thumbnail hook is a SHORT curiosity phrase (--hook), NOT the title.

Usage:
    .venv\\Scripts\\python.exe tools/_v10_thumbnail.py <video_or_png> [--title "TITLE"]
        [--hook "THE PYRRHIC TRAP"] [--accent 2] [--out thumb.jpg] [--at 30]
        [--fontsize 84]
"""
import os, sys, shutil, subprocess, argparse, math
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FF = (os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe())

W, H = 1280, 720
GOLD = (255, 214, 0)          # #FFD600 — the accent
WHITE = (255, 255, 255)
CHARCOAL = (11, 14, 20)       # #0B0E14
# Heavy geometric sans candidates (Bahnschrift ships with Windows and reads as a
# Montserrat-class face; Montserrat variable font also available in project fonts).
FONT_CANDIDATES = [
    os.path.join(BASE, "temp_media", "fonts", "Montserrat-Variable.ttf"),
    r'C:\Windows\Fonts\bahnschrift.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\ariblk.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
STOPWORDS = {"the", "of", "a", "an", "and", "or", "to", "for", "in", "on", "with", "how", "why", "is", "are", "it", "that", "this", "your", "you", "at", "by", "from"}


def extract_frame(src, at_sec, out_png):
    r = subprocess.run([FF, "-y", "-ss", str(at_sec), "-i", src, "-frames:v", "1", "-q:v", "2", out_png],
                       capture_output=True, text=True, errors="ignore")
    if r.returncode != 0 or not os.path.exists(out_png):
        raise RuntimeError("frame extract failed: " + (r.stderr or "")[-200:])


def load_font(size):
    """Return a font handle from candidates, preferring a heavy geometric sans."""
    last = None
    for cand in FONT_CANDIDATES:
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


def _vignette(size, strength=0.62):
    """Radial vignette mask: 1 at center -> 0 at corners."""
    w, h = size
    cx, cy = w / 2, h / 2
    max_d = math.hypot(cx, cy)
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    step = 4
    for y in range(0, h, step):
        for x in range(0, w, step):
            dist = math.hypot(x - cx, y - cy) / max_d
            v = max(0.0, 1.0 - dist * strength)
            d.point((x, y), int(v * 255))
    mask = mask.resize(size)
    mask = mask.filter(ImageFilter.GaussianBlur(60))
    return mask


def _spotlight(size, center=(0.30, 0.42), radius=0.52):
    """Radial spotlight mask used to keep the left/subject zone bright."""
    w, h = size
    cx, cy = center[0] * w, center[1] * h
    r = radius * w
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    step = 4
    for y in range(0, h, step):
        for x in range(0, w, step):
            dist = math.hypot(x - cx, y - cy)
            v = max(0.0, 1.0 - dist / r)
            d.point((x, y), int(v * 255))
    mask = mask.resize(size).filter(ImageFilter.GaussianBlur(80))
    return mask


def make_thumbnail(src, title, out_jpg, at_sec=30, fontsize=84, hook=None, accent=None):
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

    # ---- cinematic dark grade ----
    im = ImageEnhance.Color(im).enhance(0.82)          # slight desat
    im = ImageEnhance.Contrast(im).enhance(1.12)       # punch
    # charcoal vignette (edges)
    vign = _vignette((W, H), 0.62)
    dark = Image.new("RGB", (W, H), CHARCOAL)
    im = Image.composite(im, dark, vign)
    # left/subject spotlight keeps the focal bright
    spot = _spotlight((W, H), center=(0.30, 0.42), radius=0.52)
    boost = ImageEnhance.Brightness(im).enhance(1.25)
    im = Image.composite(boost, im, spot)
    # right scrim: horizontal black gradient so power text pops
    scrim = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(scrim)
    for x in range(int(W * 0.42), W):
        alpha = int(190 * ((x - W * 0.42) / (W - W * 0.42)))
        sd.line([(x, 0), (x, H)], fill=alpha)
    scrim = scrim.filter(ImageFilter.GaussianBlur(30))
    black = Image.new("RGB", (W, H), (5, 7, 12))
    im = Image.composite(im, black, scrim)

    d = ImageDraw.Draw(im)
    hook = (hook or derive_hook(title)).upper()
    hook = " ".join(hook.split()[:4])
    words = hook.split()
    accent = int(accent) if accent is not None else (len(words) - 1)  # default: last word gold
    accent = max(0, min(accent, len(words) - 1))

    # ---- layout: stack words into 1-3 lines (max ~2 words per line) ----
    lines, cur = [], []
    for i, wd in enumerate(words):
        cur.append(wd)
        if len(cur) >= 2 or i == len(words) - 1:
            lines.append(" ".join(cur)); cur = []
    if cur:
        lines.append(" ".join(cur))
    lines = lines[:3]

    font = load_font(fontsize)
    line_h = int(fontsize * 1.06)
    x_right = int(W * 0.50)
    y_start = int(H * 0.30)
    # gold rule above the hook
    d.rectangle([x_right, y_start - 26, x_right + int(fontsize * 0.62), y_start - 20], fill=GOLD)

    # text with heavy black shadow (offset copies, then color on top)
    shadow_off = max(3, int(fontsize * 0.08))
    for li, ln in enumerate(lines):
        y = y_start + li * line_h
        d.text((x_right + shadow_off, y + shadow_off), ln, font=font, fill=(0, 0, 0))
        d.text((x_right, y), ln, font=font, fill=WHITE,
               stroke_width=max(2, int(fontsize * 0.05)), stroke_fill=(0, 0, 0))

    # overlay the accent word in GOLD (matched to the same baseline/position)
    pos = 0
    for li, ln in enumerate(lines):
        lw = ln.split()
        for j, wd in enumerate(lw):
            if pos == accent:
                prefix = " ".join(lw[:j])
                y = y_start + li * line_h
                pre_w = d.textlength(prefix + " " if prefix else "", font=font)
                d.text((x_right + pre_w, y), wd, font=font, fill=GOLD,
                       stroke_width=max(2, int(fontsize * 0.05)), stroke_fill=(0, 0, 0))
            pos += 1

    # ---- accent stamp: small gold-bordered tag under the power text ----
    stamp_y = y_start + len(lines) * line_h + 30
    stamp_text = "TRUE STORY"
    try:
        st_font = load_font(int(fontsize * 0.34))
        tw = d.textlength(stamp_text, font=st_font)
        bw = int(tw + fontsize * 0.4)
        bh = int(fontsize * 0.55)
        bx, by = x_right + int(fontsize * 0.5), stamp_y
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([bx, by, bx + bw, by + bh], radius=6,
                             outline=(255, 214, 0, 230), width=max(2, int(fontsize * 0.045)),
                             fill=(0, 0, 0, 90))
        im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
        d = ImageDraw.Draw(im)
        d.text((bx + int(fontsize * 0.2), by + int(fontsize * 0.08)), stamp_text,
               font=st_font, fill=GOLD, stroke_width=2, stroke_fill=(0, 0, 0))
    except Exception as e:
        print("[thumb] stamp skip:", e)

    # ---- SAFE ZONE: darken bottom-right 210x95 (YouTube timestamp badge) ----
    safe_zone = im.crop((W - 210, H - 95, W, H))
    dark_safe = Image.new("RGB", safe_zone.size, (8, 10, 15))
    im.paste(dark_safe, (W - 210, H - 95))

    im.save(out_jpg, "JPEG", quality=92)
    if os.path.exists(tmp):
        os.remove(tmp)
    return out_jpg


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="mp4 video path or source image")
    ap.add_argument("--title", default="")
    ap.add_argument("--hook", default="", help="2-4 word curiosity hook (ALL CAPS recommended)")
    ap.add_argument("--accent", type=int, default=None, help="0-based index of the gold accent word in --hook")
    ap.add_argument("--out", default=os.path.join(BASE, "temp_media", "v10_thumb.jpg"))
    ap.add_argument("--at", type=float, default=30)
    ap.add_argument("--fontsize", type=int, default=84)
    a = ap.parse_args()
    p = make_thumbnail(a.src, a.title, a.out, a.at, a.fontsize, hook=a.hook or None, accent=a.accent)
    print("thumbnail ->", p, os.path.getsize(p), "bytes")
