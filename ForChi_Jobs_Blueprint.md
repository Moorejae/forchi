# ForChi Jobs — Autonomous Job Discovery & Application Agent (Blueprint)

> **Status:** ✅ **BUILT & LIVE** (v3, 2026-08-18) — running on **constant auto** on Render.
> **ForChi now runs TWO active workflows (both autonomous):**
> 1. **Social workflow** — Fickle youth Facebook posts + LinkedIn deep-dives, 5×/day, plus the daily 8pm WAT report.
> 2. **Jobs workflow (this doc)** — discovers jobs matching the user's real profile, scores them, and **auto-applies** to trusted ATS portals with **human-sounding** cover letters and screening answers — so the user gets a Telegram digest of applications every day at **20:00 WAT** instead of doing it all manually.
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
        │  Social workflow  (ACTIVE)        Jobs workflow (ACTIVE) │
        │  - autoMode scheduler             - jobs scheduler       │
        │  - FB / LI posts (5x/day)         - Telegram /jobs cmds  │
        │  - daily report 20:00 WAT         - daily report 20:00 WAT│
        └─────────────────────────────────────────────────────────┘
                          │  reuse
        ┌─────────────────▼──────────────────────────────┐
        │  provider.js (Gemini key rotation)              │
        │  webSearch.js (Serper→Exa→Firecrawl→DDG)        │
        │  SQLite (data/forchi.db)                        │
        └─────────────────────────────────────────────────┘
