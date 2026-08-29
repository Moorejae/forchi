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

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const VENV_PY = process.platform === "win32"
  ? path.join(BASE, ".venv", "Scripts", "python.exe")
  : path.join(BASE, ".venv", "bin", "python");
const MODE_FILE = path.join(BASE, "temp_media", "video_mode.json");
const POSTS_FILE = path.join(BASE, "temp_media", "video_posts.json");
const RUNS_DIR = path.join(BASE, "temp_media");

// Three posting pillars (rotate 1 → 2 → 3 → 1…). MUST stay in sync with
// tools/_video_script.py TOPICS.
const TOPIC_CATEGORIES = [
  {
    label: "Romance & Relationship",
    topics: [
      "dating, romance and the ache of waiting",
      "what we owe the people we love",
      "the quiet work of a lasting relationship",
      "why we lie to ourselves about love",
      "love that outlasts time",
    ],
  },
  {
    label: "Life & Philosophy",
    topics: [
      "human behavior and the masks we wear",
      "the cost of virtue and the weight of empathy",
      "the courage of staying when it is hard",
      "the illusion of safety and the tyranny of tomorrow",
      "outgrowing what no longer fits",
    ],
  },
  {
    label: "Family & Christian Moral",
    topics: [
      "grace, faith and forgiveness",
      "christian hope in a broken world",
      "family, faith and the weight of duty",
      "forgiveness as a discipline",
      "the quiet sacrifice that holds the world together",
    ],
  },
];

// Flat list kept for backwards-compat exports.
const TOPICS = TOPIC_CATEGORIES.flatMap((c) => c.topics);

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

// Extract the actual exception from a python/tool error instead of the raw traceback.
function cleanError(text) {
  const lines = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return "unknown error";
  const looks = /error|errno|no such|refused|timeout|permission|denied|missing|failed|exception|not found|unexpected/i;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (looks.test(lines[i])) return lines[i];
  }
  return lines[lines.length - 1];
}

// Human description of what the pipeline already attempted, per stage.
const TRIED = {
  "generating the video (script → voice → clips → assembly)": "I wrote the script, voiced it with the AI voice, picked the clips and assembled the video",
  "quality-checking the video": "I generated the video and checked it before upload",
  "uploading the video to YouTube": "I made the video and tried to upload it to YouTube",
  "adding the video to its playlist": "I uploaded the video and tried to file it into its theme playlist",
  "posting to TikTok and Facebook": "the video is live on YouTube and I tried to push it to TikTok and Facebook",
};

// Post the same Short to TikTok + Facebook in parallel (like the social workflow's
// Promise.allSettled). YouTube is the primary platform (must succeed); these are
// secondary — a failure here must NOT fail the whole post, it's recorded instead.
async function postToSecondaryPlatforms(mp4, { title, description }) {
  const tasks = [];
  // TikTok — DISCONNECTED by user directive (2026-08-27). Skipped while
  // TIKTOK_DISABLED=true in .env; remove that var to re-enable.
  tasks.push(
    (async () => {
      if (process.env.TIKTOK_DISABLED === "true") {
        return { platform: "tiktok", skipped: true, reason: "TikTok disconnected (TIKTOK_DISABLED=true)" };
      }
      const tiktok = require("./tiktok.js");
      const ts = require("./tokenStore.js");
      const hasToken = await ts.getTikTokToken().catch(() => null);
      if (!hasToken && !process.env.TIKTOK_ACCESS_TOKEN) {
        return { platform: "tiktok", skipped: true, reason: "no token — run 'tiktok auth'" };
      }
      const res = await tiktok.uploadVideo(mp4, { title, description });
      return { platform: "tiktok", success: true, publishId: res.publishId, status: res.status };
    })()
  );
  // Facebook (Page already configured via FACEBOOK_PAGE_ID/TOKEN)
  tasks.push(
    (async () => {
      const { postToFacebookVideo } = require("./facebookVideo.js");
      const res = await postToFacebookVideo(mp4, { title, description });
      return { platform: "facebook", success: true, postId: res.postId, url: res.url };
    })()
  );

  const settled = await Promise.allSettled(tasks);
  return settled.map((o) => {
    if (o.status === "fulfilled") return o.value;
    const r = o.reason || {};
    return { platform: r.platform || "unknown", success: false, error: r.message || String(r) };
  });
}

