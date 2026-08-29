const cron = require("node-cron");
const socialWorkflow = require("../workflows/social/index");
const { generateFacebookPost, generateLinkedInPost } = require("../llm/contentGen");
const autoMode = require("./autoMode");

// Auto mode: 2 posts/day (08:00, 16:00 UTC) — reduced from 5/day per user directive.
const AUTO_SCHEDULE = "0 8,16 * * *";

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

const LI_TOPICS = [
  // AI / LLM
  "the difference between AI models and true LLM reasoning",
  "how large language models actually work under the hood",
  // AI integrations
  "integrating LLMs into production systems without breaking anything",
  "practical AI integrations that save engineering teams real time",
  // Best practices
  "AI engineering best practices for production systems",
  "prompt engineering vs system design: what actually moves the needle",
  "LLM evaluation: how to know if your model is actually good",
  // Cloud engineering
  "cloud architecture patterns built specifically for AI workloads",
  "serverless AI: when it makes sense and when it doesn't",
  "cloud cost optimization for AI and LLM workloads",
  // AI news
  "the latest AI news and what it means for engineers this week",
  "a major AI release right now and its real-world impact",
  // Nature + AI
  "what AI can learn from nature: evolution, swarm intelligence, and neural inspiration",
  "how biology inspired modern neural networks and what's next",
  "nature as the original neural network: lessons for AI design",
  // Dangers of AI in the wrong hands
  "the real dangers of AI in the wrong hands and how to guard against them",
  "AI safety, alignment, and why responsible engineering matters now",
  // Networking
  "how networking and distributed systems power modern AI",
  "network architecture for training and serving large models at scale",
  // Training models
  "how large language models are trained: the full pipeline explained",
  "fine-tuning vs RAG: which one do you actually need",
  "data pipelines for AI: garbage in, garbage out",
  // Building with AI agents (series)
  "AI agents series: building your first AI agent — a beginner's roadmap",
  "AI agents series: orchestrating multi-agent workflows that actually work",
  "AI agents series: giving agents tools, memory, and boundaries",
  "AI agents series: when agents fail and how to recover gracefully",
  "AI agents series: turning a one-off agent into a reusable product",
  // Cloud + AI engineering
  "MLOps: taking a model from notebook to production",
  "scaling AI systems: latency, throughput, and reliability",
  "vector databases and embeddings, explained simply",
  "RAG architectures: retrieval strategies that actually improve answers",
  "AI ethics in engineering: building with responsibility",
  "career advice for AI and cloud engineers in 2026",
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

function initScheduler() {
  if (registered) {
    console.log("[Scheduler] Auto mode already registered — skipping duplicate.");
    return;
  }
  console.log(`[Scheduler] Initializing AUTO mode (5 posts/day, 4h apart, UTC)... (currently ${autoMode.isEnabled() ? "ON ✅" : "OFF ⛔"})`);

  cronTask = cron.schedule(
    AUTO_SCHEDULE,
    async () => {
      if (!autoMode.isEnabled()) {
        console.log(`[Auto] Auto mode is OFF — skipping scheduled post at ${new Date().toISOString()}`);
        return;
      }
      if (running) {
        console.log("[Auto] Previous run still in progress — skipping this tick.");
        return;
      }
      running = true;
      try {
        // Rotate themes by current day + hour so each run differs and changes daily
        // across the (now much larger) pools — never the same sequence two days in a row.
        // Fresh topic per platform (persisted, no day-to-day repeats).
        const fbTheme = pickFresh(FB_THEMES, "fb");
        const liTopic = pickFresh(LI_TOPICS, "li");

        console.log(`[Auto] ${new Date().toISOString()} — generating posts (FB: "${fbTheme}" | LI: "${liTopic}")`);

        // 1. Generate content in the two styles in parallel.
        const [fb, li] = await Promise.allSettled([
          generateFacebookPost(fbTheme),
          generateLinkedInPost(liTopic),
        ]);

        // 2. Post each to its own platform (each generates its own styled image).
        const fbContent = fb.status === "fulfilled" ? fb.value : { postText: fbTheme, visualTopic: fbTheme };
        const liContent = li.status === "fulfilled" ? li.value : { postText: liTopic, visualTopic: liTopic };

        const results = await Promise.allSettled([
          socialWorkflow.run({ destinations: ["facebook"], content: fbContent.postText, visualTopic: fbContent.visualTopic }),
          socialWorkflow.run({ destinations: ["linkedin"], content: liContent.postText, visualTopic: liContent.visualTopic }),
        ]);

        const perPlatform = { facebook: "err", linkedin: "err", fbError: null, liError: null };
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
      } catch (err) {
        console.error("[Auto] Error during auto-post:", err.message);
        lastRun = { at: new Date().toISOString(), fb: "err", li: "err", fbError: err.message, liError: err.message };
      } finally {
        running = false;
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
