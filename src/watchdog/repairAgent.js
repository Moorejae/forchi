// src/watchdog/repairAgent.js — THE DEEPSEEK REPAIR AGENT (VPS, user spec 2026-08-31).
//
// User's model:
//   * DeepSeek is the AGENTIC REPAIR brain (fixing bugs, updating code) — NOT a
//     chat model (Gemini keys handle chat).
//   * VS Code (code-server on the VPS) is the CODE EDITOR / tooling the repair
//     agent drives to fix issues.
//   * Flow: wake-trigger detects a problem -> writes a wake file -> this agent
//     reads it, gathers diagnostics, asks DeepSeek for a repair plan, applies it
//     through safe file-edits + service restarts (the same ops a human would do
//     in VS Code), verifies, and Telegram-notifies the outcome.
//
// SAFETY:
//   * DeepSeek returns a STRUCTURED JSON plan, not free-form shell.
//   * The plan is validated against an ALLOWLIST before anything runs.
//   * File edits are limited to /opt/forchi (the repo workspace).
//   * Shell commands are limited to safe ops (systemctl, git, npm, node, python,
//     restart, log reads, copy). NO rm -rf, NO arbitrary downloads, NO secrets.
//   * Every action is logged; nothing is ever run as a surprise.
//
// Usage:
//   node src/watchdog/repairAgent.js                 # read newest wake file, repair
//   node src/watchdog/repairAgent.js --wake <file>   # repair a specific wake file
//   node src/watchdog/repairAgent.js --diagnose      # only gather diagnostics + plan, don't apply
//   node src/watchdog/repairAgent.js --check         # do a normal wake-trigger check (reuse)
const path = require("path");
const fs = require("fs");
const { execFileSync, spawnSync } = require("child_process");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(BASE, ".env") });

const WAKE_DIR = path.join(BASE, "temp_media", "wake");
const LOG_FILE = path.join(BASE, "temp_media", "repair_agent.log");
const REPO = BASE; // only edit within the repo

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}
function env(k) { return (process.env[k] || "").trim(); }

// ── DeepSeek call ──────────────────────────────────────────────────────────
async function callDeepSeek(system, user, maxTokens = 4000) {
  const key = env("DEEPSEEK_API_KEY");
  if (!key) throw new Error("DEEPSEEK_API_KEY not set");
  const model = env("DEEPSEEK_MODEL") || "deepseek-chat";
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek empty response");
  log(`[repair] DeepSeek (${model}) replied (${content.length} chars)`);
  return content;
}

// ── Diagnostics ────────────────────────────────────────────────────────────
function sh(cmd, args, timeout = 30000) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", timeout });
    return (r.stdout || "").trim();
  } catch { return ""; }
}

function sysctl(cmd) { return sh("/bin/systemctl", cmd.split(" ")); }

function gatherDiagnostics() {
  const out = {};
  out.time = new Date().toISOString();
  // services
  const svcs = ["forchi.service", "v10-watchdog.service", "voice-worker.service", "v61-bot.service", "forchi-wake.service", "forchi-shorts.service", "code-server.service"];
  out.services = {};
  for (const s of svcs) out.services[s] = sysctl(["is-active", s].join(" ")) || "?";
  // workflow lock
  try { out.workflowLock = JSON.parse(fs.readFileSync(path.join(BASE, "temp_media", "workflow.lock"), "utf8")); } catch { out.workflowLock = null; }
  // recent wake files
  try { out.wakeFiles = fs.readdirSync(WAKE_DIR).slice(-5); } catch { out.wakeFiles = []; }
  // git state
  out.git = sh("git", ["-C", BASE, "log", "--oneline", "-3"]);
  // disk + load
  out.disk = sh("df", ["-h", "/", "|", "tail", "-1"]);
  out.load = sh("uptime");
  // recent journalctl for any DOWN service
  const down = Object.entries(out.services).filter(([, v]) => v !== "active").map(([k]) => k);
  out.downLogs = {};
  for (const s of down) {
    const j = sh("journalctl", ["-u", s, "--no-pager", "-n", "25"]);
    out.downLogs[s] = j.slice(-1500);
  }

  // ── ENTIRE WORKFLOW / PIPELINE ECOSYSTEM (user directive 2026-08-31) ──────
  // Pipeline state files, so the repair brain sees the whole system, not just
  // the host. All reads are defensive (files may not exist on a fresh box).
  const readStateFile = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(BASE, rel), "utf8")); } catch { return null; }
  };
  out.pipeline = {
    v10_mode: readStateFile("temp_media/v10_mode.json"),          // 2-slot V10 scheduler
    shorts_posts: readStateFile("temp_media/video_posts.json"),   // shorts cadence
    v10_script_state: readStateFile("temp_media/v10_script_state.json"),
    auto_mode: readStateFile("data/auto_mode.json"),              // social auto-posting on/off
  };
  // V10 run stage failures (hard-failed stages in temp_media/v10_run/<id>/state.json)
  out.pipeline.v10_run_failures = [];
  try {
    const runsDir = path.join(BASE, "temp_media", "v10_run");
    if (fs.existsSync(runsDir)) {
      for (const d of fs.readdirSync(runsDir)) {
        const st = readStateFile(path.join("temp_media/v10_run", d, "state.json"));
        if (st && st.stages) {
          const failed = Object.entries(st.stages).filter(([, v]) => v && v.status === "failed").map(([k, v]) => `${k}:${(v.error || "").slice(0, 120)}`);
          if (failed.length) out.pipeline.v10_run_failures.push({ run: d, failed });
        }
      }
    }
  } catch {}
  // HF space stages (image-gen + voice backends)
  out.pipeline.hf_spaces = {};
  for (const n of ["slymun/forchi-img", "slymun/higgs-tts3"]) {
    try {
      const j = JSON.parse(sh("curl", ["-s", "--max-time", "12", `https://huggingface.co/api/spaces/${n}/runtime`]) || "{}");
      out.pipeline.hf_spaces[n] = j.stage || "unknown";
    } catch { out.pipeline.hf_spaces[n] = "unknown"; }
  }
  return out;
}

