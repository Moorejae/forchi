# ForChi Video — Autonomous YouTube Shorts Workflow (Blueprint)

> **Status:** Phase 1 — PLANNING (2026-08-18). Third workflow (after Social + Jobs).
> **Goal:** A workflow *inside ForChi* that produces **5 Shorts/day** in the **Victor Moore** register (deep slow-voice narration + philosophical quotes + stitched visuals + captions + ambient music) and auto-uploads to YouTube — with a **100%-unique voice** so the channel can monetize.

---

## 1. Reality base (verified, not assumed)

- **The voice is known:** the deep baritone "slow voice of reason" from Victor's own Short (QRbzAJCVWpQ) — ~100–140 WPM, somber cinematic narrator, ambient drone underneath. **We already hold a 49s audio sample of it** (`temp_media/short_QRbzAJCVWpQ.webm`).
- **The persona is documented:** `Victor Moore Linguistics & Psychological Persona Blueprint V2.docx` → formula = *aphoristic open → brutal subversion → high-contrast imagery → FINAL ANCHOR*. Lexicon: shadow, ego, graveyard, monster, hoard, ruthless, violent, righteous…
- **The visual recipe** (from analyzing the Short): ~10 distinct clips, **hard cuts ~every 4–5s**, no crossfades, word-by-word captions (bottom-center, bold rounded sans, white + pink/purple glow), "Victor Moore" watermark top-right, occasional spaced sub-caption (e.g. "P A I N ."), black-screen white-text outro. **No Ken Burns.**
- **Compute reality:** Render free tier (512MB, ffmpeg installed) orchestrates; Hugging Face Spaces do the heavy lifting (FLUX ZeroGPU for visuals, a TTS Space for the voice clone).
- **Models verified callable with the 14 AQ keys:** `gemini-3.7-flash` (~20 RPD → hero script only), `gemini-3.6/3.5-flash(-lite)` (high quota → script backbone), `gemma-4-26b-a4b-it` / `gemma-4-31b-it` (~14.4k RPD each → titles/descriptions/tags + fallback).

---

## 2. Architecture (3rd workflow in the same bot)

```
  ForChi bot (Node.js + Telegraf) — Render free tier
  ├─ Social workflow   (ACTIVE, 5x/day FB+LI)
  ├─ Jobs workflow     (ACTIVE, constant auto)
  └─ VIDEO workflow    (NEW, 5 Shorts/day)  → src/workflows/video/
       script → voice → visuals → assemble → upload
       (Gemini)  (TTS)   (FLUX/clips)  (ffmpeg)  (YouTube API)
```

**Module tree (planned):**
```
src/workflows/video/
  persona.js        # Victor Moore formula: aphorism→subversion→contrast→anchor + lexicon
  script.js         # Gemini script writer (hero=3.7-flash, bulk=3.6/3.5-flash-lite) + title/desc/tags (gemma-4-31b)
  voice.js          # TTS: cloned voice (XTTS/F5/GPT-SoVITS on an HF Space) → 44.1k WAV
  visuals.js        # FLUX anime-style stills (ZeroGPU) OR user-supplied clip folder
  captions.js       # word-by-word timing from the TTS audio (silence-split)
  assemble.js       # ffmpeg: 9:16, hard cuts, captions burn-in, watermark, music mix, concat
  music.js          # ambient drone bed (generated or royalty-free)
  youtube.js        # YouTube Data API v3 upload (OAuth refresh token) + Shorts metadata
  scheduler.js      # 5/day, spaced across the day; daily digest
  db.js             # videos table (script, audio, mp4, uploaded_at, video_id, status)
```

---

## 3. Pipeline (per Short, ~1–3 min each)

1. **SCRIPT** — Gemini writes a 30–60s Victor Moore quote following the docx formula; title/description/hashtags from gemma-4-31b.
2. **VOICE** — cloned TTS reads the script (~100–120 WPM to match the original pacing). Audio analyzed for word/sentence timing.
3. **VISUALS** — **decision point (pending FLUX sample verdict):**
   - *Path A — FLUX (preferred if quality passes):* ~8–10 anime-style stills per script, camera-move animation in ffmpeg (pan/zoom — NOT Ken Burns? see note), hard cuts.
   - *Path B — supplied clips:* Victor drops a folder of clips; we auto-slice/sort and stitch.
   - *(Note: Victor wants real motion, not Ken Burns — camera moves + cuts + captions are the motion language.)*
4. **ASSEMBLE** — ffmpeg: vertical 9:16 (1080×1920), cut on cadence, burn captions word-by-word, watermark top-right, ambient drone bed, loudness-normalize, concat to one mp4.
5. **UPLOAD** — YouTube Data API (OAuth refresh token from `lookhere` client) → 5/day, spaced; status logged; daily Telegram digest.

---

## 4. Copyright reality (honest, affects monetization)

- Stitching recognizable film scenes (Joker, Peaky Blinders, Demolition) **does not avoid Content ID** — risky for a monetizing channel.
- **Safer free path:** AI anime-style stills via FLUX (100% original) or royalty-free/CC clips. User decision pending the FLUX sample.

---

## 5. Credentials / auth (found in lookhere.docx — DELETE that file)

- YouTube API key + OAuth Client ID/secret (channel: yonkkalu@gmail.com) ✅ present.
- **Need:** a refresh token via one-time OAuth consent (I'll build the flow; user approves once in browser).

---

## 6. Decisions locked
- [x] 5 Shorts/day, 30–60s each, vertical 9:16.
- [x] Voice = clone of the analyzed Short voice (100%-unique; 49s sample in hand).
- [x] No Ken Burns; motion via camera moves + hard cuts + captions.
- [x] Script engine = Victor Moore persona formula (Gemini).
- [x] Models: hero=3.7-flash, bulk=flash-lite, tags/metadata=gemma-4-31b.
- [ ] **PENDING:** FLUX sample verdict → Path A (FLUX) or Path B (supplied clips).
- [ ] **PENDING:** YouTube OAuth refresh token.
- [ ] **PENDING:** music source (generated ambient drone vs royalty-free bed).