function py(args, timeoutMs = 25 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(VENV_PY, args, { cwd: BASE, timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const raw = (stderr || stdout || err.message || "").trim();
        const e = new Error(cleanError(raw) || err.message);
        e.raw = raw;
        reject(e);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function rotationIndex() {
  try {
    const m = JSON.parse(fs.readFileSync(MODE_FILE, "utf8"));
    return Number(m.topicCategoryIdx) || 0;
  } catch { return 0; }
}

function bumpRotation() {
  try {
    const m = JSON.parse(fs.readFileSync(MODE_FILE, "utf8")) || {};
    m.topicCategoryIdx = (rotationIndex() + 1) % TOPIC_CATEGORIES.length;
    fs.writeFileSync(MODE_FILE, JSON.stringify(m, null, 2));
  } catch {}
}

function nextTopic() {
  const posts = loadPosts();
  const used = new Set(posts.map((p) => p.topic).filter(Boolean));
  // rotate the 3 pillars, then pick the least-recently-used topic inside it
  const cat = TOPIC_CATEGORIES[rotationIndex() % TOPIC_CATEGORIES.length];
  let topic = null;
  for (const t of cat.topics) if (!used.has(t)) { topic = t; break; }
  if (!topic) topic = cat.topics[posts.length % cat.topics.length];
  return { topic, category: cat.label };
}

// Storage hygiene: once a Short is uploaded + recorded, delete the created
// video/audio/temp so the disk (VPS/local) never accumulates rendered files.
// Only per-run artifacts are removed — the shared clip library (media/clips),
// instrumental music (.instrumental) and voice refs are always kept.
function cleanupRunFiles(name, run) {
  const targets = [];
  if (run && run.output) targets.push(run.output);
  targets.push(path.join(RUNS_DIR, name + ".mp3"));
  targets.push(path.join(RUNS_DIR, name + "_run.json"));
  targets.push(path.join(RUNS_DIR, name + "_parts"));
  for (const t of targets) {
    try {
      if (!fs.existsSync(t)) continue;
      if (fs.lstatSync(t).isDirectory()) fs.rmSync(t, { recursive: true, force: true });
      else fs.unlinkSync(t);
      console.log("[video] cleaned", t);
    } catch (e) {
      console.warn("[video] cleanup skip:", e.message);
    }
  }
  // assembler intermediates (all regenerable)
  const build = path.join(RUNS_DIR, "assemble_build");
  try {
    if (fs.existsSync(build)) {
      for (const f of fs.readdirSync(build)) fs.rmSync(path.join(build, f), { recursive: true, force: true });
      console.log("[video] cleaned assemble_build intermediates");
    }
  } catch (e) {
    console.warn("[video] assemble_build cleanup skip:", e.message);
  }
}

// ── One full video cycle ───────────────────────────────────────────────────
async function runOnce({ notify } = {}) {
  if (state.running) return { skipped: "already running" };
  state.running = true;
  state.lastError = null;
  const name = "vm_" + Math.floor(Date.now() % 1000000);
  let stage = "starting up";
  try {
    // 1. create the video (python orchestrator: script -> Higgs voice -> clips -> assemble)
    stage = "generating the video (script → voice → clips → assembly)";
    const nt = nextTopic();
    const topic = nt.topic;
    const category = nt.category;
    const seed = Math.floor(Math.random() * 100000);
    await py([
      path.join("tools", "_video_run.py"),
      "--generate", "--topic", topic, "--name", name, "--seed", String(seed),
    ]);

    // 2. read run manifest + QA
    stage = "quality-checking the video";
    const runPath = path.join(RUNS_DIR, name + "_run.json");
    const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
    run.topic = topic;
    run.category = category;
    const mp4 = run.output;
    if (!mp4 || !fs.existsSync(mp4)) throw new Error("assembled mp4 missing");
    const sizeMb = fs.statSync(mp4).size / 1048576;
    if (sizeMb < 0.5) throw new Error(`suspiciously small mp4 (${sizeMb.toFixed(2)}MB)`);
    const wc = (run.script || "").split(/\s+/).filter(Boolean).length;
    if (wc < 40) throw new Error(`script too short (${wc} words)`);

    // 3. upload (YouTube API via youtube.js exports) + auto playlist by CATEGORY
    stage = "uploading the video to YouTube";
    const youtube = require("./youtube.js");
    const { ensureTopicPlaylist, addVideoToPlaylist } = require("./playlists.js");
    const { buildTitle, buildDescription } = require("./metadata.js");
    const token = await youtube.refreshAccess();
    // Put the actual TOPIC in the title so every Short is clearly labeled on
    // YouTube (previously all were just "Victor Moore #tags" -> looked unlabeled).
    const baseTitle = topic ? `${topic} | Victor Moore` : "Victor Moore";
    const title = buildTitle(baseTitle, null, null);
    const description = buildDescription({
      script: run.script, baseTitle, mood: run.mood || "reflection",
      mode: run.mode || "clean", seed: run.seed || seed,
    });
    const tags = title.match(/#\w+/g) || ["#shorts"];
    const uploaded = await youtube.uploadVideo(mp4, { title, description, tags, privacyStatus: "public" });
    let playlistId = null;
    try {
      stage = "adding the video to its playlist";
      playlistId = await ensureTopicPlaylist(token, category);
      await addVideoToPlaylist(token, playlistId, uploaded.videoId);
    } catch (pe) {
      // playlist failure should not fail the whole post (video is already live)
      console.warn("[video] playlist add failed (video is live):", pe.message);
    }

    // 3b. push the SAME Short to TikTok + Facebook (secondary platforms, non-fatal)
    stage = "posting to TikTok and Facebook";
    const platforms = await postToSecondaryPlatforms(mp4, { title, description });
    for (const p of platforms) {
      console.log(`[video] ${p.platform}:`, p.success ? (p.publishId || p.postId || "posted") : (p.skipped ? `skipped (${p.reason})` : `FAILED: ${p.error}`));
    }

    // 4. record + state
    const post = {
      at: new Date().toISOString(),
      title,
      url: uploaded.url,
      videoId: uploaded.videoId,
      topic,
      category,
      playlistId,
      script: run.script,
      sizeMb: Math.round(sizeMb * 10) / 10,
      platforms: platforms.reduce((acc, p) => { acc[p.platform] = p; return acc; }, {}),
    };
    const posts = loadPosts();
    posts.push(post);
    savePosts(posts);
    state.lastPost = post;
    state.consecutiveFailures = 0;
    bumpRotation(); // advance the 3-pillar rotation for the next post
    // Upload is done + recorded — remove the created video/audio/temp files.
    cleanupRunFiles(name, run);
    const platLines = platforms
      .filter((p) => !p.skipped)
      .map((p) => (p.success ? `✅ ${p.platform}` : `⚠️ ${p.platform} failed`));
    const platSummary = platLines.length ? `\n${platLines.join(" · ")}` : "";
    if (notify) notify(`🎬 *New Short live* — ${title}\n${uploaded.url}\nCategory: ${category}\nTopic: ${topic}${platSummary}`);
    return post;
  } catch (err) {
    state.lastError = { at: new Date().toISOString(), stage, message: err.message };
    state.consecutiveFailures += 1;
    const tried = TRIED[stage] || "ran the video pipeline";
    const lines = [
      `Hey, the *video workflow* is down 😔`,
      ``,
      `*Issue:* ${err.message || "unknown"}`,
      `*Stage:* ${stage}`,
      `*What I tried that didn't work:* ${tried} — it failed at the "${stage}" step.`,
    ];
    if (state.consecutiveFailures > 1) lines.push(``, `This is failure #${state.consecutiveFailures} in a row.`);
    if (notify) notify(lines.join("\n"));
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
