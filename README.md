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
   └── HF Spaces (Docker, always-on)
        ├── discord.js bot (message + voice handling)
        ├── 3-layer router: regex gate → LLM extractor → social workflow
        ├── 3-tier LLM waterfall: Gemini (15 keys) → Gemma → Llama
        ├── SQLite (campaign scheduling)
        ├── node-cron (9AM UTC daily posts)
        ├── ffmpeg → Whisper (voice transcription)
        └── FLUX.1-dev (image generation)
```

## Deploy to HF Spaces

1. **Recreate the Space** on Hugging Face (`slymun/forchi`, Docker SDK).
2. **Add Secrets** in Space Settings → Variables and secrets:
   - `DISCORD_BOT_TOKEN` — your Discord bot token
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `GEMINI_KEYS` — comma-separated Gemini API keys
   - `HF_TOKEN` — Hugging Face access token (for router/Whisper/FLUX)
   - `FACEBOOK_PAGE_ID` + `FACEBOOK_PAGE_ACCESS_TOKEN`
   - `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN`
3. **Push code**: `git push origin main`

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