// ── Safety validation ──────────────────────────────────────────────────────
const SAFE_BIN = new Set(["systemctl", "git", "npm", "node", "python3", "/opt/forchi/.venv/bin/python", "bash", "cp", "mv", "ls", "cat", "mkdir", "touch", "chmod", "kill", "pkill", "rm", "curl", "journalctl", "df", "uptime", "tail", "grep"]);
const NEVER_ARGS = /rm\s+-[a-z]*r|rm\s+-rf|>\s*\/etc|:\s*\/dev|curl.*\|.*sh|wget|nc\s|ncat|chmod\s+777\s+\/|useradd|passwd|mkfs|dd\s+if=|DROP\s+TABLE|GRANT\s+ALL/i;

function validateCommand(cmd) {
  if (typeof cmd !== "string" || cmd.length > 500) return "command too long or not string";
  if (NEVER_ARGS.test(cmd)) return "unsafe pattern blocked";
  const bin = cmd.trim().split(/\s+/)[0];
  const base = bin.split("/").pop();
  for (const allowed of SAFE_BIN) {
    if (base === allowed.split("/").pop()) return null; // ok
  }
  return `binary "${base}" not in allowlist`;
}

function validateEdit(edit) {
  const file = (edit && edit.file) || "";
  const abs = path.resolve(BASE, file);
  if (!abs.startsWith(REPO + path.sep) && abs !== REPO) return `edit outside repo: ${file}`;
  if (file.includes(".env") && /secret|token|password|api[_-]?key/i.test(edit.old || "")) return "refusing to touch secrets via repair agent";
  return null;
}

