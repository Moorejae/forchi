const cron = require("node-cron");
const db = require("../store/db");
const socialWorkflow = require("../workflows/social/index");
const { generateContentAndVisualTopic } = require("../llm/contentGen");

function initScheduler() {
  console.log("[Scheduler] Initializing campaign cron job...");

  // Schedule daily tick (Default: 9:00 AM UTC - Section 5)
  cron.schedule(
    "0 9 * * *",
    async () => {
      console.log("[Scheduler Tick] Checking due campaigns...");
      try {
        const dueCampaigns = await db.getDueCampaigns();
        console.log(`[Scheduler Tick] Found ${dueCampaigns.length} active campaigns due for posting.`);

        for (const campaign of dueCampaigns) {
          console.log(`[Scheduler Job] Executing post for Campaign #${campaign.id} (Theme: "${campaign.theme}")`);

          // 1. Generate text + visual imagery keywords
          const content = await generateContentAndVisualTopic(campaign.theme);

          // 2. Run social posting workflow
          const result = await socialWorkflow.run({
            destinations: campaign.destinations,
            content: content.postText,
            visualTopic: content.visualTopic
          });

          console.log(`[Scheduler Job] Campaign #${campaign.id} post completed. Success: ${result.success}`);

          // 3. Increment days_completed and advance next_run
          await db.advanceCampaign(campaign.id);
        }
      } catch (err) {
        console.error("[Scheduler Tick] Error during campaign execution:", err.message);
      }
    },
    {
      scheduled: true,
      timezone: "UTC" // Section 5: Set cron timezone explicitly
    }
  );

  console.log("[Scheduler] Cron job registered successfully (0 9 * * * UTC).");
}

module.exports = { initScheduler };
