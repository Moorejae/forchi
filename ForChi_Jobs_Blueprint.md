# ForChi Jobs — Autonomous Job Discovery & Application Agent (Blueprint)

> **Status:** Design locked (v2, 2026-08-16) — NOT built yet.
> **Goal:** A workflow *inside ForChi* that runs on **constant auto** (no manual trigger): continuously discovers jobs matching the user's real profile, scores them, and **auto-applies** to trusted ATS portals with **human-sounding** cover letters and screening answers — so the user wakes up to a Telegram digest of applications instead of doing it all manually.
> **Non-goals (v1):** LinkedIn Easy Apply automation, Upwork/Freelancer auto-bidding, fabricated credentials.

---

## 1. Why this works (the core insight)

- The major modern ATS — **Greenhouse, Lever, Workable, Ashby** — serve public job postings **and public application endpoints** that are **not** hidden behind Cloudflare.
- That means an application can be submitted with a plain HTTP POST (multipart: resume PDF + fields + answers) exactly like a human browser would — no headless-browser cat-and-mouse.
- LinkedIn / Indeed / Glassdoor / Upwork **are** bot-protected and ToS-restricted → use them for **discovery only**, never for automated submission.
- **Differentiation:** applications must sound like the human wrote them. This is the "voice" layer — the same discipline used to make the Facebook posts sound like "Fickle youth", but for applications the register is the user's **normal conversational voice**, not poetry.
- **HR reads for proof.** Recruiters assume most applicants never read the JD or researched the company. Cover letters explicitly demonstrate: **(a)** the description was read, **(b)** the company is known, **(c)** why they need someone like the user. That alone clears most screenings.

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
  portfolio.js        # GROUNDING CORPUS: real facts from ForChi + Flamchi (Odonata)
                      #   + CLAY + CloudVoid + Footchristo blueprints → every claim the
                      #   writer makes is sourced here, never invented
  tailor.js           # per-job resume tailoring (ATS keyword-leading, real projects)
  db.js               # jobs + applications tables (SQLite), unique-applied index
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
  researcher.js       # web-search company research (what they do, why they need you)
  writer.js           # HUMAN-VOICE cover letters + screening answers (pillar)
  applyEngine.js      # trusted-ATS submit (multipart POST), pacing + caps + never-twice
  scheduler.js        # CONSTANT AUTO loop (no manual trigger), separate from social
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
- Before writing, the **researcher** runs a web search on the company (and the JD) so the letter proves real knowledge: what they build, recent moves, why someone like the user fits.
- For each approved job, the **writer** generates:
  1. A short tailored **cover letter** (2–4 plain paragraphs) that explicitly shows: **(a)** the JD was read (mirror its own terms and required skills), **(b)** the company is known (reference their product / mission / recent news from the research), **(c)** why they need someone like the user (map real projects to their problems).
  2. Answers to every screening question in the JD, in the same voice.
- **Voice rules (hard constraints):** the user's NATURAL conversational voice — plain, direct, first-person, confident, short sentences, zero fluff — NOT the poetic register. Model: his own resume summary ("I build cloud infrastructure and AI systems... I build fast, usually in days rather than months.") and how he actually talks. No "AI spacing" — no bullet-spam, no robotic em-dash rhythm, no "As an AI… / I am excited to apply…" template openers.
- **Grounding (never fabricate):** every claim about the user's work comes from the **portfolio corpus** — the ForChi, Flamchi/Odonata, CLAY, CloudVoid, and Footchristo blueprints and their real numbers (e.g. "a 24/7 sports-prediction bot at ~70% blind accuracy across three sports, validated on data it never trained on"; "a 21-container multi-agent system"; "a non-custodial escrow platform on OCI/Kubernetes"). The writer may tailor and rephrase — it may NOT invent projects, employers, numbers, or years that aren't in the corpus or resume.
- Every generated answer is **stored and logged**, and reviewable in Telegram.

### Stage 4 — APPLY (constant full-auto, trusted ATS only)
- **Always-on:** this workflow runs on CONSTANT AUTO — no manual scan/apply trigger (unlike the social workflow). It stays awake (keep-alive), catches new postings as they appear, and applies to any in-scope job automatically. An emergency `/jobs stop` remains only as a safety kill-switch, not a manual apply trigger.
- Submit via the ATS's public application endpoint (multipart form: **real** name/email/phone + **tailored resume PDF** + human-voice answers):
  - **Greenhouse:** `boards-api.greenhouse.io/v1/boards/{company}/jobs/{id}/application`
  - **Lever:** `jobs.lever.co/{company}/{postingId}/apply`
  - **Workable:** `apply.workable.com/api/v3/accounts/{company}/jobs/{shortcode}/apply`
  - **Ashby:** `jobs.ashbyhq.com/{company}/{postingId}/application`