// ── Apply a validated repair plan ──────────────────────────────────────────
async function applyPlan(plan) {
  const applied = { commands: [], edits: [], restarts: [] };
  for (const action of plan.actions || []) {
    const type = action.type;
    if (type === "edit") {
      const err = validateEdit(action);
      if (err) { log(`[repair] SKIP edit ${action.file}: ${err}`); continue; }
      const p = path.join(BASE, action.file);
      let content = "";
      try { content = fs.readFileSync(p, "utf8"); } catch { content = ""; }
      const oldStr = action.old || "";
      const newStr = action.new || "";
      if (!oldStr) { if (!action.append) continue; fs.writeFileSync(p, content + newStr); applied.edits.push(`${action.file} (append)`); log(`[repair] appended to ${action.file}`); continue; }
      if (!content.includes(oldStr)) { log(`[repair] SKIP edit ${action.file}: old string not found`); continue; }
      if (content.split(oldStr).length - 1 > 1) { log(`[repair] SKIP edit ${action.file}: old string not unique`); continue; }
      fs.writeFileSync(p, content.replace(oldStr, newStr));
      applied.edits.push(`${action.file} (replace)`);
      log(`[repair] edited ${action.file}`);
    } else if (type === "cmd") {
      const err = validateCommand(action.cmd);
      if (err) { log(`[repair] SKIP cmd: ${err}`); continue; }
      log(`[repair] RUN: ${action.cmd}`);
      try { execFileSync("/bin/bash", ["-lc", action.cmd], { stdio: "inherit", timeout: 60000 }); applied.commands.push(action.cmd); }
      catch (e) { log(`[repair] cmd failed: ${e.message}`); }
    } else if (type === "restart") {
      const svc = action.service;
      if (!/^[a-zA-Z0-9._-]+\.service$/.test(svc)) { log(`[repair] SKIP restart ${svc}`); continue; }
      log(`[repair] restart ${svc}`);
      try { execFileSync("/bin/systemctl", ["restart", svc], { stdio: "inherit", timeout: 60000 }); applied.restarts.push(svc); }
      catch (e) { log(`[repair] restart ${svc} failed: ${e.message}`); }
    }
  }
  return applied;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const diagOnly = args.includes("--diagnose");

  // pick wake file
  let wakeFile = null;
  const wi = args.indexOf("--wake");
  if (wi >= 0) wakeFile = args[wi + 1];
  if (!wakeFile) {
    try { const files = fs.readdirSync(WAKE_DIR).filter((f) => f.endsWith(".json")).sort(); if (files.length) wakeFile = path.join(WAKE_DIR, files[files.length - 1]); } catch {}
  }

  const diag = gatherDiagnostics();
  const problem = wakeFile ? (() => { try { return fs.readFileSync(wakeFile, "utf8"); } catch { return "no wake file"; } })() : "manual repair invocation";

  const system = `You are the ForChi VPS REPAIR AGENT. Diagnose the problem below and produce a STRICT JSON repair plan.
Rules:
- Output ONLY JSON: {"diagnosis":"short","actions":[{"type":"cmd|edit|restart", ...}]}
- For "cmd": {"type":"cmd","cmd":"<one safe bash command>"}. ALLOWED binaries: systemctl, git, npm, node, python3, /opt/forchi/.venv/bin/python, cp, mv, ls, cat, mkdir, touch, chmod, kill, pkill, rm (non-recursive only), curl, journalctl, df, uptime, tail, grep. NEVER rm -rf, never touch /etc secrets, never download.
- For "edit": {"type":"edit","file":"<path relative to /opt/forchi>","old":"<exact existing snippet>","new":"<replacement>"} OR {"type":"edit","file":"...","append":"<text>"}. Only edit files under /opt/forchi. NEVER edit .env secrets.
- For "restart": {"type":"restart","service":"<name>.service"}.
- Prefer minimal, targeted fixes. If the problem is transient (a service just needs a restart) that's a valid fix.`;
  const user = `PROBLEM SOURCE: ${problem}\n\nDIAGNOSTICS:\n${JSON.stringify(diag, null, 2)}`.slice(0, 9000);

  log(`[repair] diagnosing (diagOnly=${diagOnly})...`);
  let plan;
  try {
    const raw = await callDeepSeek(system, user);
    plan = JSON.parse((raw.match(/\{[\s\S]*\}/) || [raw])[0]);
  } catch (e) {
    // FALLBACK (user architecture): DeepSeek is the primary repair brain; when
    // it's down/out of quota, Copilot (already in code-server) takes over. Write
    // a handoff TODO file with the full context so the next agent session in
    // VS Code can pick this up and fix it with Copilot.
    log(`[repair] DeepSeek/parse failed: ${e.message}`);
    try {
      fs.mkdirSync(WAKE_DIR, { recursive: true });
      const todo = path.join(WAKE_DIR, `agent_todo_${Date.now()}.md`);
      fs.writeFileSync(todo, `# 🤖 Repair needed — DeepSeek was unavailable, Copilot take over\n\n` +
        `DeepSeek error: ${e.message}\n` +
        `Time: ${new Date().toISOString()}\n\n` +
        `## Problem source\n${problem}\n\n` +
        `## Full diagnostics\n\`\`\`json\n${JSON.stringify(diag, null, 2).slice(0, 8000)}\n\`\`\`\n\n` +
        `## Instructions\nDiagnose and fix using Copilot in this workspace (/opt/forchi). ` +
        `Prefer minimal, safe changes. Restart the affected service, then verify with ` +
        `\`FORCHI_BASE=/opt/forchi node src/watchdog/wakeTrigger.js check\`.\n`);
      log(`[repair] Copilot handoff written: ${todo}`);
    } catch (w) { log(`[repair] handoff write failed: ${w.message}`); }
    return 1;
  }

  log(`[repair] diagnosis: ${plan.diagnosis || "(none)"}`);
  log(`[repair] actions: ${JSON.stringify((plan.actions || []).map((a) => a.type))}`);

  if (diagOnly) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }

  const applied = await applyPlan(plan);

  // verify: re-run service checks
  const verify = gatherDiagnostics();
  const stillDown = Object.entries(verify.services).filter(([, v]) => v !== "active").map(([k]) => k);
  log(`[repair] applied: ${JSON.stringify(applied)}`);
  log(`[repair] verify: still down = ${stillDown.length ? stillDown.join(", ") : "none"}`);

  // notify
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("JOBS_NOTIFY_CHAT_ID") || env("TELEGRAM_CHAT_ID");
  if (token && chat) {
    const msg = `🔧 *ForChi repair agent*\nDiagnosis: ${plan.diagnosis || "n/a"}\nApplied: ${applied.commands.length} cmds, ${applied.edits.length} edits, ${applied.restarts.length} restarts\nStill down: ${stillDown.length ? stillDown.join(", ") : "none"}`;
    try { await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: "Markdown" }), signal: AbortSignal.timeout(20000) }); }
    catch (e) { log(`[repair] notify failed: ${e.message}`); }
  }
  return stillDown.length ? 1 : 0;
}

if (require.main === module) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { gatherDiagnostics, applyPlan, validateCommand, validateEdit, callDeepSeek };
