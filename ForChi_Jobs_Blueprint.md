# ForChi Jobs — Autonomous Job Discovery & Application Agent (Blueprint)

> **Status:** Design phase — NOT built yet.
> **Goal:** A trigger-based workflow *inside ForChi* that continuously discovers jobs matching the user's real profile, scores them, and **auto-applies** to trusted ATS portals with **human-sounding** cover letters and screening answers — so the user wakes up to a Telegram digest of proposals/applications instead of doing it all manually.
> **Non-goals (v1):** LinkedIn Easy Apply automation, Upwork/Freelancer auto-bidding, fabricated credentials.

---

## 1. Why this works (the core insight)

- The major modern ATS — **Greenhouse, Lever, Workable, Ashby** — serve public job postings **and public application endpoints** that are **not** hidden behind Cloudflare.
- That means an application can be submitted with a plain HTTP POST (multipart: resume PDF + fields + answers) exactly like a human browser would — no headless-browser cat-and-mouse.
- LinkedIn / Indeed / Glassdoor / Upwork **are** bot-protected and ToS-restricted → use them for **discovery only**, never for automated submission.
- **Differentiation:** applications must sound like the human wrote them. This is the "voice" layer — the same discipline used to make the Facebook posts sound like "Fickle youth".

---

## 2. Architecture (reuses ForChi's existing stack)

```
        ┌─────────────────────────────────────────────────────────┐
        │  ForChi bot (Node.js + Telegraf) — Render free tier      │
        │                                                         │
        │  Social workflow  (unchanged)     Jobs workflow (NEW)    │
        │  - autoMode scheduler             - jobs scheduler       │
        │  - FB / LI posts                  - Telegram /jobs cmds  │
        └─────────────────────────────────────────────────────────┘
                          │  reuse
        ┌─────────────────▼──────────────────────────────┐
        │  provider.js (Gemini key rotation)              │
        │  webSearch.js (Serper→Exa→Firecrawl→DDG)        │
        │  SQLite (data/forchi.db)                        │
        └─────────────────────────────────────────────────┘
```

**New module tree (when we build):**
```
src/workflows/jobs/
  profile.js          # user profile: resume data, target roles, voice rules
  db.js               # jobs + applications tables (SQLite)
  sources/            # normalized job scrapers
    greenhouse.js     # boards-api.greenhouse.io  (public JSON)
    lever.js          # api.lever.co/v0/postings   (public JSON)
    workable.js       # apply.workable.com/api/v3  (public JSON)
    ashby.js          # api.ashbyhq.com/posting-api (public JSON)
    remoteok.js       # remote boards (HTML/JSON)
    weworkremotely.js # remote boards (HTML)
    linkedin.js       # DISCOVERY ONLY (guest search + optional session)
    companies.js      # target-company careers-page scraper (generic)
  matcher.js          # Gemini scores each job vs profile → JSON {score, apply}
  writer.js           # HUMAN-VOICE cover letters + screening answers (pillar)
  applyEngine.js      # submits to trusted ATS (multipart POST), pacing + caps
  scheduler.js        # separate cron from social (e.g. every 6h) + trigger
  notify.js           # Telegram digests (morning report, applied list)
```

---

## 3. Pipeline

### Stage 1 — DISCOVER
- Pull jobs from: Greenhouse / Lever / Workable / Ashby company boards, RemoteOK, WeWorkRemotely, LinkedIn Jobs (discovery), and a **target-company list** (company careers pages).
- Normalize every job to one shape: `{source, company, title, url, location, salary, description, posted_at}`.
- **Dedupe** by `(company, title, url)`; store raw text for matching. New jobs only.
- Respect `robots.txt` + modest concurrency. A few hundred new jobs/day is trivial for free tier.

### Stage 2 — MATCH (Gemini)
- Each new job → Gemini, prompt = `profile + target roles + job description`.
- Output strict JSON: `{ score: 0-100, matched_skills: [], missing_skills: [], apply: boolean, reason }`.
- Jobs `score >= threshold` (configurable) proceed; others archived.

### Stage 3 — WRITE (the human-voice pillar)
- For each approved job, the **writer** generates:
  1. A short tailored **cover letter** (2–4 plain paragraphs).
  2. Answers to every screening question in the JD.
