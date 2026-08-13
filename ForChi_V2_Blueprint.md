# PROJECT FORCHI — UPDATED MASTER BLUEPRINT & BUILD SUMMARY

**Project:** ForChi — Free, 24/7 Telegram Social Media Automation Bot
**Author:** Pair-programmed with Victor (Chiedozie Victor Agu)
**Date:** August 13, 2026
**Status:** LIVE & VERIFIED — all core services healthy

---

## 1. Executive Summary

ForChi is Victor's autonomous social media & chat bot, rebuilt from scratch as a **fully free, always-on** system. It:

- **Posts automatically 5×/day** (08:00, 12:00, 16:00, 20:00, 00:00 UTC) to **Facebook AND LinkedIn**, 4 hours apart (AUTO MODE).
- **Facebook** posts are written in Victor's personal **poetic-therapist voice** (emotional, verse-like, philosophical) and always end with the signature **"Fickle youth"**.
- **LinkedIn** posts are **in-depth tech/AI** content (hook, 2–4 substantive points, closing takeaway) ending with **high-converting hashtags**.
- Every post carries a **styled image** (melancholic anime/lo-fi for Facebook, cyberpunk mecha biomechanical for LinkedIn) generated on **FLUX.1-dev**.
- **Chat** and **voice notes** are handled with fast, free LLM/transcription.
- Can be paused/resumed from Telegram: *"turn on auto mode"* / *"switch off auto mode"*.

Everything runs on **free services only**: Render (bot), Hugging Face Spaces (self-hosted Qwen2.5-7B LLM + hosted ZeroGPU FLUX image Spaces), Google Gemini free tier (chat/voice/intent), Groq (optional voice fallback), Pollinations.ai (image fallback).

---

## 2. System Architecture

```
Telegram ⇄ Render (bot, long-polling)
                │
                ├── LLM_ENDPOINT ──► HF Space "slymun/forchi"  (self-hosted Qwen2.5-7B GGUF, llama.cpp FastAPI)
                ├── Gemini (free) ──► chat / voice / intent / content
                ├── Images ──► hosted ZeroGPU FLUX (KingNish) → hosted SDXL-Lightning (radames) → own Space → Pollinations
                └── Facebook Graph API + LinkedIn API (posting)
```

### Message flow (deterministic 3-exit pipeline)
1. **Gate** (`router/gate.js`) — fast regex check for `make a post`.
2. **Extractor** (`router/extractor.js`) — structured intent `{isPostTrigger, destinations, content}` (Gemini → Qwen fallback).
3. **Social workflow** (`workflows/social/`) — async post to FB/LI with generated image.

### Auto-mode scheduler
`node-cron` `"0 0,8,12,16,20 * * *" UTC` — rotates FB themes (6) and LI topics (6), generates content, posts each platform in parallel (`Promise.allSettled`), guarded against overlap.

### Voice pipeline
Telegram voice (.ogg) → **Gemini direct transcription** (no ffmpeg needed) → falls back to ffmpeg→WAV→Gemini → Groq Whisper → HF Whisper → then same gate/extractor pipeline.

---

## 3. Services & Hosting

| Service | URL / ID | Purpose | Status |
|---|---|---|---|
| Render web service | https://forchi.onrender.com | Telegram bot (long-polling), health + `/status` | ✅ Healthy |
| HF LLM Space | `slymun/forchi` (cpu-basic) | Self-hosted Qwen2.5-7B via llama.cpp FastAPI | ✅ Running |
| Hosted FLUX Space | `kingnish/Realtime-FLUX` | FLUX.1-dev images (24/7, via `x-hf-authorization`) | ✅ Working |
| Hosted SDXL Space | `radames/Real-Time-Text-to-Image-SDXL-Lightning` | Image fallback (24/7) | ✅ Working |
| Own image Space | `slymun/forchi-img` (ZeroGPU) | fp8 FLUX.1-dev (backup) | ⚠️ Backup |
| Keep-alive | GitHub Actions `keepalive.yml` + UptimeRobot | Prevents Render sleep (free tier) | ✅ Active |

**Key insight:** ZeroGPU attributes GPU time to the caller's HF account via the **`x-hf-authorization: Bearer <HF_TOKEN>`** header. Unauthenticated calls fall into the tiny anonymous pool (2 min/day) and fail with `event: error`; authenticated calls use the PRO quota (40 min/day).

---

## 4. Features Built (this session)

### 4.1 Auto-mode scheduler
- 5 posts/day, 4h apart, FB + LI in parallel.
- Theme rotation by hour so all 5 daily posts differ.
- `running` guard prevents overlapping ticks.
- Persisted on/off state (`data/auto_mode.json`), defaults ON.

