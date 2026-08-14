const cron = require("node-cron");
const socialWorkflow = require("../workflows/social/index");
const { generateFacebookPost, generateLinkedInPost } = require("../llm/contentGen");
const autoMode = require("./autoMode");

// Auto mode: 5 posts/day, 4 hours apart (08:00, 12:00, 16:00, 20:00, 00:00 UTC)
const AUTO_SCHEDULE = "0 0,8,12,16,20 * * *";

// Rotating themes so posts stay fresh day to day.
const FB_THEMES = [
  "life, love, self-worth, and human nature",
  "marriage, sacrifice, and the value of independence",
  "hate, healing, and the power of dialogue",
  "patience, hard work, and protecting what you built",
  "gratitude, faith, and trusting God through hard times",
  "the quiet strength of people who keep going unseen",
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

let running = false;

function initScheduler() {
  console.log(`[Scheduler] Initializing AUTO mode (5 posts/day, 4h apart, UTC)... (currently ${autoMode.isEnabled() ? "ON ✅" : "OFF ⛔"})`);

  cron.schedule(
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
        const hour = new Date().getUTCHours();
        const daySeed = Math.floor(Date.now() / 86400000);
        const fbTheme = pick(FB_THEMES, daySeed * 13 + Math.floor(hour / 4));
        const liTopic = pick(LI_TOPICS, daySeed * 29 + Math.floor(hour / 4) + 1);

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

        results.forEach((r, i) => {
          const platform = i === 0 ? "facebook" : "linkedin";
          if (r.status === "fulfilled" && r.value.success) {
            console.log(`[Auto] ✅ ${platform} post succeeded`);
          } else {
            const err = r.status === "fulfilled" ? r.value.errorSummary : r.reason?.message;
            console.error(`[Auto] ❌ ${platform} post failed: ${err || "unknown"}`);
          }
        });
      } catch (err) {
        console.error("[Auto] Error during auto-post:", err.message);
      } finally {
        running = false;
      }
    },
    { scheduled: true, timezone: "UTC" }
  );

  console.log(`[Scheduler] Auto mode registered (${AUTO_SCHEDULE} UTC).`);
}

module.exports = { initScheduler };
