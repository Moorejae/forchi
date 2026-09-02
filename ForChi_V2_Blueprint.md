# PROJECT FORCHI — UPDATED MASTER BLUEPRINT & BUILD SUMMARY

**Project:** ForChi — Free, 24/7 Telegram Social Media Automation Bot
**Author:** Pair-programmed with Victor (Chiedozie Victor Agu)
**Date:** September 1, 2026 (last major revision)
**Status:** LIVE & VERIFIED — social, video, and job-application workflows all running 24/7

---

## 1. Executive Summary

ForChi is Victor's autonomous social media, video, and job-application agent — rebuilt from scratch as a **fully free, always-on** system. It:

- **Posts automatically 2×/day** (08:00 + 16:00 UTC) to **Facebook** and **2×/day** to **LinkedIn** (AUTO MODE).
- **Facebook** posts are written in Victor's personal **poetic-therapist voice** (emotional, verse-like, philosophical) and always end with the signature **"Fickle youth"**.
- **LinkedIn** posts alternate two formats: the **08:00 slot is a job-seeking post** addressed to hiring managers and people who know them (what Victor does, what he wants, the company type, who to connect him to, how to help); the **16:00 slot is a build-in-public project showcase** (real builds incl. Milo and CLAY, real failures, agentic tools, `.env`/`.gitignore` hygiene) — both ending with **high-converting hashtags**.
- Every post carries a **styled image** (melancholic anime/lo-fi for Facebook, cyberpunk mecha biomechanical for LinkedIn) generated on **FLUX.1-dev**.
- **Chat** and **voice notes** are handled with fast, free LLM/transcription.
- **Runs a full long-form YouTube automation pipeline** (channel @sirxlud): AI scripts, voice-cloned narration, AI images, subtitles, thumbnails, auto-upload — up to 2 videos/day.
- **Runs an autonomous job-application workflow**: discovers intern/junior roles (cloud security, DevOps, AI integration, workflow automation, API integration), scores them, writes tailored resumes + cover letters, and auto-applies to ATS portals.
- Can be paused/resumed from Telegram: *"turn on auto mode"* / *"switch off auto mode"*.

Everything runs on **free/cheap services only**: Render/Contabo (bot), Hugging Face Spaces (self-hosted Qwen2.5-7B LLM + hosted ZeroGPU FLUX image Spaces), Google Gemini free tier (chat/voice/intent), Groq (optional voice fallback), Pollinations.ai (image fallback).

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
`node-cron` `"0 8,16 * * *" UTC` — rotates FB themes (12) and LinkedIn topics (7 job-seeking + 15 project-showcase), generates content, posts each platform in parallel (`Promise.allSettled`), guarded against overlap. The 08:00 LinkedIn slot is job-seeking, the 16:00 slot is a project showcase.

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
- 2 runs/day (08:00 + 16:00 UTC): Facebook posts at both, LinkedIn job-seeking post at 08:00 and LinkedIn project-showcase post at 16:00 — all in parallel.
- Persisted topic rotation so each platform's posts never repeat back-to-back (`social_topics.json`).
- `running` guard prevents overlapping ticks.
- Persisted on/off state (`data/auto_mode.json`), defaults ON.

### 4.2 Auto-mode toggle command
- Telegram command detected line-wise: must contain **action** (`turn|switch` + `on|off`) **and** trigger (`auto mode`) in one line.
- Replies with current state; scheduler skips ticks when OFF.

### 4.3 Facebook writer (Victor's poetic-therapist voice)
- Rewritten prompt: adapts to ANY theme, **varies the opening** (no more repeated "To my dear girls"), poetic verse, aphoristic truth.
- **"Fickle youth"** signature appended programmatically to EVERY Facebook post (not left to the model).

### 4.4 LinkedIn writers (two formats)
- **Job-seeking post (08:00 UTC):** addressed to hiring managers and people who know them — makes obvious what Victor does, what he wants, the type of company he wants, who to connect him to, and how the reader can help.
- **Project showcase (16:00 UTC):** analytical build-in-public case study of a real project (ForChi, Milo, CLAY, CloudVoid, Flamchi, Sirxlud, Myzelva), including the real failures — not poetic, never AI news, never invented metrics.
- Both end with 3–6 **high-converting hashtags** that survive the cleanup step (`keepHashtags`).

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