- **HARD RULE — never apply to the same job twice:** every application is recorded; before any submit the agent checks `(company, title, url)` + ATS post-id; the `applications` table has a unique index so a duplicate is impossible, even across restarts.
- **Per-job resume tailoring:** the **tailor** rewrites the real resume for the specific job — reorders skills to lead with the JD's keywords, rephrases bullets to match, keeps every fact real. HR gets a resume that reads like it was written for that exact role.
- **Anti-spam / realism controls:**
  - Daily cap (default ~8–10 applies) — human volume.
  - Apply window (e.g. only 08:00–20:00 **WAT**) so timestamps look human.
  - Pacing: spread applies across the window, randomized delays.
- Non-trusted sources (LinkedIn discovery, company pages, anything sketchy) → **semi-auto**: agent prepares everything, user taps approve in Telegram.

### Stage 5 — NOTIFY
- Morning digest to Telegram: applied to N jobs (with scores), M pending match, K archived, any responses/rejections.
- Controls: `/jobs stop` + `/jobs start` (safety kill-switch only — no manual apply trigger), `/jobs queue`, `/jobs applied`, `/jobs digest`, `/jobs stats`.

---

## 4. Scheduler & trigger — CONSTANT AUTO (separate from social)
- **Always-on, no manual trigger.** Continuous scan+apply loop catches new postings as they appear, plus a morning digest. Uses the existing keep-alive so Render never sleeps.
- Independent persisted state (`data/jobs_mode.json`); the only controls are an emergency `/jobs stop` / `/jobs start` safety kill-switch — NOT a manual apply trigger.
- **Never posts to the same job twice** (see Stage 4 hard rule).

---

## 5. The honesty policy (what we will and won't do)
- **WILL:** ATS-tailor the real resume per job — reorder skills, lead with keywords from the JD, phrase real projects to match. This is legitimate and beats inflated years at beating ATS filters.
- **WILL:** ground every claim in the **portfolio corpus** (ForChi + Flamchi/Odonata + CLAY + CloudVoid + Footchristo blueprints and their real numbers). The agent talks about what was actually built — it never manufactures projects, employers, numbers, or years "out of thin air."
- **WON'T:** Fabricate employers, titles, years, or credentials. That is the one thing that gets offers rescinded at reference/background-check time.
- **WILL:** skip jobs where the real gap is too large (honest filtering → higher response rate).
- Identity fields (name, email, phone, LinkedIn, GitHub) come from the resume — real, never invented.

---

## 6. Free-tier feasibility
- Scraping: plain HTTP/fetch + JSON — cheap, no browser.
- Matching/writing: Gemini free tier with the existing 14-key rotation (a few hundred short calls/day is well within quota).
- Hosting: Render free tier + existing keep-alive.
- Storage: SQLite (existing `data/`).
- Only deviation: if a specific target company's careers page requires JS rendering, add Playwright **only for that one page** (opt-in).

---

## 7. Build milestones (order)
1. **Profile + portfolio ingestion** — ingest the resume (`Agu_Victor_Chiedozie_Resum.pdf`) + the ForChi & Flamchi/Odonata blueprints into the grounding corpus; extract the natural conversational voice.
2. **Discovery** — Greenhouse/Lever/Workable/Ashby + remote boards + dedupe DB; continuous scan loop.
3. **Matcher** — Gemini scoring + apply/no-apply decision.
4. **Researcher + Writer** — company research, human-voice cover letters + screening answers, grounded in the portfolio corpus.
5. **Tailor + Apply engine** — per-job resume tailoring, trusted-ATS submission, never-twice enforcement, caps/pacing, applications log.
6. **Constant-auto loop + digests + safety controls** — morning report, `/jobs` commands.

---

## 8. Decisions locked (2026-08-16)
- [x] Base profile = `Agu_Victor_Chiedozie_Resum.pdf` (Cloud & AI Systems Engineer). Identity: aguchiedoxie@gmail.com / +234 816 280 2162 / linkedin.com/in/aguchiedoxie / github.com/Moorejae.
- [x] Grounding corpus = ForChi + Flamchi (V61 Odonata) + CLAY + CloudVoid + Footchristo blueprints and real numbers.
- [x] Target roles: AI/LLM Engineer, Cloud/DevOps Engineer, Automation Engineer, Freelance contracts.
- [x] Apply mode: CONSTANT FULL-AUTO for trusted ATS (Greenhouse / Lever / Workable / Ashby); no manual trigger; never apply twice; stay awake.
- [x] LinkedIn: discovery only. Freelance platforms: out of scope for v1.
- [x] Voice: natural conversational (non-poetic), modeled on the resume summary + how the user talks.
- [x] Cover letters must prove: JD read + company known + why they need someone like him.
- [ ] At build time: confirm first ATS (suggest Greenhouse + Lever), target-company shortlist, daily cap + window (8–10/day, 08:00–20:00 WAT).
