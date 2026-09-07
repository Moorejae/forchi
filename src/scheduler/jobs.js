const cron = require("node-cron");
const socialWorkflow = require("../workflows/social/index");
const { generateFacebookPost, generateLinkedInPost } = require("../llm/contentGen");
const autoMode = require("./autoMode");
const wlock = require("./workflowLock.js");

// Auto mode: FACEBOOK 2 posts/day (08:00, 16:00 UTC).
const AUTO_SCHEDULE = "0 8,16 * * *";
// LINKEDIN — USER DIRECTIVE (2026-09-07): 2 posts per DAY (08:00 + 16:00 UTC).
// Slot 08:00 = "Did you know...?" learning post (teaches something new & useful
// in cloud / DevOps / AI / LLMs / systems — NO job-seeking, NO asks to share or
// refer Victor, NO pay talk). Slot 16:00 = build-in-public project showcase (real
// builds + failures). See LI_LEARN_TOPICS + LI_PROJECT_TOPICS and the generators.
function linkedinSlot(now = new Date()) {
  const h = now.getUTCHours();
  if (h === 8) return "learn";
  if (h === 16) return "project";
  return null;
}

// Rotating themes so posts stay fresh day to day.
const FB_THEMES = [
  "life, love, self-worth, and human nature",
  "marriage, sacrifice, and the value of independence",
  "hate, healing, and the power of dialogue",
  "patience, hard work, and protecting what you built",
  "gratitude, faith, and trusting God through hard times",
  "the quiet strength of people who keep going unseen",
  "a lesson from nature: what the wild teaches about letting go and adapting",
  "forgiveness and grace: releasing the pain so something holy can grow",
  "relationships and communication: why unspoken words slowly decay what we love",
  "loneliness and the quiet seasons: solitude as life clearing away the noise",
  "purpose and calling: building meaning from what makes you lose track of time",
  "resilience: standing tall in the middle of the storm, not waiting for it to pass",
];

// LinkedIn topics — USER DIRECTIVE (2026-09-07): LinkedIn runs 2/day (08:00 +
// 16:00 UTC). The 08:00 slot is a "Did you know...?" LEARNING post (teaches
// something new in cloud / DevOps / AI / LLMs / systems / security — replaced the
// old job-seeking post on 2026-09-07); the 16:00 slot is a PROJECT-SHOWCASE post
// (real builds + failures, never AI news). Each topic names a real teachable idea;
// the generator keeps it accurate (no invented numbers) and never job-seeking.
const LI_LEARN_TOPICS = [
  "Content-addressable storage: why uploaded objects get a content hash that guarantees they are never silently corrupted",
  "Load balancer vs reverse proxy vs API gateway — what each actually does and when you need it",
  "Why containers fix 'it works on my machine': reproducible environments explained simply",
  "What really happens when you type a URL and press Enter — DNS, TCP, TLS, HTTP step by step",
  "Why LLMs do not 'know' anything: token prediction under the hood and what it means for prompt design",
  "Horizontal vs vertical scaling — and why stateless services are what make the cloud elastic",
  "What a CDN is actually doing for you, and why caching is one of the highest-leverage performance tools",
  "How HTTPS protects you: the TLS handshake and why you should never disable certificate verification",
  "Idempotency: why it stops your APIs from double-charging or repeating side effects",
  "Monolith vs microservices — and why most teams should start with the boring option",
  "What MLOps adds beyond DevOps: data versioning, model drift, and reproducible training runs",
  "Why databases use indexes — and what happens to your query when one is missing",
  "How serverless really works: cold starts, event-driven billing, and the trade-offs the marketing page omits",
  "What a vector database is for: how embeddings turn text into coordinates a search can measure",
  "The CAP theorem in plain language: why distributed databases make you choose between consistency and availability",
  "How git stores history: hash objects and why rebasing rewrites the story",
];

const LI_PROJECT_TOPICS = [
  "How I built ForChi, a 24/7 Telegram agent that runs social posting, a YouTube pipeline, and job applications by itself",
  "Behind the build: CloudVoid — a non-custodial multi-chain crypto wallet with real on-chain send and swap",
  "How I automated a YouTube channel end-to-end: AI scripts, cloned voice, AI images, 2 videos a day",
  "What it took to build Odonata, a blind-validated sports prediction engine — and the six approaches I threw away first",
  "How ForChi applies to jobs by itself: discovering roles, tailoring resumes, and auto-applying to ATS portals",
  "The $0 infrastructure behind a production AI agent: Contabo VPS, Hugging Face Spaces, and the Gemini free tier",
  "Case study: encrypting service-to-service traffic with P-256 ECDH + AES-256-GCM in CloudVoid",
  "How I migrated all production services to a self-managed VPS with systemd, a health watchdog, and self-healing deploys",
  "Building with the YouTube Data API v3: uploads, captions, thumbnails, and playlist automation",
  "Keeping a consistent cloned voice across a daily video pipeline with Higgs Audio v3 TTS",
  "Project CLAY: why I built a 21-container multi-agent system, and why I retired it",
  "From Milo, my first chat bot, to CLAY and ForChi: the architecture lessons between three bots",
  "Protecting credentials in production: .gitignore, .env, and the secrets hygiene I follow on every project",
  "How agentic coding tools changed my Linux workflow — from doing everything manually to shipping faster",
  "What I'm building next: a crypto trading bot and an ecommerce store — and how AI + MCP servers fit in",
];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