### 4.10 Web search grounding (current events)
- Chat auto-detects factual/current questions (who/what/when/where/why/how + latest/current/news/202x/?) and **searches the web** before answering.
- **Fallback loop:** Serper (Google) -> Exa -> Firecrawl -> Tavily -> **DuckDuckGo** (free, last resort). Skips missing keys; first provider with results wins.
- Search snippets are injected as context so the LLM answers from **live data** instead of stale training knowledge (e.g. "Anthropic's latest model" -> Claude Mythos 5, not Claude 3.5).
- Keys in env: `SERPER_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `TAVILY_API_KEY` (note: Tavily key was 401, kept last).

### 4.11 V10 long-form YouTube automation (channel @sirxlud)
- **End-to-end pipeline** (`src/workflows/video/v10Pipeline.js`): script -> scene design -> voice -> images -> assemble -> thumb -> upload, up to **2 videos/day** (build 08:00/16:00 WAT, publish 14:00/20:00 WAT = 2pm/8pm Nigerian time via `v10Scheduler.js`).
- **Script generation** (`v10ScriptGen.js`): theme rotation across 5 playlists (Church & Bible, Family, World Folklore, Love & Relationships, Book Summaries), search-grounded obscure folklore, 4-act structure with a 5-beat retention arc, and curiosity-gap **"Why..." titles** (never clickbait; never "watch till the end").
- **Voice cloning** (Higgs Audio v3 TTS on HF ZeroGPU, `forchi_higgs_tts3_space/app.py`): baked-in "Victor Moore (clean)" persona; consistent voice enforced by fixed seed + Higgs-only retries before any fallback.
- **AI visuals**: Google image model scene designer + Vertex AI / Gemini image generation with a consistent narrator character; frames assembled with word-synced timing.
- **Subtitles & "why" captions (2026-09-01)**: subtitles are **burned into the video** (bottom captions synced to each shot via `textfile=` drawtext — safe for any narration) plus the "Why" hook over the opening seconds; the SRT caption track is also uploaded to YouTube.
- **YouTube Data API v3**: upload, custom thumbnail, captions, auto-sort into topic playlists; OAuth with an automatic weekly re-auth watcher.

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
    chatChain.js            # chat framing + chatReply + web grounding hook
    webSearch.js            # search fallback loop (Serper→Exa→Firecrawl→Tavily→DuckDuckGo)
    contentGen.js           # FB/LI generators, cleanPostFormatting, Fickle youth
  scheduler/
    jobs.js                 # 2×/day auto scheduler (FB + LI)
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
| `SERPER_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY` / `TAVILY_API_KEY` | Web search providers (chat grounding) | optional |
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

## 9. Jobs Workflow — Autonomous Job Discovery & Application Agent

**Status:** BUILT & LIVE (v3.3, 2026-09-01) — running on **constant auto** alongside the social and video workflows. ForChi now runs **THREE autonomous workflows**: (1) **Social** — "Fickle youth" Facebook posts (2×/day) + LinkedIn job-seeking & project-showcase posts (2×/day); (2) **Video** — the V10 long-form YouTube pipeline (2 videos/day); (3) **Jobs (this section)** — discovers remote intern/junior roles matching Victor's real profile, scores them, writes human-sounding cover letters + tailored resumes, and **auto-applies** to trusted ATS portals. A Telegram digest of applications lands every day at **20:00 WAT**. Full detail lives in `ForChi_Jobs_Blueprint.md`.

### Why it works
- The major modern ATS — **Greenhouse, Lever, Workable, Ashby** — serve public postings **and** public application endpoints, so submissions can be made with a plain HTTP POST (multipart: resume PDF + fields + answers) like a human browser.
- LinkedIn / Indeed / Upwork are bot-protected → used for **discovery only**, never automated submission.
- Applications must sound like the human wrote them — the same "voice" discipline as the Facebook posts, but in Victor's **natural conversational register**, not poetry.
- Cover letters must prove: **(a)** the JD was read (mirror its own terms), **(b)** the company is known (researched), **(c)** why they need someone like him (real projects mapped to their problems).

### Module map (`src/workflows/jobs/`)
```
profile.js      # real profile: resume data, target roles, voice rules
portfolio.js    # GROUNDING CORPUS: real facts from ForChi, Flamchi/Odonata, CLAY,
                #   CloudVoid, Footchristo — every claim is sourced, never invented
