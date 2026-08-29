// ForChi V10 daily pipeline — the "won't-fail" end-to-end orchestrator for the
// FIRST ORIGINAL 10-min video. One run per day.
//
// Stages (each resume-safe + self-healing, in order):
//   script    -> v10ScriptGen (theme rotation, search-grounded, 4-act) -> manifest.json + meta.json
//   voice     -> Higgs "Victor Moore (clean)" per scene + tighten pauses  -> voice/rXX.wav
//   images    -> ZeroGPU img Space per scene (consistent char + framing)   -> images/rep_XX_01.png
//   assemble  -> repl assembler (exact-sync, plan-free 1-frame/scene, no overlays) -> temp_media/v10_<runId>.mp4
//   thumb     -> v10 thumbnail (frame + title band) -> thumb.jpg
//   upload    -> YouTube (category 27, US location, timestamped desc, 3 hashtags, no #Shorts) + setThumbnail
//
// State: temp_media/v10_run/<runId>/state.json  (per-stage status, resume-safe).
// CLI: node src/workflows/video/v10Pipeline.js [--dry-run] [--theme "X"] [--notify-only]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const RUNS_DIR = path.join(BASE, "temp_media", "v10_run");
const VENV_PY = process.platform === "win32"
  ? path.join(BASE, ".venv", "Scripts", "python.exe")
  : path.join(BASE, ".venv", "bin", "python");
const FF = (() => {
  const cand = path.join(BASE, ".venv", "Lib", "site-packages", "imageio_ffmpeg", "binaries");
  try { for (const f of fs.readdirSync(cand)) if (/^ffmpeg-.*\.exe$/.test(f)) return path.join(cand, f); } catch {}
  return "ffmpeg";
})();
const US_LOCATION = { lat: 40.7128, lon: -74.0060 }; // default US (configurable)

const STAGES = ["script", "design", "voice", "images", "assemble", "thumb", "upload"];

function loadState(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } }
function saveState(p, s) { try { fs.writeFileSync(p, JSON.stringify(s, null, 2)); } catch {} }
function stageDone(s, st) { return s.stages && s.stages[st] && s.stages[st].status === "done"; }