- **Voice rules (hard constraints):** plain first-person prose, conversational but professional; no "AI spacing" — no bullet-spam, no robotic em-dash rhythm, no "As an AI… / I am excited to apply…" template openers; varied sentence length; concrete references to real projects (CloudVoid, ForChi, CLAY, the 360k-match model); naturally signed. This is the same "make it sound like him" discipline as the Facebook writer.
- Every generated answer is **stored and reviewable** in Telegram before/after submission.

### Stage 4 — APPLY (full-auto, trusted ATS only)
- Submit via the ATS's public application endpoint (multipart form: **real** name/email/phone + tailored resume PDF + human-voice answers):
  - **Greenhouse:** `boards-api.greenhouse.io/v1/boards/{company}/jobs/{id}/application`
  - **Lever:** `jobs.lever.co/{company}/{postingId}/apply`
  - **Workable:** `apply.workable.com/api/v3/accounts/{company}/jobs/{shortcode}/apply`
  - **Ashby:** `jobs.ashbyhq.com/{company}/{postingId}/application`
- **Anti-spam / realism controls:**
  - Daily cap (default ~8–10 applies).
  - Apply window (e.g. only 08:00–20:00 **WAT**) so timestamps look human.
  - Pacing: spread applies across the window, randomized delays.
  - One application per job, recorded in `applications` table.
- Non-trusted sources (LinkedIn discovery, company pages, anything sketchy) → **semi-auto**: agent prepares everything, user taps approve in Telegram.

### Stage 5 — NOTIFY
- Morning digest to Telegram: applied to N jobs (with scores), M pending match, K archived, any responses/rejections.
- Commands: `/jobs on|off`, `/jobs scan`, `/jobs queue`, `/jobs applied`, `/jobs digest`, `/jobs stats`, `/jobs pause`.

---

## 4. Scheduler & trigger (separate from social)
- Own cron, e.g. `0 */6 * * *` (scan+apply every 6h) with a morning digest.
- Independent persisted toggle (`data/jobs_mode.json`), defaults **off** until configured.
- Manual trigger: `/jobs scan` anytime.

---

## 5. The honesty policy (what we will and won't do)
- **WILL:** ATS-tailor the real resume per job — reorder skills, lead with keywords from the JD, phrase real projects to match. This is legitimate and beats inflated years at beating ATS filters.
- **WON'T:** Fabricate employers, titles, years, or credentials. That is the one thing that gets offers rescinded at reference/background-check time.
- **WILL:** skip jobs where the real gap is too large (honest filtering → higher response rate).
- Identity fields (name/email/phone) are the user's real ones; only *content* is tailored.

---

## 6. Free-tier feasibility
- Scraping: plain HTTP/fetch + JSON — cheap, no browser.
- Matching/writing: Gemini free tier with the existing 14-key rotation (a few hundred short calls/day is well within quota).
- Hosting: Render free tier + existing keep-alive.
- Storage: SQLite (existing `data/`).
- Only deviation: if a specific target company's careers page requires JS rendering, add Playwright **only for that one page** (opt-in).

---

## 7. Build milestones (order)
1. **Profile ingestion** — ingest the user's fresh resume + target roles + voice rules (the human-voice prompt).
2. **Discovery** — Greenhouse/Lever/Workable/Ashby + remote boards + dedupe DB; `/jobs scan`.
3. **Matcher** — Gemini scoring + Telegram queue.
4. **Writer** — human-voice cover letters + screening answers, preview in Telegram.
5. **Apply engine** — trusted-ATS submission + caps/pacing + applications log.
6. **Scheduler + digests + toggles** — morning report, `/jobs` commands.

---

## 8. Open questions (to confirm before building)
- [ ] Share the **fresh resume** (the base profile).
- [ ] Target-company shortlist (specific companies to scrape first)?
- [ ] Daily apply cap + apply window defaults OK? (8–10/day, 08:00–20:00 WAT)
- [ ] Start with which ATS? (suggest Greenhouse + Lever first)
- [ ] Email/phone/name confirmation for applications.
