const cron = require("node-cron");
const socialWorkflow = require("../workflows/social/index");
const { generateFacebookPost, generateLinkedInPost } = require("../llm/contentGen");
const autoMode = require("./autoMode");
const wlock = require("./workflowLock.js");

// Auto mode: FACEBOOK 2 posts/day (08:00, 16:00 UTC).
const AUTO_SCHEDULE = "0 8,16 * * *";
// LINKEDIN — USER DIRECTIVE (2026-09-02): 2 posts per DAY (08:00 + 16:00 UTC).
// Slot 08:00 = job-seeking post addressed to hiring managers + people who know
// hiring managers (what Victor does / wants / the company / who to connect him to
// / how to help). Slot 16:00 = build-in-public project showcase (real builds +
// failures). See LI_JOB_TOPICS + LI_PROJECT_TOPICS and the LinkedIn generators.
function linkedinSlot(now = new Date()) {
  const h = now.getUTCHours();
  if (h === 8) return "job";
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

// LinkedIn topics — USER DIRECTIVE (2026-09-02): LinkedIn now runs 2/day (08:00 +
// 16:00 UTC). The 08:00 slot is a JOB-SEEKING post addressed to hiring managers +
// people who know them; the 16:00 slot is a PROJECT-SHOWCASE post (real builds +
// failures, never AI news). Each topic names a real angle; the LinkedIn generator
// expands it from the real facts in its prompt (no invented metrics/numbers).
const LI_JOB_TOPICS = [
  "I build production AI and cloud systems — and I'm looking for a remote junior role where I can keep learning",
  "Hiring managers and people who know them: here's what I do, what I want, and the company I'm looking for",
  "Open to work: remote cloud security, DevOps, and AI integration roles — here's how you can help me get there",
  "From a 24/7 agent and a crypto wallet to job hunting: my honest ask to recruiters and hiring managers",
  "What I want in my next team — and the type of company I'm aiming for",
  "A short intro to who I am, what I build, and who you should connect me to",
  "Why I want to join a team with stronger engineers than me — and how to reach me",
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

// USER DIRECTIVE (2026-09-03): a LinkedIn/Facebook post that is SKIPPED because
// the global workflow lock is held (e.g. a long V10 build) must NOT be lost for
// the day. We retry shortly after until the lock frees (up to RETRY_WINDOW_MS),
// then post. Without this, a V10 build overlapping the 08:00/16:00 UTC slot
// silently dropped that day's LinkedIn posts.
const RETRY_WINDOW_MS = 3 * 60 * 60 * 1000; // retry for up to 3h after the slot (covers long V10 builds)
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
          console.warn("[Auto] lock still held — retrying again in a few minutes");
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

// The actual social-posting work (one slot). Returns { posted, skipped }.
async function runSocialTick() {
  if (!autoMode.isEnabled()) {
    console.log(`[Auto] Auto mode is OFF — skipping scheduled post at ${new Date().toISOString()}`);
    return { posted: false, skipped: false };
  }
  if (running) {
    console.log("[Auto] Previous run still in progress — skipping this tick.");
    return { posted: false, skipped: false };
  }
  // Global single-workflow lock: don't post while a V10 build/publish runs.
  if (!wlock.tryAcquire("social", { ttlMs: 20 * 60 * 1000 })) {
    const o = wlock.owner();
    console.warn(`[Auto] SKIPPED social post — ${o ? o.name + " (pid " + o.owner + ")" : "another workflow"} holds the lock`);
    return { posted: false, skipped: true };
  }
  running = true;
  try {
    // Rotate themes by current day + hour so each run differs and changes daily
    // across the (now much larger) pools — never the same sequence two days in a row.
    // Fresh topic per platform (persisted, no day-to-day repeats).
    // LinkedIn posts at BOTH slots: 08:00 = job-seeking, 16:00 = project showcase.
    const fbTheme = pickFresh(FB_THEMES, "fb");
    const liSlot = linkedinSlot();
    const liTopic = liSlot
      ? pickFresh(liSlot === "job" ? LI_JOB_TOPICS : LI_PROJECT_TOPICS, liSlot === "job" ? "li_job" : "li_project")
      : null;

    console.log(`[Auto] ${new Date().toISOString()} — generating posts (FB: "${fbTheme}" | LI: ${liSlot ? `"${liTopic}" (${liSlot === "job" ? "job-seeking" : "project showcase"})` : "SKIPPED"})`);

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
    wlock.release("social");
  }
}

function initScheduler() {
  if (registered) {
    console.log("[Scheduler] Auto mode already registered — skipping duplicate.");
    return;
  }
console.log(`[Scheduler] Initializing AUTO mode (FB 2/day 8:00+16:00 UTC · LI 2/day: 8:00 job-seeking + 16:00 project showcase)... (currently ${autoMode.isEnabled() ? "ON ✅" : "OFF ⛔"})`);

  cronTask = cron.schedule(
    AUTO_SCHEDULE,
    async () => {
      const res = await runSocialTick();
      // If the lock was held (V10 build running), retry shortly after so the
      // day's LinkedIn/Facebook post is NOT lost.
      if (res && res.skipped) {
        console.warn("[Auto] post skipped due to lock — will retry in a few minutes");
        scheduleRetry(runSocialTick);
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
