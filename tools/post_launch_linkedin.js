// One-off: publish the 3 ForChi launch posts to LinkedIn (text-only).
// Usage: node tools/post_launch_linkedin.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { postToLinkedIn } = require("../src/workflows/social/linkedin");

const posts = [
  // ── Post 1: The Engineer's Build Log ─────────────────────────────────────
  `I just shipped something I never thought I'd run on $0/month: a **24/7 AI social media automation bot**.

For the last two weeks I've been building **ForChi** — a Telegram bot that writes and publishes original content to Facebook and LinkedIn, five times a day, around the clock. Not recycled RSS. Original writing, generated fresh every single post.

The stack is the part I'm proudest of:
- **Node.js + Telegraf** for the Telegram long-polling layer
- **Gemini 3.x** for the writing (with a self-hosted Qwen fallback)
- **Hugging Face ZeroGPU + FLUX** for AI-generated images per post
- **Render** (free tier) for hosting, with live web-search grounding via Serper/Exa/Firecrawl so LinkedIn posts reference *real* trending AI news — funding rounds, unicorns, cloud-security moves
- Sharp for image normalization, and a publishing pipeline that never loses a hashtag

The hardest part wasn't the code. It was the invisible infrastructure: HF ZeroGPU quota limits, a Render deploy that silently lost every env var, WebP images Facebook kept rejecting. Each one was a debugging session that ended with a fix I'll reuse forever.

Automation isn't about replacing creators. It's about giving one person the output of a small team.

What would you automate first if you had a free 24/7 operator?

#AI #Automation #NodeJS #OpenSource #CloudEngineering #Productivity`,

  // ── Post 2: Built Together With ForChi ────────────────────────────────────
  `Here's an honest confession: **I didn't build ForChi alone. I built it *together with* ForChi.**

ForChi started as an idea in a chat window — "I want a bot that posts like me, in my voice, every day." Two weeks later it's a production Telegram bot publishing original poetry and in-depth AI analysis to real social pages, on a $0 budget.

What surprised me most about working with an AI coding partner:

1. **Speed.** A feature that used to take an evening — grounding posts in live web search — went from idea to shipped in minutes.
2. **It catches what I miss.** The bot found a bug where hashtags were being silently stripped right before publishing. I'd have shipped that for weeks.
3. **I still make the calls.** The AI drafts, I decide. It wrote the first version of the Facebook voice; I taught it my actual writing style by feeding it my real posts until it *sounded like me*.

The tools don't replace the builder. They make the builder dangerously fast.

The future isn't humans OR AI. It's humans learning how to direct it. That's the skill worth building right now.

If you've built something recently with an AI assistant, what surprised you most?

#AI #Copilot #SoftwareEngineering #HumanCenteredAI #BuildInPublic`,

  // ── Post 3: What Shipping Actually Taught Me ──────────────────────────────
  `Everyone posts about the wins. Nobody posts about the 2 AM deploy that caught fire.

Yesterday ForChi crashed. Not because of bad code — because the hosting service quietly lost every environment variable. The bot started, saw zero credentials, and shut down. For an hour, my "24/7 automation" was a 0/7.

Here's what I learned from the fix:

- **The build isn't the product. The running system is.** Your code can be perfect and your bot can still be offline.
- **Automate the boring recovery.** I wrote a script that reads my local config and re-provisions every env var on the host via its API — one command, done. I'll never paste credentials by hand again.
- **Free tier is a gym membership.** HF ZeroGPU quota, Render cold starts, rate limits — every constraint taught me to build leaner.
- **Real users change everything.** When the only feedback is a bot posting to a real page, you start caring about voice, consistency, and whether the hashtags actually land.

Two weeks ago this was a folder on my laptop. Today it's a publishing engine that never sleeps — and it taught me more about resilience than any tutorial ever did.

What's the hardest production lesson you've learned the slow way?

#BuildInPublic #DevOps #Resilience #AI #StartupLife #TechLife`,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Publishing ${posts.length} LinkedIn posts...`);
  for (let i = 0; i < posts.length; i++) {
    try {
      // LinkedIn doesn't render markdown — strip the ** markers used for readability here.
      const content = posts[i].replace(/\*/g, "");
      const res = await postToLinkedIn({ content });
      console.log(`[${i + 1}/${posts.length}] ✅ ${res.platform} post ID: ${res.postId}`);
    } catch (e) {
      console.error(`[${i + 1}/${posts.length}] ❌ ${e.message}`);
    }
    if (i < posts.length - 1) await sleep(5000);
  }
  console.log("Done.");
  process.exit(0);
})();
