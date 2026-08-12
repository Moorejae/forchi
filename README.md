---
title: FORCHI AI Partner & Social Workflow Engine
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# FORCHI v2 — Discord AI Partner

FORCHI is Victor's AI Partner and Social Media Automation Engine, now running on **Discord** (not Telegram). Powered by Node.js, Gemini 2.0 Waterfall, Gemma, Llama, and FLUX.1-dev visual generation — hosted 24/7 on Hugging Face Spaces.

## Architecture

```
Discord (gateway, outbound WebSocket)
   │
   └── Render (Docker web service, free tier + keep-alive ping)
        ├── discord.js bot (message + voice handling)
        ├── 3-layer router: regex gate → LLM extractor → social workflow
        ├── 3-tier LLM waterfall: Gemini (15 keys) → Gemma → Llama
        ├── SQLite (campaign scheduling)
        ├── node-cron (9AM UTC daily posts)
        ├── ffmpeg → Whisper (voice transcription)
        └── FLUX.1-dev (image generation)
```

> **Why not HF Spaces?** HF Spaces blocks outbound connections to Discord (and Telegram) at the network level, and there is no egress setting to change it. Render has unrestricted egress.

## Deploy to Render

1. Push this repo to GitHub (`Moorejae/forchi`).
2. On [render.com](https://render.com) → **New +** → **Blueprint** → connect the GitHub repo.
3. Render auto-detects `render.yaml` and creates the service.
4. **Set the secrets** (marked `sync: false` in `render.yaml`) in the Render dashboard:
   - `DISCORD_BOT_TOKEN` — your Discord bot token
   - `GEMINI_KEYS` — comma-separated Gemini API keys
   - `HF_TOKEN` — Hugging Face access token
   - `FACEBOOK_PAGE_ID` + `FACEBOOK_PAGE_ACCESS_TOKEN`
   - `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN`
5. **Keep-alive** (Render free tier sleeps after 15 min of inactivity):
   - Primary: [UptimeRobot](https://uptimerobot.com) free — monitor `https://forchi.onrender.com` at 5-min interval.
   - Backup: the GitHub Actions workflow in `.github/workflows/keepalive.yml` (15-min interval).

## Discord Setup (required)

In the [Discord Developer Portal](https://discord.com/developers/applications), for your bot:
- **Enable "Message Content Intent"** (Bot → Privileged Gateway Intents). Without this, the bot cannot read messages.
- Invite the bot with `bot` + `applications.commands` scopes.

## Local Development

```bash
npm install
# Copy .env.example to .env and fill in secrets
npm start
```