tailor.js       # per-job resume tailoring (ATS keyword-leading, real projects)
db.js           # jobs + applications tables (SQLite or Postgres), never-apply-twice
sources/        # greenhouse/lever/workable/ashby/remoteok/weworkremotely/linkedin/...
matcher.js      # Gemini scores each job vs profile -> {score, apply, reason}
researcher.js   # web-search company research (what they do, why they need you)
writer.js       # HUMAN-VOICE cover letters + screening answers (the pillar)
applyEngine.js  # trusted-ATS submit (multipart POST), pacing + caps + never-twice
emailer.js      # semi-auto match emails (Resend HTTPS API; Render blocks SMTP)
scheduler.js    # CONSTANT AUTO loop (every 30 min) + daily 20:00 WAT report
```

### Pipeline (5 stages)
1. **DISCOVER** — 9 source channels (Greenhouse/Lever/Workable/Ashby boards, RemoteOK, WeWorkRemotely, Remotive, Jobicy, Arbeitnow, Himalayas, LinkedIn guest API); normalize → one shape; dedupe by `(company, title, url)`.
2. **MATCH** — Gemini scores each new job against the real profile → strict JSON `{score, matched_skills, missing_skills, apply, reason}`; only `score >= 70` with `apply=true` proceed.
3. **WRITE** — the researcher web-searches the company first, then the writer produces a tailored cover letter (proves JD read + company known + why him) and answers to every screening question, in Victor's real voice, grounded in the portfolio corpus (never fabricated).
4. **APPLY** — trusted-ATS submit via the public application endpoint (multipart: real identity + tailored resume PDF + human answers). HARD RULE: never apply twice (unique index + pre-checks). Anti-spam: daily cap, apply window 07–19 UTC, pacing (~10 per 30-min scan).
5. **NOTIFY** — daily report at **20:00 WAT** (19:00 UTC): applied in last 24h, totals, queued, skipped, emailed, source breakdown. Controls: `/jobs status`, `/jobs queue`, `/jobs applied`, `/jobs notify`, `/jobs stop` (safety kill-switch).

### Scheduler — CONSTANT AUTO (separate from social)
- Always-on scan+apply loop every **30 min** (`JOBS_SCAN_INTERVAL_MIN`), no manual apply trigger. Freshness gate: roles **> 14 days old are never applied to** (`JOBS_MAX_AGE_DAYS`). Independent persisted state (`data/jobs_mode.json`); only `/jobs stop`/`/jobs start` control it.

### Sources — auto vs semi-auto
| Source | Type | Auto-apply? |
|---|---|---|
| Lever / Ashby (named cos: Netflix, Coinbase, Spotify, Asana, Box, Fivetran, Intercom…) | ATS boards | ✅ auto (multipart submit verified) |
| Greenhouse (OpenAI, Anthropic, Stripe, Shopify, Zapier, Render, Databricks…) | ATS board | manual (no public submit API; reCAPTCHA embed) → email |
| Workable | ATS board | manual (apply endpoint bot-gated 412) → email |
| RemoteOK, WeWorkRemotely | remote boards | manual (semi-auto → email) |
| Remotive, Jobicy, Arbeitnow, Himalayas | free JSON APIs | manual (semi-auto → email) |
| LinkedIn (guest jobs API) | public search | manual (semi-auto → email) unless upgraded to ATS |

### v3.2 highlights (2026-08-18)
- **LinkedIn → ATS auto-apply:** if a LinkedIn job also lives on a company Greenhouse/Lever/Ashby/Workable board, it's rewritten to that source and auto-applied (strict company guard + title-verified board API resolution; ~4/15 upgraded per scan).
- **Semi-auto emails:** every semi-auto match sends one email per job (apply link + tailored cover letter in body + tailored resume PDF) via **Resend HTTPS API** (Render blocks ALL outbound SMTP — verified). Never double-emails (`emails` table, `job_id` UNIQUE).
- **Postgres persistence:** `JOBS_DATABASE_URL` (Neon/Supabase) survives redeploys; SQLite stays the zero-config default.

### v3.3 highlights (2026-09-01) — strict targeting + proof-based applications
- **STRICT role filter (USER DIRECTIVE):** the scanner now only keeps **intern / junior / entry-level** roles in **one of five focus domains** — (1) Cloud Security, (2) DevOps / SRE / Platform (added), (3) AI Integration, (4) Workflow Automation, (5) API Integration. A job must contain BOTH a level word (intern/internship/junior/entry-level/graduate/associate) AND a domain keyword, so senior/lead/staff titles and unrelated roles are dropped before any AI scoring (`aggregators.js`, `linkedin.js` keywords, `matcher.js` FOCUS DOMAINS hard rule, `profile.js` targetRoles).
- **PROOF, NOT PROMISES (the core rule):** every resume bullet and cover-letter line describes something **already built and shipped** that matches the job description — never "I can / I will". The resume is tailored per JD (mirrors its vocabulary), the cover letter is a brief opening + a short showcase of real builds with live links (**cloudvoid.online**, **myzelva.com**, **youtube.com/@sirxlud**) + a company-specific P.S.
- **Base resume rebuilt** as a legible 2-page PDF from the updated real profile (CloudVoid multi-chain wallet, ForChi video + jobs engine, Flamchi/Odonata, sirxlud YouTube channel) — per-job tailored resumes still render at 1 page.
- **CRITICAL language-detection bug fixed:** the detector matched the common English word "team" as German/Dutch/Italian, so **English job descriptions were producing cover letters and resumes written in German** — a likely contributor to rejections. Fixed in `lang.js` (removed ambiguous words) and verified: English JDs stay English, real non-English JDs still translate.

### Honesty policy
- **WILL:** tailor the real resume per job, ground every claim in the real portfolio corpus, skip jobs where the real gap is too large.
- **WON'T:** fabricate employers, titles, years, or credentials (the one thing that gets offers rescinded). Identity fields are real (from the resume).

### Status & hard lessons (2026-08-19)
- **Auto-apply fix (the "0 applied" root cause):** `submitApplication` was calling `getResumeBuffer()` **without `await`** — it returns a Promise (pdfkit render), so every submission uploaded a Promise object as the resume and every ATS rejected it ("Resume file contents do not match the file extension") → 21 jobs marked failed, **0 applied, ever**. Now awaited; emails worked only because the email path awaited it.
- **Greenhouse reclassified to semi-auto (email):** it has **no public application-submit API** (`boards-api .../application` → 404; bare → 401) and its embed form is **reCAPTCHA-protected**, so greenhouse auto-apply is impossible over HTTP. Lever/Workable/Ashby remain auto sources (Lever endpoint verified to accept the rendered PDF).
- Verified live: discovery ~1,223 raw jobs/pass, matcher/writer/tailor produce real cover letters + one-page PDFs, daily report + `/jobs` commands working, Postgres connected via the crash-proof client.

---

## 10. Next Steps / Recommendations

1. **Let the strict job filter run for a few days** and confirm the queue stays high-quality (DevOps/SRE domain just added 2026-09-01); tune `LEVEL_TERMS`/domain clusters if coverage is too thin or too noisy.
2. **Watch the V10 daily videos** for the new burned-in subtitles + "Why" hook captions; verify the narration now always finishes its final sentence (max-token + truncation guards shipped 2026-09-01).
3. **Verify first auto-post with new image styles** after next scheduled slot.
4. **Optional:** re-run the reference-style test (`tools/test_ref_styles.js`) and tune prompts if the art type is slightly off.
5. **Optional:** fix the own ZeroGPU Space (`slymun/forchi-img`) if desired — it's a backup now; hosted FLUX is primary.
6. **Monitor UptimeRobot** for Render/LLM/Image monitors (occasional brief alerts during deploys are expected).
7. **Keep `keepalive.yml`** running; consider disabling GitHub Actions keep-alive if UptimeRobot alone is preferred (saves Actions minutes).
