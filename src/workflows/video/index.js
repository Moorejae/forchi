// src/workflows/video/index.js
// The AUTONOMOUS YouTube Shorts workflow ("Victor Moore" channel @sirxlud).
//
// One full cycle:  topic rotation + anti-repeat script (Gemini) -> Higgs voice ->
//                  clips -> assemble (AI instrumental, 2s closure tail, 50s cap) ->
//                  QA -> upload -> add to topic playlist -> record -> notify.
//
// Self-healing: every stage has retry; recoverable errors retry on the next tick,
// fatal errors are reported to the user. State persists to temp_media/video_mode.json
// and temp_media/video_posts.json so the bot + watchdog can inspect & repair it.
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "c:\\Users\\hp\\forchi";
const VENV_PY = path.join(BASE, ".venv", "Scripts", "python.exe");
const MODE_FILE = path.join(BASE, "temp_media", "video_mode.json");
const POSTS_FILE = path.join(BASE, "temp_media", "video_posts.json");
const RUNS_DIR = path.join(BASE, "temp_media");

// Niche topics — MUST stay in sync with tools/_video_script.py TOPICS
const TOPICS = [
  "dating, romance and the ache of waiting",
  "what we owe the people we love",
  "grace, faith and forgiveness",
  "the quiet work of a lasting relationship",
  "why we lie to ourselves about love",
  "christian hope in a broken world",
  "the courage of staying when it is hard",
  "human behavior and the masks we wear",
  "love that outlasts time",
  "the cost of virtue and the weight of empathy",
];

const state = {
  enabled: false,
  registered: false,
  running: false,
  lastPost: null,     // { at, title, url, videoId, topic, playlistId }
  lastError: null,    // { at, stage, message }
  nextScheduled: null,
  consecutiveFailures: 0,
};

// load persisted enabled flag at boot (survives restarts)
try {
  const m = JSON.parse(fs.readFileSync(MODE_FILE, "utf8"));
  state.enabled = !!m.enabled;
} catch { /* first run */ }

function loadMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, "utf8")); } catch { return {}; }
}
function saveMode(m) { fs.writeFileSync(MODE_FILE, JSON.stringify(m, null, 2)); }
function loadPosts() {
  try { return JSON.parse(fs.readFileSync(POSTS_FILE, "utf8")); } catch { return []; }
}
function savePosts(p) { fs.writeFileSync(POSTS_FILE, JSON.stringify(p, null, 2)); }

function setEnabled(on) {
  state.enabled = !!on;
  const m = loadMode();
  m.enabled = state.enabled;
  saveMode(m);
}

function py(args, timeoutMs = 25 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(VENV_PY, args, { cwd: BASE, timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message).trim().split("\n").slice(-6).join(" | ");
        reject(new Error(msg || err.message));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function nextTopic() {
  const posts = loadPosts();
  const used = new Set(posts.map((p) => p.topic).filter(Boolean));
  for (const t of TOPICS) if (!used.has(t)) return t;
  return TOPICS[posts.length % TOPICS.length];
}

// ── One full video cycle ───────────────────────────────────────────────────
async function runOnce({ notify } = {}) {
  if (state.running) return { skipped: "already running" };
  state.running = true;
  state.lastError = null;
  const name = "vm_" + Math.floor(Date.now() % 1000000);
  try {
    // 1. create the video (python orchestrator: script -> Higgs voice -> clips -> assemble)
    const topic = nextTopic();
    const seed = Math.floor(Math.random() * 100000);
    await py([
      path.join("tools", "_video_run.py"),
      "--generate", "--topic", topic, "--name", name, "--seed", String(seed),
    ]);

    // 2. read run manifest + QA
    const runPath = path.join(RUNS_DIR, name + "_run.json");
    const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
    run.topic = topic;
    const mp4 = run.output;
    if (!mp4 || !fs.existsSync(mp4)) throw new Error("assembled mp4 missing");
    const sizeMb = fs.statSync(mp4).size / 1048576;
    if (sizeMb < 0.5) throw new Error(`suspiciously small mp4 (${sizeMb.toFixed(2)}MB)`);
    const wc = (run.script || "").split(/\s+/).filter(Boolean).length;
    if (wc < 40) throw new Error(`script too short (${wc} words)`);

    // 3. upload (YouTube API via youtube.js exports) + auto playlist by topic
    const youtube = require("./youtube.js");
    const { ensureTopicPlaylist, addVideoToPlaylist } = require("./playlists.js");
    const { buildTitle, buildDescription } = require("./metadata.js");
    const token = await youtube.refreshAccess();
    const baseTitle = "Victor Moore";
    const title = buildTitle(baseTitle, null, null);
    const description = buildDescription({
      script: run.script, baseTitle, mood: run.mood || "reflection",
      mode: run.mode || "clean", seed: run.seed || seed,
    });
    const tags = title.match(/#\w+/g) || ["#shorts"];
    const uploaded = await youtube.uploadVideo(mp4, { title, description, tags, privacyStatus: "public" });
    let playlistId = null;
    try {
      playlistId = await ensureTopicPlaylist(token, topic);
      await addVideoToPlaylist(token, playlistId, uploaded.videoId);
    } catch (pe) {
      // playlist failure should not fail the whole post (video is already live)
      console.warn("[video] playlist add failed (video is live):", pe.message);
    }

    // 4. record + state
    const post = {
      at: new Date().toISOString(),
      title,
      url: uploaded.url,
      videoId: uploaded.videoId,
      topic,
      playlistId,
      script: run.script,
      sizeMb: Math.round(sizeMb * 10) / 10,
    };
    const posts = loadPosts();
    posts.push(post);
    savePosts(posts);
    state.lastPost = post;
    state.consecutiveFailures = 0;
    if (notify) notify(`🎬 *New Short live* — ${title}\n${uploaded.url}\nTopic: ${topic}`);
    return post;
  } catch (err) {
    state.lastError = { at: new Date().toISOString(), stage: "runOnce", message: err.message };
    state.consecutiveFailures += 1;
    if (notify) notify(`⚠️ *Video workflow error* (fail #${state.consecutiveFailures}): ${err.message}`);
    throw err;
  } finally {
    state.running = false;
  }
}

function getVideoState() {
  return {
    enabled: state.enabled,
    registered: state.registered,
    running: state.running,
    lastPost: state.lastPost ? {
      at: state.lastPost.at,
      url: state.lastPost.url,
      topic: state.lastPost.topic,
    } : null,
    lastError: state.lastError,
    nextScheduled: state.nextScheduled,
    consecutiveFailures: state.consecutiveFailures,
    totalPosts: loadPosts().length,
  };
}

module.exports = { runOnce, getVideoState, setEnabled, nextTopic, state, TOPICS, loadPosts };