// Persisted topic rotation: picks a random topic NOT used in the recent half of the
// pool for that platform (resets when exhausted). Kills the deterministic
// "same topic every post" repetition — fresh, never static, never repeats daily.
const fs = require("fs");
const path = require("path");
const TOPIC_STATE = path.join(__dirname, "..", "..", "temp_media", "social_topics.json");
function loadTopics() { try { return JSON.parse(fs.readFileSync(TOPIC_STATE, "utf8")); } catch { return {}; } }
function saveTopics(s) { try { fs.writeFileSync(TOPIC_STATE, JSON.stringify(s, null, 2)); } catch {} }
function pickFresh(arr, key) {
  const st = loadTopics();
  const used = st[key] || [];
  const availIdx = arr.map((_, i) => i).filter((i) => !used.includes(i));
  const pool = availIdx.length ? availIdx : arr.map((_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  st[key] = [...used.filter((u) => u !== idx), idx].slice(-Math.max(1, Math.ceil(arr.length / 2)));
  saveTopics(st);
  return arr[idx];
}

let running = false;
let registered = false;
let cronTask = null;
let lastRun = null; // { at, fb: "ok"|"err", li: "ok"|"err", fbError, liError }

// WORKFLOW-INDEPENDENCE (2026-09-05): the social workflow is cadence-critical
// (LinkedIn posts must go out at 08:00/16:00 UTC every day). It therefore does
// NOT take the global single-workflow lock at all — a long V10 build must never
// starve or delay a Facebook/LinkedIn post. Social work is light (text + image
// via remote APIs) and safe to run concurrently with a V10 build; the module's
// own `running` flag prevents overlapping social posts.
//
// Slot preservation: the intended slot (08:00 learning / 16:00 project) and its
// topic are captured WHEN THE CRON FIRES and threaded through any retry. Before
// this, a tick that was skipped (e.g. a previous run still in progress) recomputed
// linkedinSlot() from the wall-clock on retry — once the top of the hour passed it
// returned null and that day's LinkedIn post was silently dropped (seen on
// 2026-09-04/05). Now a delayed tick still posts the LinkedIn content it was
// scheduled for.
const RETRY_WINDOW_MS = 3 * 60 * 60 * 1000; // retry for up to 3h after the slot (covers any transient busy state)
const RETRY_DELAY_MS = 5 * 60 * 1000;       // every 5 min
let retryTimer = null;
let retryDeadline = 0;

function scheduleRetry(fn) {
  if (retryTimer) return; // already retrying
  if (!retryDeadline) retryDeadline = Date.now() + RETRY_WINDOW_MS;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    try {
      const res = await fn();
      // Keep retrying until the window expires, then give up (the slot is lost).
      if (res && res.skipped) {
        if (Date.now() < retryDeadline) {
          console.warn("[Auto] still busy — retrying the same slot in a few minutes");
          retryTimer = null;
          scheduleRetry(fn);
        } else {
          console.warn("[Auto] gave up retrying this post (retry window expired)");
          retryDeadline = 0;
        }
      } else {
        retryDeadline = 0; // posted successfully — reset for next slot
      }
    } catch (e) {
      console.error("[Auto] retry failed:", e.message);
      retryDeadline = 0;
    }
  }, RETRY_DELAY_MS);
  if (retryTimer.unref) retryTimer.unref();
}

// Read-only snapshot used by /diag and the self-healing repair flow.
function getSchedulerState() {
  return { registered, running, autoMode: autoMode.isEnabled(), lastRun, schedule: AUTO_SCHEDULE };
}

// Clear a stuck "running" flag (e.g. after a crash mid-run) so the next tick fires.
function resetRunning() {
  if (running) {
    console.warn("[Scheduler] resetRunning: cleared a stuck in-progress flag.");
    running = false;
  }
}

// Build the slot context for NOW (used by the cron callback at schedule time).
function makeSlot() {
  const slot = { fbTheme: pickFresh(FB_THEMES, "fb"), liSlot: linkedinSlot() };
  if (slot.liSlot) {
    slot.liTopic = pickFresh(
      slot.liSlot === "learn" ? LI_LEARN_TOPICS : LI_PROJECT_TOPICS,
      slot.liSlot === "learn" ? "li_learn" : "li_project"
    );
  }
  return slot;
}

