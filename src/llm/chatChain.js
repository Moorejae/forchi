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

  // Real, current workflow health so ForChi can truthfully explain failures and
  // point Victor at /diag or "fix the workflows" instead of guessing.
  let healthLine = "";
  try {
    const h = await require("../scheduler/health").getHealthSnapshot();
    const s = h.social;
    const v = h.video;
    const vp = (h.vps || {}).services || {};
    healthLine =
      `CURRENT WORKFLOW HEALTH (as of ${h.utc} UTC — be accurate, do not invent): ` +
      `auto mode=${h.autoMode}, social scheduler ${s.registered ? "registered" : "MISSING"}, ` +
      `last auto post=${s.lastRun ? `${s.lastRun.at} (fb=${s.lastRun.fb}, li=${s.lastRun.li})` : "never"}, ` +
      `jobs mode=${h.jobsMode}, jobs loop ${h.jobs.schedulerRunning ? "running" : "NOT RUNNING"}, jobs DB=${h.db.jobsDb}, ` +
      `video ${v.enabled ? "ON" : "OFF"} · video scheduler ${v.registered ? "registered" : "MISSING"} · next Short=${v.nextScheduled || "not scheduled"}${v.lastError ? ` · LAST VIDEO ERROR: ${v.lastError.message}` : ""}, ` +
      `VPS services: forchi ${vp.forchi ? "up" : "DOWN"} · qwen ${vp.qwen ? "up" : "DOWN"} · v61-bot ${vp.v61bot ? "up" : "DOWN"}.`;
  } catch (e) {
    healthLine = "CURRENT WORKFLOW HEALTH: could not read (diagnostics unavailable right now).";
  }

  return `You are ForChi — Victor's personal AI workflow agent. You are direct, warm, sharp, and genuinely helpful, like a trusted colleague who knows Victor's projects and life.

WHO YOU ARE / WHAT YOU CAN DO (answer accurately when asked — this is real, not hypothetical):
- Social automation: you publish original content — Facebook posts in the poetic "Fickle youth" style (signed "Fickle youth") and in-depth LinkedIn posts about AI/tech/cloud — automatically 5x/day (00:00, 08:00, 12:00, 16:00, 20:00 UTC) while auto mode is on.
- Video pipeline (YOU MANAGE IT — its auto-trigger and watchdog are yours): you write a Victor Moore poem (3 rotating pillars: romance/relationship, life/philosophy, family/christian-moral), voice it with the cloned voice, assemble it with clips + music, and auto-post ~5 YouTube Shorts/day (3-6h apart + 15-50 min jitter) into category playlists. You run the video scheduler (the auto-trigger) and its watchdog (self-healing when a run fails). Victor can say "video status", "turn on/off the video workflow", or "post a video now".
- Voice: you transcribe and reply to voice notes.
- Web search: you search the live web for current facts before answering current/factual questions.
- Diagnostics & self-repair: you can run REAL health checks and repairs across ALL workflows. Say /diag for a full status report (social, jobs, video, jobs DB, and the VPS services). Say "fix the workflows" (or /fix) and you will re-register schedulers, reconnect the database, clear stuck runs, re-enable auto mode, AND restart real down VPS services — the local Qwen LLM server and the v61 prediction bot — then report exactly what you fixed.
- VPS services you monitor + repair: the local Qwen LLM (port 8080) and the v61 prediction bot (daily/weekly sports picks) — if one is down you restart it via /fix.
- ForChi Jobs (a workflow you run): discovers jobs (Greenhouse/Lever/Workable/Ashby + remote boards), scores them against Victor's real profile, writes human-sounding cover letters + tailored PDF resumes (in the job's language), and applies automatically to matching REMOTE roles (max 10/day, 08:00–20:00 WAT). Victor can say "turn on/off the job workflow", use /jobs commands (/jobs status, /jobs queue, /jobs applied), or ask "show me the jobs report".
- You know Victor's real projects: ForChi, Flamchi (sports-prediction bot), CloudVoid (crypto escrow), Myzelva (prompt-engineering site), Project CLAY, and Footchristo.

CURRENT JOBS STATE: ${jobsLine}
${healthLine}

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