### 4.2 Auto-mode toggle command
- Telegram command detected line-wise: must contain **action** (`turn|switch` + `on|off`) **and** trigger (`auto mode`) in one line.
- Replies with current state; scheduler skips ticks when OFF.

### 4.3 Facebook writer (Victor's poetic-therapist voice)
- Rewritten prompt: adapts to ANY theme, **varies the opening** (no more repeated "To my dear girls"), poetic verse, aphoristic truth.
- **"Fickle youth"** signature appended programmatically to EVERY Facebook post (not left to the model).

### 4.4 LinkedIn writer (in-depth tech + hashtags)
- Analytical, educational, opinionated (explicitly NOT poetic).
- Hook → 2–4 in-depth points → closing takeaway/question.
- Ends with 3–6 **high-converting hashtags** that survive the cleanup step (`keepHashtags`).

### 4.5 Reference-matched image styles
- **Facebook:** *melancholic anime scenery, lo-fi digital painting, Makoto Shinkai-style sky realism, painterly clouds, cel-shaded character, moody desaturated blues, backlit cinematic lighting*.
- **LinkedIn:** *cyberpunk mecha biomechanical concept art, matte white & surgical gray monochrome, segmented armor plating, hydraulic actuators, high-key studio rim lighting, octane render, photorealistic, 8k*.
- Matched to Victor's reference images (`LUCAS ALIGHIERI_.jpeg` → FB, `563018699347692.jpeg` → LI).

### 4.6 Image pipeline
- **Chain:** Hosted FLUX (KingNish) → Hosted SDXL-Lightning (radames) → own ZeroGPU Space → Pollinations → HF router.
- All ZeroGPU calls send `x-hf-authorization` (PRO quota).
- **WebP → JPEG** auto-conversion via `sharp` (Facebook/LinkedIn reject WebP).
- MIME detection from magic bytes for correct upload content-type.

### 4.7 Voice transcription
- **Gemini direct on original OGG/Opus** (fast, ~7s) — no ffmpeg for the primary path.
- Tiered fallback: ffmpeg→WAV→Gemini → Groq Whisper → HF Whisper.
- Handlers decoupled (typing indicator + background) so slow work never breaks polling.

### 4.8 Fast chat
- **Gemini-first** (~6s) with self-hosted Qwen as unlimited fallback (`CHAT_PROVIDER=gemini|qwen`).
- Request timeouts everywhere (180s Qwen, 120s HF, 60s Gemini) so nothing hangs.

### 4.9 Health / status
- `/status` endpoint reports auto-mode state, UTC time, schedule.

---

## 5. Codebase Map

```
src/
  bot.js                    # Telegram long-polling, health/status server, toggle wiring, 409 retry
  router/
    gate.js                 # Layer 1 regex gate
    extractor.js            # Layer 2 intent extraction (zod schema)
    autoModeToggle.js       # "turn/switch on/off auto mode" detector
  llm/
    provider.js             # Gemini waterfall → Qwen → HF router; chat (Gemini-first)
    chatChain.js            # chat framing + chatReply
    contentGen.js           # FB/LI generators, cleanPostFormatting, Fickle youth
  scheduler/
    jobs.js                 # 5×/day auto scheduler
    autoMode.js             # persisted on/off state
  voice/
    transcriber.js          # Gemini direct OGG → Groq → HF
  workflows/social/
    index.js                # run(), image chain, buildImagePrompt, normalize (sharp)
    facebook.js             # FB poster (native FormData + correct MIME)
    linkedin.js             # LI poster (3-step upload)
    imageMime.js            # magic-byte MIME detection
  store/db.js               # SQLite
```

---

## 6. Key Fixes & Lessons Learned (chronological)

