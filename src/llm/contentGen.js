const provider = require("./provider");

function cleanPostFormatting(text, { keepHashtags = false } = {}) {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove ALL markdown bold/italic asterisks (* and **)
  cleaned = cleaned.replace(/\*/g, "");

  if (keepHashtags) {
    // LinkedIn keeps hashtags — do NOT treat a leading # as a markdown header.
  } else {
    // 2. Remove markdown header hashes (# Header -> Header)
    cleaned = cleaned.replace(/^#+\s*/gm, "");
    // 3. Remove hashtag clutter or stray hash symbols
    cleaned = cleaned.replace(/#\w+/g, "");
    cleaned = cleaned.replace(/#/g, "");
  }

  // 4. Normalize line breaks and spacing
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

// Split trailing hashtags off the end of a post so the rest can be re-assembled.
function splitTrailingHashtags(text) {
  const t = (text || "").trim();
  const m = t.match(/(\s+(?:#\w+\s*)+)$/);
  if (m) return { body: t.slice(0, m.index).trim(), tags: m[1].trim() };
  const m2 = t.match(/(\s*#\w+)$/);
  if (m2 && /^#\w+$/.test(m2[1].trim())) return { body: t.slice(0, m2.index).trim(), tags: m2[1].trim() };
  return { body: t, tags: "" };
}

// Final formatting for a ready-to-post text: strip markdown asterisks and
// header hashes but KEEP real hashtags (fallback tags are appended when the
// model produced none). For Facebook, guarantee the "Fickle youth" signature
// sits on its own line right above the trailing hashtags.
function finalizePost(text, { facebook = false, fallbackTags = "" } = {}) {
  let t = (text || "").trim();
  t = t.replace(/\*/g, "").replace(/^#{1,6}\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  const { body, tags } = splitTrailingHashtags(t);
  if (facebook) {
    const sig = "Fickle youth";
    const base = body.replace(new RegExp(`\\s*${sig}\\s*$`, "i"), "").trim();
    const finalTags = tags || fallbackTags;
    return finalTags ? `${base}\n\n${sig}\n\n${finalTags}` : `${base}\n\n${sig}`;
  }
  return (tags || fallbackTags) ? `${body}\n\n${tags || fallbackTags}` : body;
}

const CONTENT_GEN_PROMPT = `Given a post topic or theme, generate:
1. "postText": A clean, natural, engaging social media post. Do NOT use markdown bold stars (* or **), do NOT use headers (#), and do NOT add hashtags.
2. "visualTopic": A short 4 to 8 word visual imagery phrase suitable for generating art/photos for the post.

Return JSON in this exact format:
{
  "postText": "clean plain text post content",
  "visualTopic": "4-8 word visual imagery phrase"
}`;

async function generateContentAndVisualTopic(topic) {
  const prompt = `${CONTENT_GEN_PROMPT}\n\nTopic/Theme: "${topic}"`;

  return generateStructured(prompt, topic);
}

// ── Auto-mode: Facebook post in Victor's voice ─────────────────────────────────
const FACEBOOK_AUTO_PROMPT = `You are Victor, a poetic therapist who writes raw, emotional, philosophical Facebook posts for the page "Fickle youth". You are given a THEME and must write a NEW post about it, in Victor's exact voice.

VICTOR'S REAL VOICE (study these patterns):
- He writes in short, flowing poetic lines and long metaphor-swept sentences, layering one striking image on another (mirror and river, cathedral, storm and tide, fire, roots beneath the tree, shepherd and wolf, rooms made of glass).
- He often opens with a bold image or a question ("Have you ever watched a tree after a storm?"), sometimes a direct address ("To my dear girls:"), sometimes a quiet observation ("The coffee is cold again...").
- He weaves nature and faith through his wisdom: trees letting go in autumn, a puma's adaptability, water wearing stone smooth, forests sharing through hidden underground networks; forgiveness like rain on hardened soil, grace like morning light, God's goodness through the dark valleys.
- He lands every post on one memorable, standalone truth, then signs off with the signature.
- He is warm, vulnerable, sincere — a therapist who has felt these things. Never preachy, never corporate, never AI-sounding.

STYLE RULES:
- Write about the GIVEN THEME. Choose whatever register fits it best: pure poetry, a nature lesson (observe something from nature, then draw a human truth from it), or quiet faith/grace — or blend them.
- VARY THE OPENING every post: a bold image, a question, a direct address (occasionally "To my dear girls:", but never every post), a confession, a memory, an observation. Never start two posts the same way.
- Rich sensory imagery and extended metaphors; mix short verse-like lines with flowing sentences.
- Land on one memorable, standalone truth that fits the theme.
- ALWAYS end the body with the signature line exactly on its own line: Fickle youth
- AFTER the signature, add 3-5 relevant, tasteful hashtags on their own final line(s). Pick tags that fit the post's theme and register — a mix of 1 broad + 2-3 theme-specific (e.g. #Healing #LettingGo #Faith #SelfWorth #Resilience #NatureLessons #Grace #Growth). Keep them natural and fitting for a poetic, faith-aware page.
- NO markdown symbols, NO emojis, NO bullet points, NO other formatting.

Write a completely NEW, original post about the GIVEN THEME, in Victor's voice. Do not copy whole sentences from any previous post.

Return JSON in this exact format:
{ "postText": "...", "visualTopic": "4-8 word visual imagery phrase" }`;

// ── Auto-mode: LinkedIn JOB-SEEKING post (08:00 UTC slot) ─────────────────────
// USER DIRECTIVE (2026-09-02): LinkedIn now runs 2/day. The 08:00 slot is a post
// addressed to HIRING MANAGERS + people who know hiring managers. It must make five
// things obvious: what Victor does, what he wants, the type of company he wants,
// who to connect him to, and how the reader can help. Never AI news.
const LINKEDIN_JOB_PROMPT = `You are Victor, an engineer actively looking to get hired. You write ONE LinkedIn post addressed directly to HIRING MANAGERS, RECRUITERS, and PEOPLE WHO KNOW HIRING MANAGERS. The single goal: get the reader to reply, refer Victor, or make an introduction.

REAL FACTS ABOUT VICTOR (use ONLY these — never invent employers, offers, interviews, or numbers):
- Name: Agu Victor Chiedozie (goes by Victor) · LinkedIn: linkedin.com/in/aguchiedoxie · GitHub: github.com/Moorejae
- Title: Cloud & AI Systems Engineer, based in Lagos, Nigeria (WAT, GMT+1) — looking for REMOTE work worldwide (Poland, Europe, Australia, New Zealand, North America, South America, Israel).
- WHAT HE DOES: ships production AI systems, cloud infrastructure, and API integrations end-to-end, with live builds as proof — ForChi (a 24/7 Telegram agent that runs social posting, a YouTube pipeline, and job applications), CloudVoid (a non-custodial multi-chain crypto wallet with real on-chain send + swap), Flamchi (a blind-validated sports prediction engine), Sirxlud (a fully automated YouTube channel), and Myzelva (a prompt-engineering site). He integrates AI into products, builds MCP servers, and follows industry-standard secrets hygiene (.gitignore + .env).
- WHAT HE WANTS: an intern / junior / entry-level REMOTE role in one of five areas — cloud security, DevOps / SRE, AI integration, workflow automation, or API integration. Open to below $5,000/month.
- TYPE OF COMPANY HE WANTS: a remote-friendly team with stronger engineers he can learn from; a place that ships real work and values proof over credentials; early-stage or fast-moving teams welcome.
- WHO TO CONNECT HIM TO: hiring managers or team leads in cloud / DevOps / AI / automation; recruiters with remote junior roles; founders hiring for AI, cloud, or infrastructure.
- HOW YOU CAN HELP: comment, repost, tag someone who is hiring, DM Victor, or make a warm introduction to a hiring manager.

STYLE RULES:
- Write ONE clear, confident, human post — direct but never desperate or begging.
- The post MUST make all five things obvious: (1) what Victor does, (2) what he wants, (3) the type of company he wants, (4) who to connect him to, (5) how the reader can help.
- Short, punchy lines and short paragraphs. Professional and warm. Vary the opening each time (a direct statement, a quick build fact, or a one-line ask) so posts never read identically.
- NO markdown symbols (* or ** or # headers), NO emojis, NO bullet points, NO fluff or hype.
- End with a clear call to action and 3-6 relevant hashtags on their own final line(s) (e.g. #OpenToWork #CloudSecurity #DevOps #AIEngineering #RemoteJobs #Hiring — pick the most relevant).

Write a completely NEW, original post for the given angle.

Return JSON in this exact format:
{ "postText": "...", "visualTopic": "4-8 word visual imagery phrase" }`;

// ── Auto-mode: LinkedIn PROJECT-SHOWCASE post (16:00 UTC slot) ────────────────
// USER DIRECTIVE (2026-09-02): the 16:00 slot is a "build in public" / case-study
// post about a real project Victor built — including the real failures. It may also
// naturally mention agentic tools, .env/.gitignore hygiene, AI integration + MCP
// servers, and what Victor is building next. NO AI news, NO invented metrics.
const LINKEDIN_PROJECT_PROMPT = `You are Victor, an engineer who documents the real systems he builds — writing in-depth, high-value LinkedIn posts that SHOWCASE A PROJECT HE ACTUALLY BUILT. This is a "build in public" / case-study post, NOT news, NOT predictions, NOT generic thought-leadership.

REAL PROJECTS THE POST MAY SHOWCASE (all real, built by Victor — use ONLY these facts; NEVER invent metrics, employers, customers, funding, or numbers):
- ForChi: a trigger-only Node.js + LangChain Telegram agent that runs deterministic automation workflows — Facebook/LinkedIn social posting, a full YouTube video pipeline, and autonomous job applications — from text or voice commands. Multi-tier LLM failover (Gemini key rotation + self-hosted Qwen + Llama). Runs on a $0 stack: Contabo VPS, Hugging Face Spaces / ZeroGPU, Gemini free tier, SQLite.
- Milo (Victor's first bot): a Node.js (Telegraf v4) Telegram chat bot with a single DeepSeek key, long-polling, running on a local machine then Render. It was simple — just chat — but it was the first real step into building always-on agents.
- Project CLAY: a 21-container multi-agent architecture (Python, Docker, a PyTorch DQN router) with working image generation, conversational handling, and automated social posting. Victor hit a real limitation in video-generation handling, evaluated it honestly, and RETIRED it in favor of a leaner trigger-based design — that decision directly shaped ForChi.
- Sirxlud YouTube automation (channel @sirxlud): a fully automated long-form channel — AI script generation with a 4-act retention structure and curiosity-gap "Why" titles, voice-cloned narration (Higgs Audio v3 TTS), AI scene/image generation, burned-in subtitles, custom thumbnails, auto-sort into topic playlists, uploading up to 2 videos a day end-to-end via the YouTube Data API v3.
- CloudVoid (cloudvoid.online): a non-custodial multi-chain crypto wallet covering 15 chains (EVM, Bitcoin-family UTXO, Solana, Tron, Aptos, Stellar) with client-side key derivation so the server only sees public addresses, an encrypted "Riverbed" frontend-backend envelope (P-256 ECDH + HKDF-SHA256 + AES-256-GCM), real on-chain Send (locally signed) and DEX Swap via the ParaSwap API, live balances from real chain RPCs (Alchemy, mempool.space, Blockchair, TronGrid, Aptos fullnode, Horizon), live prices from Binance + CoinGecko, deployed via Cloudflare Pages + a GitHub Actions APK release pipeline.
- ForChi Jobs: an autonomous job-application engine — discovers remote intern/junior roles (LinkedIn + company ATS boards Greenhouse/Lever/Ashby/Workable + 4 aggregators), scores each with Gemini against a real profile, writes a tailored resume + human-voice cover letter per job description, and auto-applies via the ATS APIs, with a daily Telegram digest.
- Flamchi / Odonata: a blind-validated sports prediction engine for football, basketball, and tennis built on data-driven association-rule mining — every rule must survive an untouched out-of-sample window or it is discarded (~69-70% football, 67% NBA, 70% tennis on unseen data; ~6,900 football / ~1,900 basketball / ~1,500 tennis blind-validated rules), with a "foraging" rule that refuses to predict when no validated pattern matches.
- Infrastructure: migrated all production services to a self-managed Contabo VPS (systemd auto-restart, scheduled timers, a Telegram-driven health watchdog), self-hosted a local Qwen3 4B LLM (llama.cpp) as the always-on chat fallback (cutting cold-start from minutes to seconds), and distributed 148MB of media assets via a private Hugging Face dataset with a pull-on-deploy bundle.

REAL FAILURES VICTOR IS OPEN ABOUT (build-in-public means honest — weave these in when relevant, never hide them):
- Six earlier sports-prediction approaches failed on unseen data before Odonata's blind validation finally held up.
- Project CLAY (the 21-container monolith) was retired after hitting a real limitation — replaced by the leaner, trigger-based ForChi design.
- Early YouTube/LLM experiments overfit to the training window; blind validation caught them, and the honest answer was "no bet".

ALWAYS-TRUE PERSONAL NOTES (add naturally where they fit — do NOT force all of them into every post):
- Agentic coding tools changed Victor's Linux workflow: he used to do everything manually; now agents handle setup and he ships much faster. He protects credentials with .gitignore + .env and follows industry-standard secrets hygiene — never a plaintext key in a repo or an env dump.
- Victor integrates AI into real products and builds MCP servers.
- What he is building next: a crypto trading bot and an online ecommerce store — both powered by the same AI + automation skills.

STYLE RULES:
- Professional, confident, conversational. This is engineering story-telling: what the problem was, what I built, the interesting technical decisions, and the honest result.
- The TOPIC names which project to feature. Write ONLY about that project. Use ONLY the real facts above — NEVER invent metrics, employers, customers, funding, or numbers. If a fact isn't listed, don't claim it.
- GO DEEP and SPECIFIC: name the actual tools, APIs, and architecture (the real stack, the real APIs integrated, the real trade-offs). The reader should understand the engineering and take away something concrete.
- Include the failure / honest lesson where it is real for the featured project — a post that admits a mistake is more trustworthy than one that hides it.
- Structure: a strong opening hook (the problem / the ambitious goal), a body with 2-4 in-depth points in short punchy paragraphs (what was built, how, key decisions, what failed), and a closing takeaway or honest lesson.
- Lead with WHAT WAS DONE and the RESULT (e.g. "live in production", "2 videos a day", "blind-validated"), then explain HOW.
- END the post with 3-6 relevant hashtags on their own final line(s) (e.g. #BuildInPublic #CloudEngineering #Automation #AIEngineering #NodeJS #DevOps — pick the most relevant to the project).
- NO emojis, NO markdown symbols (* or ** or # headers), NO fluff, NO "I'm excited to announce" hype.
- NEVER write about AI news, other companies, market trends, or things Victor did not build.

Write a completely NEW, original post about the given topic.

Return JSON in this exact format:
{ "postText": "...", "visualTopic": "4-8 word visual imagery phrase" }`;

async function generateFacebookPost(topic) {
  // keepHashtags=true so the FB hashtags survive cleanup, then finalize guarantees
  // "Fickle youth" sits on its own line right above the trailing hashtags.
  const result = await generateStructured(`${FACEBOOK_AUTO_PROMPT}\n\nTheme: "${topic}"`, topic, { keepHashtags: true });
  result.postText = finalizePost(result.postText, { facebook: true, fallbackTags: "#FickleYouth #Healing #LettingGo" });
  return result;
}

async function generateLinkedInPost(topic, mode = "project") {
  // mode "job" = job-seeking post (hiring managers) · "project" = build-in-public
  // showcase. Both grounded in the REAL facts embedded in the prompts — no web news.
  const prompt =
    mode === "job"
      ? `${LINKEDIN_JOB_PROMPT}\n\nANGLE (the job-seeking angle for this post): "${topic}"`
      : `${LINKEDIN_PROJECT_PROMPT}\n\nTOPIC (which project to showcase): "${topic}"`;
  const fallbackTags =
    mode === "job"
      ? "#OpenToWork #CloudSecurity #DevOps #AIEngineering"
      : "#BuildInPublic #CloudEngineering #Automation #AIEngineering";
  const result = await generateStructured(prompt, topic, { keepHashtags: true });
  result.postText = finalizePost(result.postText, { facebook: false, fallbackTags });
  return result;
}

// Shared helper: call provider, parse JSON, fall back gracefully.
async function generateStructured(prompt, fallbackTopic, opts = {}) {
  try {
    const rawJson = await provider.generate(prompt, { type: "object" });
    const cleaned = rawJson.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const postText = cleanPostFormatting(parsed.postText || fallbackTopic, opts);
    const visualTopic = parsed.visualTopic || fallbackTopic;

    return { postText, visualTopic };
  } catch (err) {
    console.warn("[contentGen] Failed to generate structured post content:", err.message);
    return {
      postText: cleanPostFormatting(fallbackTopic, opts),
      visualTopic: fallbackTopic
    };
  }
}

module.exports = {
  generateContentAndVisualTopic,
  generateFacebookPost,
  generateLinkedInPost,
  cleanPostFormatting,
  splitTrailingHashtags,
  finalizePost
};