function probeDur(p) {
  const r = execFileSync(FF, ["-i", p], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  const m = (r || "").match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

function py(args) {
  execFileSync(VENV_PY, args, { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

async function runOnce({ runId, theme, dryRun = false, buildOnly = false, notify, limit = 0 } = {}) {
  const rid = runId || "run_" + Date.now().toString(36);
  const runDir = path.join(RUNS_DIR, rid);
  fs.mkdirSync(runDir, { recursive: true });
  const statePath = path.join(runDir, "state.json");
  const state = loadState(statePath);
  state.stages = state.stages || {};
  state.runId = rid;
  const manifestPath = path.join(runDir, "manifest.json");
  const metaPath = path.join(runDir, "meta.json");
  const voiceDir = path.join(runDir, "voice");
  const imagesDir = path.join(runDir, "images");
  const mp4 = path.join(BASE, "temp_media", "v10_" + rid + ".mp4");
  const thumb = path.join(runDir, "thumb.jpg");

  const retries = { script: 3, design: 3, voice: 3, images: 5, assemble: 3, thumb: 3, upload: 4 };

  const out = { runId: rid, runDir, stages: {} };

  for (const stage of STAGES) {
    if (stageDone(state, stage)) { console.log(`[v10] ${stage}: already done (resume)`); out.stages[stage] = { status: "done", resumed: true }; continue; }
    let attempt = 0, lastErr = null, ok = false;
    while (attempt < retries[stage]) {
      attempt++;
      try {
        console.log(`[v10] === ${stage} (attempt ${attempt}) ===`);
        if (stage === "script") {
          const { generate } = require("./v10ScriptGen.js");
          await generate({ theme, outDir: runDir });
          if (limit > 0) { // truncate scenes for fast tests
            const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            m.scenes = m.scenes.slice(0, limit);
            fs.writeFileSync(manifestPath, JSON.stringify(m, null, 1));
          }
        } else if (stage === "design") {
          // SCENE DESIGNER: a Google image model turns each scene's setting/characters/action/frames
          // into final per-frame image prompts (stable background + 3 camera/object variations) and
          // splits narration into 3 chunks. Rewrites manifest.json into the pipeline shots format.
          if (!dryRun) { /* design uses text-only API; runs the same whether dry-run or not */ }
          py(["tools/_v10_scene_designer.py", runDir]);
          const dManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          const shotCount = (dManifest.scenes || []).reduce((a, s) => a + (s.shots || []).length, 0);
          console.log(`[v10] design: ${(dManifest.scenes || []).length} scenes, ${shotCount} shots`);
        } else if (stage === "voice") {
          // PRIMARY (2026-08-29): Contabo CPU F5-TTS worker (off ZeroGPU).
          // FALLBACK: Higgs (ZeroGPU) then edge-tts.
          const limArgs = limit > 0 ? ["--limit", String(limit)] : [];
          const voiceBackend = (process.env.V10_VOICE_BACKEND || "contabo").toLowerCase();
          if (voiceBackend === "contabo") {
            try {
              py(["tools/_v10_contabo_voice.py", manifestPath, voiceDir]);
              const wavs = fs.existsSync(voiceDir) ? fs.readdirSync(voiceDir).filter((f) => /^r\d\d\.wav$/.test(f) && fs.statSync(path.join(voiceDir, f)).size > 0) : [];
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
              const needScenes = manifest.scenes.length;
              if (wavs.length >= Math.min(needScenes, limit ? needScenes : needScenes)) {
                console.log(`[v10] voice: Contabo rendered ${wavs.length} scenes`);
                py(["temp_media/_tighten_voice.py", "--dir", voiceDir]);
              } else {
                throw new Error(`Contabo gave ${wavs.length}/${needScenes} wavs`);
              }
            } catch (e) {
              console.warn(`[v10] voice: Contabo failed (${e.message}) — falling back to Higgs`);
              py(["tools/_v10_repl_voice.py", "--clone", "--manifest", manifestPath, "--out", voiceDir, ...limArgs]);
              py(["temp_media/_tighten_voice.py", "--dir", voiceDir]);
            }
          } else {
            py(["tools/_v10_repl_voice.py", "--clone", "--manifest", manifestPath, "--out", voiceDir, ...limArgs]);
            py(["temp_media/_tighten_voice.py", "--dir", voiceDir]);
          }
        } else if (stage === "images") {
          // PRIMARY (2026-08-29): Google Vertex AI gemini-2.5-flash-image via
          // image_generator.py (service-account creds, off ZeroGPU, ~8s/image).
          // FALLBACK: if Vertex produces too few frames, retry with the Agent Platform
          // Gemini batch (Qwen-Image-Edit as last resort).
          const limArgs = limit > 0 ? ["--limit", String(limit)] : [];
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          const needShots = (manifest.scenes || []).reduce((a, s) => a + (s.shots || []).length, 0);
          let files = [];
          try {
            py(["image_generator.py", "--manifest", manifestPath, "--images", imagesDir, ...limArgs]);
            files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
          } catch (e) { console.warn(`[v10] images: Vertex path failed (${e.message}) — falling back to Gemini batch`); }
          if (files.length < needShots) {
            console.warn(`[v10] images: Vertex gave ${files.length}/${needShots} — falling back to Gemini/Qwen batch`);
            py(["tools/_v10_gemini_qwen_batch.py", "--manifest", manifestPath, "--images", imagesDir, ...limArgs]);
            files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
          }
          const need = needShots || manifest.scenes.length;
          if (files.length < need) throw new Error(`images: only ${files.length}/${need} frames generated`);
          console.log(`[v10] images: ${files.length} frames present (${needShots} shots required)`);
        } else if (stage === "assemble") {
          py(["tools/_v10_repl_assemble.py", "v10_" + rid, "--manifest", manifestPath, "--images", imagesDir, "--wavs", voiceDir, "--no-overlays", "--to-downloads", "--sfx"]);
          if (!fs.existsSync(mp4) || fs.statSync(mp4).size < 500000) throw new Error("assemble output missing/too small");
        } else if (stage === "thumb") {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          py(["tools/_v10_thumbnail.py", mp4, "--title", (meta.title || "").slice(0, 60), "--out", thumb, "--at", "30"]);
        } else if (stage === "upload") {
          if (dryRun || buildOnly) {
            console.log(`[v10] ${dryRun ? "dry-run" : "build-only"}: skipping upload`);
            state.stages[stage] = { status: "done", skip: true, at: Date.now() };
            saveState(statePath, state);
            out.stages[stage] = { status: "done", skip: true };
            ok = true;
          } else { await uploadStage(runDir, mp4, thumb, rid); }
        }
        state.stages[stage] = { status: "done", attempt, at: Date.now() };
        saveState(statePath, state);
        out.stages[stage] = { status: "done", attempt };
        ok = true;
        break;
      } catch (e) {
        lastErr = e.message;
        state.stages[stage] = { status: "failed", attempt, error: e.message, at: Date.now() };
        saveState(statePath, state);
        console.warn(`[v10] ${stage} attempt ${attempt} failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, 15000 * attempt));
      }
    }
    if (!ok) {
      out.stages[stage] = { status: "failed", error: lastErr };
      if (notify) { try { notify(`⚠️ V10 pipeline failed at "${stage}": ${lastErr}`); } catch {} }
      return out; // stop — don't spam the rest
    }
  }

  if (notify) { try { notify(`✅ V10 daily video posted (${rid})`); } catch {} }
  console.log(`[v10] pipeline complete -> ${mp4}`);
  return out;
}

async function uploadStage(runDir, mp4, thumb, rid) {
  const fsr = require("fs");
  const { uploadVideo, setThumbnail } = require("./youtube.js");
  const v10 = require("./v10Metadata.js");
  const manifest = JSON.parse(fsr.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
  const meta = JSON.parse(fsr.readFileSync(path.join(runDir, "meta.json"), "utf8"));

  // chapter timeline: cumulative wav durations
  const voiceDir = path.join(runDir, "voice");
  let t = 0; const timeline = [];
  for (let i = 0; i < manifest.scenes.length; i++) {
    const sc = i + 1;
    const wav = path.join(voiceDir, `r${String(sc).padStart(2, "0")}.wav`);
    const dur = fsr.existsSync(wav) ? probeDur(wav) : 0;
    const label = manifest.scenes[i].label || `Part ${i + 1}`;
    timeline.push({ label, startSec: t, endSec: t + dur });
    t += dur;
  }
  const chapters = v10.buildChapters(timeline);

  const baseTitle = meta.title || "ForChi Story";
  const title = v10.buildV10Title(baseTitle);
  const description = v10.buildV10Description({ baseTitle, chapters, script: meta.script, seed: Date.now() % 100000 });

  const cat = process.env.V10_CATEGORY_ID || "27";
  const loc = process.env.V10_LOCATION ? (() => { const [la, lo] = process.env.V10_LOCATION.split(","); return { lat: +la, lon: +lo }; })() : US_LOCATION;

  console.log("[v10] uploading:", title);
  const result = await uploadVideo(mp4, {
    title, description, tags: title.match(/#\w+/g) || [],
    privacyStatus: "public", categoryId: cat, location: loc, addShortsTag: false,
  });
  console.log("[v10] uploaded:", result.url);
  if (thumb && fsr.existsSync(thumb)) {
    try { await setThumbnail(result.videoId, thumb); console.log("[v10] thumbnail set"); } catch (e) { console.warn("[v10] thumb set failed:", e.message); }
  }
  // record post
  const postsFile = path.join(BASE, "temp_media", "v10_posts.json");
  let posts = []; try { posts = JSON.parse(fsr.readFileSync(postsFile, "utf8")); } catch {}
  posts.push({ runId: rid, videoId: result.videoId, url: result.url, title, at: Date.now() });
  fsr.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
  return result;
}

// Publish a PRE-BUILT run (the 2pm phase of the daily schedule): loads the run's
// manifest/meta/mp4/thumb and uploads it to YouTube. Requires the YouTube token.
async function publishRun(runId, { notify } = {}) {
  const runDir = path.join(RUNS_DIR, runId);
  const mp4 = path.join(BASE, "temp_media", "v10_" + runId + ".mp4");
  const thumb = path.join(runDir, "thumb.jpg");
  if (!fs.existsSync(mp4)) throw new Error("no built video for run " + runId);
  console.log("[v10] publishing pre-built run:", runId);
  const res = await uploadStage(runDir, mp4, thumb, runId);
  if (notify) { try { notify(`✅ V10 published: ${res.url}`); } catch {} }
  return res;
}

module.exports = { runOnce, publishRun, STAGES };

if (require.main === module) {
  const dry = process.argv.includes("--dry-run");
  const buildOnly = process.argv.includes("--build-only");
  const pubIdx = process.argv.indexOf("--publish");
  const publishId = pubIdx >= 0 ? process.argv[pubIdx + 1] : null;
  const themeIdx = process.argv.indexOf("--theme");
  const theme = themeIdx >= 0 ? process.argv[themeIdx + 1] : null;
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(process.argv[limIdx + 1], 10) || 0 : 0;
  const ridIdx = process.argv.indexOf("--runid");
  const runId = ridIdx >= 0 ? process.argv[ridIdx + 1] : undefined;
  if (publishId) {
    publishRun(publishId).then((res) => {
      console.log("[v10] published:", res.url);
    }).catch((e) => { console.error("[v10] publish FATAL", e.message); process.exit(1); });
  } else {
    runOnce({ dryRun: dry, buildOnly, theme, limit, runId }).then((r) => {
      console.log("[v10] done:", JSON.stringify(r.stages, null, 1));
      if (Object.values(r.stages).some((s) => s.status === "failed")) process.exitCode = 1;
    }).catch((e) => { console.error("[v10] FATAL", e.message); process.exit(1); });
  }
}