1. **HF Spaces block ALL outbound egress** (Telegram/Discord time out) → moved the bot to **Render**; HF only hosts LLM/image servers.
2. **HF Inference credits depleted** (402) → built **self-hosted Qwen2.5-7B** on a free HF CPU Space.
3. **`llama_cpp.server` returned 400 on all routes** → rewrote as **custom FastAPI app** using `llama_cpp.Llama` directly (verified working).
4. **Gemini 2.0/1.5 model IDs are dead (404)** → moved to **Gemini 3.x** (`gemini-3.1/3.5/3.6-flash*`), verified audio support.
5. **Keep-alive URL stale / Actions quota** → fixed to `forchi.onrender.com`, made non-fatal, added **UptimeRobot** as the reliable keep-awake (GitHub Actions free tier ~2000 min/mo vs ~4300 needed).
6. **409 Conflict during deploys** (two instances polling Telegram) → `launchWithRetry` detects 409 and extends the retry window (30 attempts, backoff).
7. **Chat replies took ~90s + handler timeout killed them** → **Gemini-first chat** (~6s) + **decoupled handlers** (typing indicator + background reply) + `handlerTimeout: 600000`.
8. **Voice took 3–5 min / failed** → **send original OGG directly to Gemini** (no ffmpeg) → ~7s; added Groq + HF fallbacks.
9. **Facebook photo upload failed `(#100) 0 does not resolve to a valid user ID`** → the npm `form-data` body was sent **without multipart boundary headers**. Fixed with **native FormData/Blob** (auto boundary) + correct MIME from magic bytes.
10. **ZeroGPU images failed instantly (`event: error`)** → the real cause was **missing `x-hf-authorization` auth header** (anonymous pool exhausted). Adding it uses the PRO quota → hosted FLUX works (~10s).
11. **Hosted FLUX returns WebP** (rejected by FB/LI) → **`sharp` auto-converts WebP→JPEG** before posting.
12. **FLUX.1-dev full (33.7GB) can't fit the 24GB A10G ZeroGPU** → **fp8-quantized transformer** (~21.8GB packed) fits; also `black-forest-labs/FLUX.1-dev-fp8` repo is NOT a valid diffusers pipeline (use the fp8-transformer load instead).
13. **Facebook writer stuck on "To my dear girls"** → prompt copied its own example phrase; rewritten to be adaptive + vary openings.
14. **Render sleeps after 15 min idle (free tier)** → keep-alive pings (GitHub Actions + UptimeRobot) every ≤10 min; deploys briefly return `no-deploy` HTML (expected during redeploy).

---

## 7. Environment Variables & Config

| Variable | Purpose | Required |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot auth | ✅ |
| `GEMINI_KEYS` | Comma-separated Gemini API keys (waterfall) | ✅ |
| `HF_TOKEN` / `HF_ACCESS_TOKEN` | HF auth (LLM Space, images `x-hf-authorization`) | ✅ |
| `FACEBOOK_PAGE_ID` | FB page ID | ✅ |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | FB page token | ✅ |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn token | ✅ |
| `LINKEDIN_AUTHOR_URN` | LinkedIn author/person URN | ✅ |
| `LLM_ENDPOINT` | Self-hosted Qwen URL | ✅ |
| `ZEROGPU_ENDPOINT` | Own image Space URL | optional |
| `HOSTED_FLUX_ENDPOINT` | Hosted FLUX Space URL | optional |
| `HOSTED_IMG_ENDPOINT` / `HOSTED_IMG_API` | Hosted SDXL Space URL/api | optional |
| `GROQ_API_KEY` | Groq Whisper fallback | optional |
| `AUTO_MODE_DEFAULT` | Initial auto mode (default true) | optional |
| `CHAT_PROVIDER` | `gemini` (default) or `qwen` | optional |
| `DATABASE_PATH` / `PORT` / `NODE_ENV` | Runtime | ✅ |

---

## 8. Operations

- **Health:** `https://forchi.onrender.com/` → `{"status":"healthy","bot":"ForChi","mode":"long-polling"}`
- **Status (auto mode):** `https://forchi.onrender.com/status`
- **Telegram commands:** `turn on auto mode`, `switch off auto mode`, `make a post ...`
- **Testing tools** (`tools/`): `test_content_gen.js`, `test_styles.js`, `test_voice_e2e.js`, `test_groq_audio.js`, `test_full_chain.js`, `test_ref_styles.js`, `test_auth_bot.js`, `check_auto_status.py`, `test_auto_toggle.js`, etc.

---

## 9. Security Notes

- **`lookhere.docx` in Downloads contains all credentials in plaintext — delete it.**
- Tokens are added to Render env manually by Victor (best practice), never committed (`.env` is gitignored).
- No secrets are hardcoded in code; HF Space tokens are set as Space secrets via API.

---

## 10. Next Steps / Recommendations

1. **Verify first auto-post with new image styles** after next scheduled slot.
2. **Optional:** re-run the reference-style test (`tools/test_ref_styles.js`) and tune prompts if the art type is slightly off.
3. **Optional:** fix the own ZeroGPU Space (`slymun/forchi-img`) if desired — it's a backup now; hosted FLUX is primary.
4. **Monitor UptimeRobot** for Render/LLM/Image monitors (occasional brief alerts during deploys are expected).
5. **Keep `keepalive.yml`** running; consider disabling GitHub Actions keep-alive if UptimeRobot alone is preferred (saves Actions minutes).
