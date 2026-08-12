const cron = require("node-cron");
const socialWorkflow = require("../workflows/social/index");
const { generateFacebookPost, generateLinkedInPost } = require("../llm/contentGen");

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
  "the latest AI news and what it means for how we work",
  "a practical AI hack most people can use today",
  "how AI is reshaping tech companies and jobs",
  "a bold prediction about AI in the next year",
  "underrated AI tools most people ignore",
  "what founders get wrong about adopting AI",
];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

let running = false;

function initScheduler() {
  console.log("[Scheduler] Initializing AUTO mode (5 posts/day, 4h apart, UTC)...");

  cron.schedule(
    AUTO_SCHEDULE,
    async () => {
      if (running) {
        console.log("[Auto] Previous run still in progress — skipping this tick.");
        return;
      }
      running = true;
      try {
        // Rotate themes by the current hour so each of the 5 daily runs is different.
        const hour = new Date().getUTCHours();
        const fbTheme = pick(FB_THEMES, Math.floor(hour / 4));
        const liTopic = pick(LI_TOPICS, Math.floor(hour / 4) + 1);

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
