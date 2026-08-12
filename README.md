---
title: FORCHI AI Partner & Social Workflow Engine
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# FORCHI v2 — Telegram AI Partner

FORCHI is Victor's AI Partner and Social Media Automation Engine, running on **Telegram** (long-polling). Powered by Node.js, Telegraf, Gemini 2.0 Waterfall, Gemma, Llama, and FLUX.1-dev visual generation — hosted 24/7 on Render.

## Architecture

```
Telegram (long-polling, outbound HTTPS)
   │
   └── Render (Docker web service, free tier + keep-alive ping)
        ├── telegraf bot (message + voice handling)
        ├── 3-layer router: regex gate → LLM extractor → social workflow
        ├── 3-tier LLM waterfall: Gemini (15 keys) → Gemma → Llama
        ├── SQLite (campaign scheduling)
        ├── node-cron (9AM UTC daily posts)
        ├── ffmpeg → Whisper (voice transcription)
        └── FLUX.1-dev (image generation)
```

> **Why not HF Spaces?** HF Spaces blocks outbound connections to Telegram (and Discord) at the network level, with no egress setting to change it. Render has unrestricted egress.

## Deploy to Render

1. Push this repo to GitHub (`Moorejae/forchi`).
2. On [render.com](https://render.com) → the repo is already connected as a web service (previously `milo-agent`).
3. **Set the secrets** (marked `sync: false` in `render.yaml`) in the Render dashboard:
   - `TELEGRAM_BOT_TOKEN` — your Telegram bot token (from @BotFather)
   - `GEMINI_KEYS` — comma-separated Gemini API keys
   - `HF_TOKEN` — Hugging Face access token
   - `FACEBOOK_PAGE_ID` + `FACEBOOK_PAGE_ACCESS_TOKEN`
   - `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN`
4. **Keep-alive** (Render free tier sleeps after 15 min of inactivity):
   - GitHub Actions workflow `.github/workflows/keepalive.yml` pings `https://milo-agent.onrender.com` every 10 minutes.
   - Optional extra: [UptimeRobot](https://uptimerobot.com) free (5-min interval) for redundancy.

## Telegram Setup

- Create the bot with [@BotFather](https://t.me/BotFather) to get the token.
- The bot uses **long-polling** (no webhook, no inbound ports needed).

## Local Development

```bash
npm install
# Copy .env.example to .env and fill in secrets
npm start
```


