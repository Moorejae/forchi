# ForChi Autonomous-Agent Operating Convention

> The user's rule (2026-08-31): **one issue = one session.** Never extend a long
> session when a new, focused one is cheaper. The agent is woken on demand (see
> `src/watchdog/wakeTrigger.js`) and works on the VPS via code-server.

## Why
- A long-running session accumulates context and burns more tokens per turn.
- A **fresh session** for each new issue loads only what that issue needs
  (repo memory + the relevant files), so it's cheaper and less error-prone.
- The VPS runs 24/7 (code-server + systemd services), so the agent can start a
  new session any time a trigger fires — it never depends on the user's PC.

## Session cache / handoff model
1. **Every issue gets a NEW session.** If you're continuing prior work, first
   read the latest session memory (`/memories/session/`) and the relevant
   `V10_HANDOFF_SUMMARY*.md` / `BLUEPRINT.md` docs — do NOT re-derive state from
   a stale session transcript.
2. **End-of-session = write the handoff.** When a task is done (or blocked),
   save a concise summary to `/memories/session/<topic>-<date>.md` covering:
   - What was done (with commit SHAs)
   - Current VPS state (services, mode switches, tokens/keys used)
   - What's next / open issues
   - Any gotchas discovered (e.g. "execFileSync systemctl returns null",
     "VPS .env has no GEMINI_PAID_API_KEY", "voice runs under /opt/voice/venv")
3. **Wake-trigger = new session per alert.** `wakeTrigger.js` writes a wake file
   under `temp_media/wake/` and sends a Telegram alert. On a wake, open a fresh
   session, read the wake file, fix, and close it. Do NOT keep a session alive
   just to "watch" — the trigger does the watching for free.

## Where state lives (VPS /opt/forchi)
| Item | Path |
|---|---|
| Workflow lock (one-at-a-time) | `temp_media/workflow.lock` |
| Wake trigger state | `temp_media/wake_trigger_state.json` + `temp_media/wake/` |
| V10 mode (2 posts/day) | `temp_media/v10_mode.json` |
| Shorts mode | `temp_media/video_mode.json` |
| Auto mode | `data/auto_mode.json` |
| V10 posts log | `temp_media/v10_posts.json` |
| YouTube refresh token | `.env` (`YOUTUBE_REFRESH_TOKEN`) — VPS only |
| V10 FB page token | `.env` (`V10_FACEBOOK_PAGE_ACCESS_TOKEN`) — page-scoped, darkwaall |
| Gemini keys | `.env` (`GEMINI_KEYS`) — used by scriptgen/designer waterfall |
| code-server password | `/root/.code-server-password` (VPS, root-only) |

## Rules of engagement
- **Nothing runs on the user's PC.** The PC is often off. All services run on
  the VPS (`forchi`, `v10-watchdog`, `voice-worker`, `v61-bot`,
  `forchi-wake`, `code-server`). Check with `systemctl is-active` on the VPS.
- **One workflow at a time.** `workflowLock.js` enforces it; never bypass it.
- **Deploy via git**: commit to `github` remote → VPS `git pull` → restart the
  relevant systemd service. (The VPS pulls `origin` = the GitHub repo.)
- **Secrets never in chat.** Keys/passwords stay in `.env` on the VPS (or
  `/root/.code-server-password`); the agent reads them from the box, never asks
  the user to paste them.
- **Accessing code-server** (browser on the user's PC):
  `ssh -L 8443:127.0.0.1:8443 root@217.77.1.187` then open `http://localhost:8443`
  with the password in `/root/.code-server-password`.
