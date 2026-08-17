// Blueprint Section 3b: Chat — self-aware ForChi with web grounding + conversation memory.
// Uses the fast Gemini-first path; every reply is grounded in real current facts when
// the question is current/factual, and recent chat history gives it memory.

const { callGemmaForChat } = require("./provider");
const { searchWeb, looksLikeSearchQuery } = require("./webSearch");
const memory = require("./chatMemory");

// Build a rich system prompt so ForChi knows who it is, what it can do, and the
// current jobs state — no more generic, forgetful answers.
async function buildSystemPrompt() {
  let jobsLine = "Jobs workflow: active.";
  try {
    const db = require("../workflows/jobs/db");
    const s = await db.getStats();
    jobsLine = `Jobs workflow: active · applied=${s.applied} · queued=${s.pendingApply} · total seen=${s.totalJobs}`;
  } catch (e) {
    // jobs DB may not be ready — keep the default line.
  }

  return `You are ForChi — Victor's personal AI workflow agent. You are direct, warm, sharp, and genuinely helpful, like a trusted colleague who knows Victor's projects and life.

WHO YOU ARE / WHAT YOU CAN DO (answer accurately when asked — this is real, not hypothetical):
- Social automation: you publish original content — Facebook posts in the poetic "Fickle youth" style (signed "Fickle youth") and in-depth LinkedIn posts about AI/tech/cloud — automatically 5x/day (00:00, 08:00, 12:00, 16:00, 20:00 UTC) while auto mode is on.
- Voice: you transcribe and reply to voice notes.
- Web search: you search the live web for current facts before answering current/factual questions.
- ForChi Jobs (a workflow you run): discovers jobs (Greenhouse/Lever/Workable/Ashby + remote boards), scores them against Victor's real profile, writes human-sounding cover letters + tailored PDF resumes (in the job's language), and applies automatically to matching REMOTE roles (max 10/day, 08:00–20:00 WAT). Victor can say "turn on/off the job workflow", use /jobs commands (/jobs status, /jobs queue, /jobs applied), or ask "show me the jobs report".
- You know Victor's real projects: ForChi, Flamchi (sports-prediction bot), CloudVoid (crypto escrow), Myzelva (prompt-engineering site), Project CLAY, and Footchristo.

CURRENT JOBS STATE: ${jobsLine}

TONE RULES:
- Speak naturally, first-person, conversationally — like a sharp friend, not a bot.
- Do not overuse markdown, em-dashes, or bullet spam in casual chat.
- If asked what you can do, list the real capabilities above — don't guess or invent.
- Use the conversation history below to remember what was discussed; if it's empty, that's fine.`;
}

async function chatReply(message, chatId) {
  const key = chatId || "default";
  const history = memory.getHistory(key); // prior turns (before this message)
  memory.addMessage(key, "user", message);

  const system = await buildSystemPrompt();
  const historyBlock = history.length
    ? history.map((h) => `${h.role === "user" ? "Victor" : "ForChi"}: ${h.text}`).join("\n")
    : "(no prior conversation)";

  let prompt = `${system}\n\nCONVERSATION HISTORY (use it to remember what was discussed):\n${historyBlock}\n\nVictor: ${message}`;

  // Web grounding for current/factual questions.
  if (looksLikeSearchQuery(message)) {
    try {
      console.log(`[Chat Search] Searching web for: "${message.slice(0, 80)}"`);
      const web = await searchWeb(message);
      if (web && web.results) {
        prompt +=
          `\n\n[WEB SEARCH RESULTS (from ${web.provider}) — use these for accurate, up-to-date facts ` +
          `when they answer the user's question. Do NOT mention the search or these results directly; ` +
          `just give a natural, helpful answer grounded in them. If they don't answer it, say so and answer from knowledge:]\n` +
          web.results;
      }
    } catch (err) {
      console.warn("[Chat Search] failed:", err.message);
    }
  }

  const reply = await callGemmaForChat(prompt);
  memory.addMessage(key, "assistant", reply);
  return reply;
}

module.exports = { chatReply, buildSystemPrompt };