// The actual social-posting work (one slot). `slot` carries the themes chosen at
// schedule time so retries keep the SAME LinkedIn content. Returns { posted, skipped }.
async function runSocialTick(slot = {}) {
  if (!autoMode.isEnabled()) {
    console.log(`[Auto] Auto mode is OFF — skipping scheduled post at ${new Date().toISOString()}`);
    return { posted: false, skipped: false };
  }
  if (running) {
    console.log("[Auto] Previous run still in progress — skipping this tick.");
    return { posted: false, skipped: true };
  }
  running = true;
  try {
    // Rotate themes by current day + hour so each run differs and changes daily
    // across the (now much larger) pools — never the same sequence two days in a row.
    // Fresh topic per platform (persisted, no day-to-day repeats).
    // LinkedIn posts at BOTH slots: 08:00 = "Did you know...?" learning, 16:00 = project showcase.
    const fbTheme = slot.fbTheme || pickFresh(FB_THEMES, "fb");
    const liSlot = slot.liSlot != null ? slot.liSlot : linkedinSlot();
    const liTopic = slot.liTopic || (liSlot
      ? pickFresh(liSlot === "learn" ? LI_LEARN_TOPICS : LI_PROJECT_TOPICS, liSlot === "learn" ? "li_learn" : "li_project")
      : null);

    console.log(`[Auto] ${new Date().toISOString()} — generating posts (FB: "${fbTheme}" | LI: ${liSlot ? `"${liTopic}" (${liSlot === "learn" ? "did-you-know learning" : "project showcase"})` : "SKIPPED"})`);

    // 1. Generate content in the two styles in parallel (LinkedIn only at its 2 slots).
    const [fb, li] = await Promise.allSettled([
      generateFacebookPost(fbTheme),
      liSlot ? generateLinkedInPost(liTopic, liSlot) : Promise.resolve({ postText: "", visualTopic: "" }),
    ]);

    // 2. Post each to its own platform (each generates its own styled image).
    const fbContent = fb.status === "fulfilled" ? fb.value : { postText: fbTheme, visualTopic: fbTheme };
    const liContent = liSlot && li.status === "fulfilled" ? li.value : { postText: "", visualTopic: "" };

    const jobs = [
      socialWorkflow.run({ destinations: ["facebook"], content: fbContent.postText, visualTopic: fbContent.visualTopic }),
    ];
    if (liSlot && liContent.postText) {
      jobs.push(socialWorkflow.run({ destinations: ["linkedin"], content: liContent.postText, visualTopic: liContent.visualTopic }));
    }
    const results = await Promise.allSettled(jobs);

    const perPlatform = { facebook: "err", linkedin: liSlot ? "err" : "skip", fbError: null, liError: null };
    results.forEach((r, i) => {
      const platform = i === 0 ? "facebook" : "linkedin";
      if (r.status === "fulfilled" && r.value.success) {
        perPlatform[platform] = "ok";
        console.log(`[Auto] ✅ ${platform} post succeeded`);
      } else {
        const err = r.status === "fulfilled" ? r.value.errorSummary : r.reason?.message;
        perPlatform[`${platform === "facebook" ? "fb" : "li"}Error`] = err || "unknown";
        console.error(`[Auto] ❌ ${platform} post failed: ${err || "unknown"}`);
      }
    });
    lastRun = { at: new Date().toISOString(), fb: perPlatform.facebook, li: perPlatform.linkedin };
    return { posted: true, skipped: false };
  } catch (err) {
    console.error("[Auto] Error during auto-post:", err.message);
    lastRun = { at: new Date().toISOString(), fb: "err", li: "err", fbError: err.message, liError: err.message };
    return { posted: false, skipped: false };
  } finally {
    running = false;
  }
}

function initScheduler() {
  if (registered) {
    console.log("[Scheduler] Auto mode already registered — skipping duplicate.");
    return;
  }
console.log(`[Scheduler] Initializing AUTO mode (FB 2/day 8:00+16:00 UTC · LI 2/day: 8:00 did-you-know learning + 16:00 project showcase)... (currently ${autoMode.isEnabled() ? "ON ✅" : "OFF ⛔"})`);

  cronTask = cron.schedule(
    AUTO_SCHEDULE,
    async () => {
      // Capture the intended slot at schedule time — a delayed/retried tick keeps
      // this same LinkedIn job/project content instead of dropping it.
      const slot = makeSlot();
      const res = await runSocialTick(slot);
      if (res && res.skipped) {
        console.warn("[Auto] tick skipped — will retry the same slot in a few minutes");
        scheduleRetry(() => runSocialTick(slot));
      }
    },
    { scheduled: true, timezone: "UTC" }
  );

  registered = true;
  console.log(`[Scheduler] Auto mode registered (${AUTO_SCHEDULE} UTC).`);
}

// Tear down and re-register the scheduler (used by /fix and boot-time self-heal).
function reRegister() {
  if (cronTask) {
    try { cronTask.destroy(); } catch (_) { /* node-cron may already be destroyed */ }
    cronTask = null;
  }
  registered = false;
  running = false;
  initScheduler();
}

module.exports = { initScheduler, reRegister, getSchedulerState, resetRunning };