```

**Module tree (built & live, `src/workflows/jobs/`):**
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
- **Daily report at 20:00 WAT (19:00 UTC) every day** to the registered Telegram chat: applied in last 24h, total applied, queued, skipped, total jobs seen, apply mode/cap, freshness window (≤14d), and a source breakdown. Also sent shortly after boot if a chat is already known.
- A chat auto-registers for the report the first time it uses `/start` or `/jobs`.
- Controls: `/jobs status`, `/jobs queue` (with apply URLs + manual-apply markers), `/jobs applied`, `/jobs notify`, and the safety kill-switch `/jobs stop` + `/jobs start` (no manual apply trigger).

---

## 4. Scheduler & trigger — CONSTANT AUTO (separate from social)
- **Always-on, no manual trigger.** Continuous scan+apply loop (every 30 min) catches new postings as they appear, plus a daily report at **20:00 WAT**. Uses the existing keep-alive so Render never sleeps.
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

---

## 7. v3 — EXPANDED SOURCES (LinkedIn + aggregators)
The scan went from 2 boards + 25 companies to **9 source channels** (~2,500 jobs/discovery pass, ~17s):

| Source | Type | Auto-apply? |
|---|---|---|
| Greenhouse / Lever (**48** named cos: OpenAI, Anthropic, Stripe, Zapier, HashiCorp, DigitalOcean, Render, Vercel, PostHog, Perplexity, Cohere, Mistral…) | ATS boards | ✅ auto |
| Workable / Ashby (ATS-resolved from feeds) | ATS boards | ✅ auto |
| RemoteOK | remote board | manual (semi-auto) |
| WeWorkRemotely | remote board | manual (semi-auto) |
| **Remotive** | free JSON API | manual (semi-auto) |
| **Jobicy** | free JSON API | manual (semi-auto) |
| **Arbeitnow** | free JSON API | manual (semi-auto) |
| **Himalayas** | free JSON API | manual (semi-auto) |
| **LinkedIn** (guest jobs endpoint) | public search API | manual (semi-auto) |

### Key decisions (locked)
- **LinkedIn = guest jobs API, not web search.** `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` (no auth) returns 10 structured cards per query; we run 8 target-role keywords with `f_WT=2` (remote-only). Web-search scraping yielded ~1 job/scan; the guest API yields **~40–50**. Each posting's description is fetched for the matcher (og:description / JSON-LD, best-effort).
- **Aggregator feeds pre-filter by keyword** (AI/LLM/cloud/devops/backend/automation/python/node…) so we don't insert hundreds of irrelevant listings and burn Gemini scoring calls.
- **Cross-source URL dedup** — the same real posting found via Remotive + a Greenhouse board is stored once (URL unique check in `insertJobs`), so it can never be double-applied.
- **Semi-auto ≠ auto.** Aggregator + LinkedIn jobs are scored and queued, shown in `/jobs queue` **with their apply URL + a "manual apply" marker**, but never auto-submitted (no trusted submitter for them). The retry loop only re-attempts auto-appliable sources, so manual jobs don't churn every scan.
- ATS detection: if any feed listing points *directly* at a Greenhouse/Lever/Ashby/Workable posting URL, it's rewritten to that source and auto-applied by the existing engine (currently feeds link to their own pages, so this is a safety net for future feeds).

### Recency (freshness gate) — NEW
- **Scan cadence:** every **30 min** (`JOBS_SCAN_INTERVAL_MIN`, min 5) — catches newly-posted roles within ~30 min of posting.
- **Hard freshness gate:** roles **> 14 days old are never applied to** (`JOBS_MAX_AGE_DAYS`, default 14). Enforced at code level in the pipeline *before* scoring (saves Gemini calls) and again on queued retries (a queued role that ages out is dropped).
- Age = source `posted_at` when provided (Greenhouse `first_published`, Lever `createdAt`, Ashby `publishedAt`, RemoteOK `date`, Remotive `publication_date`, Jobicy `pubDate`, Arbeitnow `created_at`, Himalayas `pubDate`, LinkedIn card date); otherwise first-seen `created_at` is the proxy (unknown → treated fresh).
- Goal: target **24h–2 week** postings; the `getNewJobs` query already orders newest-first, so fresh postings are scored/applied before older backlog.

### Cost/scale guardrails
- Scans cap at ~40 LinkedIn cards + ~250 filtered aggregator jobs; `MAX_PER_RUN=25` scores per pass, so the backlog drains gradually and Gemini quota stays flat.
- Daily report now shows a **source breakdown** (`🗂 Sources: greenhouse=… · linkedin=… · …`) and the freshness window (`Fresh: ≤14d`).

### v3.2 — SEMI-AUTO EMAILS (one email per manual-apply job) (2026-08-18)
- Every **semi-auto match** (LinkedIn + Remotive/Jobicy/Arbeitnow/Himalayas/RemoteOK/WWR — no trusted submitter) now sends **one email per job** to `EMAIL_TO` (default `yonkkalu@gmail.com`) containing: the **apply link**, the **tailored cover letter** (in the body), and the **tailored resume PDF** (attachment). The user opens the link, taps Apply, and has the letter + resume ready — no digging through the Telegram queue.
- **Never double-emails**: a `emails` table (`job_id` UNIQUE) records each send.
- Emailer: `src/workflows/jobs/emailer.js`. **Send paths:** (1) **Resend HTTPS API** (`RESEND_API_KEY`, free at resend.com) — the reliable path because **Render free tier blocks ALL outbound SMTP** (587/465/2525 timeout; verified). (2) SMTP fallback (Gmail app password) for hosts that allow it. Config: `EMAIL_TO` (agumoorewe@gmail.com), `RESEND_API_KEY`, `EMAIL_FROM`, `SMTP_USER`/`SMTP_PASS`.
- `/jobs status` + daily report now show `Emailed: N`.
- **One-per-job, never twice:** `emails` table (job_id UNIQUE) + `hasSimilarHandled` (same company+title across sources).

### v3.1 — more auto-apply targets + persistence (2026-08-18)
- **+25 remote-friendly ATS companies** (Zapier, HashiCorp, DigitalOcean, Render, Vercel, PostHog, Sentry, Sourcegraph, Mux, Airtable, Figma, Webflow, Mixpanel, Duolingo, Zendesk, Instacart, Perplexity, Cohere, Mistral AI, Databricks, CrowdStrike, Discord, Fivetran, Intercom, Quora) → **48 total**, so the auto-apply path has real mid-level AI/cloud/backend targets.
- **Keyword pre-filter now also applies to company-board jobs** — only AI/cloud/backend/automation roles enter the pipeline, so auto-apply focuses on matches and the queue stays clean.
- **Postgres-ready persistence** (`JOBS_DATABASE_URL`): `db.js` now supports PostgreSQL (persistent across Render redeploys; the free-tier disk resets on every deploy), with SQLite as the zero-config default. To enable: create a free Neon/Supabase Postgres → set `JOBS_DATABASE_URL` (via `tools/set_env_var.js`) → redeploy. Bigint-safe counts included.
- **Daily-report chat id survives redeploys**: persisted to Render env var `JOBS_NOTIFY_CHAT_ID` (bot self-writes via Render API using `RENDER_API_KEY`/`RENDER_SERVICE_ID` added to its env).
- Hosting: Render free tier + existing keep-alive.
- Storage: SQLite (existing `data/`).
- Only deviation: if a specific target company's careers page requires JS rendering, add Playwright **only for that one page** (opt-in).

### v3.2 — LinkedIn non-Easy-Apply AUTO-APPLY + apply caps + resume PROJECTS restore (2026-08-18)
- **LinkedIn jobs that also live on a company ATS board are now AUTO-APPLIED**, not emailed. For each new LinkedIn job (`upgradeToAts` in `sources/linkedin.js`), the bot web-searches the company's Greenhouse/Lever/Ashby/Workable board (`"company" site:…`), then:
  1. **Strict company guard** — the ATS board slug must fully contain the company slug or vice versa (e.g. `northflank.com` ↔ `Northflank`, `unison` ↔ `Unison Group`). Deliberately **no fuzzy prefix matching** — `AlgorithmX` must never match the unrelated `algoritmi` board.
  2. **Title-verified resolution** — the board's official public API (Greenhouse `boards-api`, Lever `postings`, Ashby `posting-api`, Workable `widget/accounts`) is queried and the posting whose title scores ≥0.6 overlap is chosen, so we apply to the **exact role**, never a random opening at the company.
  3. **Last resort** — a directly-surfaced posting URL is trusted only if no board API responded.
  Verified live: 4/15 searched LinkedIn jobs upgraded per scan to a real, title-matching ATS posting; false positives (staffing-agency boards, empty boards) correctly rejected.
- **Apply rate capped at ~10 per 30-min scan** (`JOBS_APPLY_PER_RUN`, default 10) matching the user's explicit request; `JOBS_DAILY_CAP` raised to 300 so the per-scan budget governs. Existing pacing (`JOBS_APPLY_GAP_MS`, default 120 s between submissions) + apply window 07–19 UTC unchanged.
- **Resume PROJECTS section restored** to the original `PROJECT NAME / ROLE | YEARS | URL / - bullet` layout (the EXPERIENCE section keeps the mirror-JD-language template).

---

## 8. Build status (ALL DONE — live)
- [x] **Profile + portfolio ingestion** — resume + ForChi & Flamchi/Odonata grounding corpus; natural conversational voice.
- [x] **Discovery** — 9 source channels (Greenhouse/Lever boards, RemoteOK, WeWorkRemotely, Remotive, Jobicy, Arbeitnow, Himalayas, LinkedIn guest API) + dedupe DB; continuous 30-min scan loop.
- [x] **Matcher** — Gemini scoring + apply/no-apply decision (+ freshness gate, location rule).
- [x] **Researcher + Writer** — company research, human-voice cover letters + screening answers, language-aware (Polish/German/etc. post-translation).
- [x] **Tailor + Apply engine** — per-job resume tailoring to styled PDF (Carlito), trusted-ATS submission, never-twice enforcement, caps/pacing, applications log.
- [x] **Constant-auto loop + daily report + safety controls** — 20:00 WAT report, `/jobs` commands.

---

## 9. Decisions locked (2026-08-16)
- [x] Base profile = `Agu_Victor_Chiedozie_Resum.pdf` (Cloud & AI Systems Engineer). Identity: aguchiedoxie@gmail.com / +234 816 280 2162 / linkedin.com/in/aguchiedoxie / github.com/Moorejae.
- [x] Grounding corpus = ForChi + Flamchi (V61 Odonata) + CLAY + CloudVoid + Footchristo blueprints and real numbers.
- [x] Target roles: AI/LLM Engineer, **AI Integration Engineer, AI Automation Engineer, AI Solutions Engineer** (as a Cloud & AI Systems Engineer he also fits AI-integration/automation roles — wiring LLMs into products, agent pipelines, trigger-based automation, exactly what ForChi is), Cloud/DevOps Engineer, Automation Engineer, Backend Developer (Node.js/Python). Freelance contracts out of scope.
- [x] Apply mode: CONSTANT FULL-AUTO for trusted ATS (Greenhouse / Lever / Workable / Ashby); no manual trigger; never apply twice; stay awake.
- [x] LinkedIn: discovery only. Freelance platforms: out of scope for v1.
- [x] Voice: natural conversational (non-poetic), modeled on the resume summary + how the user talks.
- [x] Cover letters must prove: JD read + company known + why they need someone like him.
- [x] First ATS confirmed: Greenhouse + Lever (+ Workable/Ashby via ATS-resolved feeds). Daily cap **10/day**, apply window **07:00–19:00 UTC** (08:00–20:00 WAT), scan every 30 min, freshness ≤ **14 days**.
