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
  // ffmpeg -i <file> with no output exits 1 but prints Duration on stderr.
  // Catch the expected failure and parse the duration out of stderr.
  let r = "";
  try {
    r = execFileSync(FF, ["-i", p], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    r = String((e && e.stderr) || "");
  }
  const m = (r || "").match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

// Build an SRT caption file from the manifest + narration wavs so deaf viewers
// can read what the narrator is saying. Each scene's wav duration is distributed
// across its shots proportionally to shot word count (matches the assembler sync).
function buildSrt(manifest, voiceDir) {
  const scenes = (manifest && manifest.scenes) || [];
  const fmt = (sec) => {
    sec = Math.max(0, sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60), ms = Math.floor((sec % 1) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };
  const out = [];
  let idx = 1, t = 0;
  for (const sc of scenes) {
    const scn = sc.n || (out.length ? scenes.indexOf(sc) + 1 : 1);
    const wav = path.join(voiceDir, `r${String(scn).padStart(2, "0")}.wav`);
    const dur = fs.existsSync(wav) ? probeDur(wav) : 0;
    const shots = sc.shots || [];
    const totalWords = shots.reduce((a, sh) => a + String(sh.text || "").split(/\s+/).filter(Boolean).length, 0) || 1;
    let acc = 0;
    for (const sh of shots) {
      const text = String(sh.text || "").trim();
      if (!text) continue;
      const w = text.split(/\s+/).length;
      const d = dur * (w / totalWords);
      out.push(`${idx++}\n${fmt(t + acc)} --> ${fmt(t + acc + d)}\n${text}\n`);
      acc += d;
    }
    t += dur;
  }
  return out.join("\n");
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
          // PRIMARY (2026-08-31, user directive): Higgs TTS on Hugging Face
          // (ZeroGPU) — GPU, much faster than the Contabo CPU F5-TTS worker.
          // FALLBACK: Contabo CPU F5-TTS worker (off ZeroGPU).
          // Set V10_VOICE_BACKEND=contabo to force Contabo-first (manual override).
          const limArgs = limit > 0 ? ["--limit", String(limit)] : [];
          const voiceBackend = (process.env.V10_VOICE_BACKEND || "higgs").toLowerCase();
          const onVps = process.platform !== "win32";
          const contaboCmd = onVps
            ? ["tools/_v10_local_voice.py", manifestPath, voiceDir]
            : ["tools/_v10_contabo_voice.py", manifestPath, voiceDir];
          const wavCount = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^r\d\d\.wav$/.test(f) && fs.statSync(path.join(d, f)).size > 0).length : 0);
          const needScenes = JSON.parse(fs.readFileSync(manifestPath, "utf8")).scenes.length;
          if (voiceBackend === "contabo") {
            // Forced Contabo-first (manual override); Higgs as fallback.
            try {
              py(contaboCmd);
              if (wavCount(voiceDir) < needScenes) throw new Error(`Contabo gave ${wavCount(voiceDir)}/${needScenes} wavs`);
              console.log(`[v10] voice: Contabo rendered ${wavCount(voiceDir)} scenes`);
              py(["tools/_v10_tighten_voice.py", "--dir", voiceDir]);
            } catch (e) {
              console.warn(`[v10] voice: Contabo failed (${e.message}) — falling back to Higgs`);
              py(["tools/_v10_repl_voice.py", "--clone", "--manifest", manifestPath, "--out", voiceDir, ...limArgs]);
              py(["tools/_v10_tighten_voice.py", "--dir", voiceDir]);
            }
          } else {
            // HIGGS-FIRST (default): HF ZeroGPU, fast. USER DIRECTIVE (2026-09-01):
            // the voice must NEVER change mid-video. Higgs is resume-safe (it only
            // renders the missing scenes on re-runs), so we RETRY Higgs up to 3x to
            // fill every scene with the SAME "Victor Moore (clean)" voice. Only if
            // Higgs still cannot produce a scene do we fall back to Contabo CPU —
            // and even then the missing scenes keep the primary renderer's output
            // for the scenes that already succeeded.
            let higgsOk = false;
            for (let vp = 1; vp <= 3 && !higgsOk; vp++) {
              try {
                py(["tools/_v10_repl_voice.py", "--clone", "--manifest", manifestPath, "--out", voiceDir, ...limArgs]);
                const got = wavCount(voiceDir);
                if (got >= needScenes) { higgsOk = true; console.log(`[v10] voice: Higgs rendered ${got}/${needScenes} scenes`); }
                else {
                  console.warn(`[v10] voice: Higgs pass ${vp} gave ${got}/${needScenes} — retrying missing scenes (same voice)`);
                  await new Promise((r) => setTimeout(r, 20000 * vp));
                }
              } catch (e) {
                console.warn(`[v10] voice: Higgs pass ${vp} failed (${e.message})`);
                await new Promise((r) => setTimeout(r, 20000 * vp));
              }
            }
            if (!higgsOk) {
              const missing = needScenes - wavCount(voiceDir);
              console.warn(`[v10] voice: Higgs incomplete (${missing} scenes short) — Contabo fills ONLY the missing scenes`);
              py(contaboCmd);
            }
            if (wavCount(voiceDir) < needScenes) throw new Error(`voice: only ${wavCount(voiceDir)}/${needScenes} scenes rendered`);
            py(["tools/_v10_tighten_voice.py", "--dir", voiceDir]);
          }
        } else if (stage === "images") {
          // PRIMARY (2026-08-29): Google Vertex AI gemini-2.5-flash-image via
          // image_generator.py (service-account creds, off ZeroGPU, ~8s/image).
          // SELF-HEALING (2026-08-30): Vertex is rate-limited (HTTP 429) so the
          // first pass can come up short. image_generator.py is resume-safe AND
          // has a global rate-gate now, so RETRY Vertex (it only generates the
          // missing frames on re-runs) before ever touching the $300-credit
          // Gemini/Qwen fallback. The expensive fallback only runs if Vertex
          // fails hard (produces <50% frames) AND V10_IMG_FALLBACK != "off".
          const limArgs = limit > 0 ? ["--limit", String(limit)] : [];
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          const needShots = (manifest.scenes || []).reduce((a, s) => a + (s.shots || []).length, 0);
          let files = [];
          let vertexOk = false;
          for (let vpass = 1; vpass <= 3 && !vertexOk; vpass++) {
            try {
              py(["image_generator.py", "--manifest", manifestPath, "--images", imagesDir, ...limArgs]);
              files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
            } catch (e) { console.warn(`[v10] images: Vertex pass ${vpass} failed (${e.message})`); }
            if (files.length >= needShots) { vertexOk = true; break; }
            if (vpass < 3) {
              const pct = Math.round(100 * files.length / Math.max(1, needShots));
              console.warn(`[v10] images: Vertex pass ${vpass} gave ${files.length}/${needShots} (${pct}%) — retrying missing frames`);
              await new Promise((r) => setTimeout(r, 20000 * vpass)); // let the rate gate cool down
            }
          }
          const allowFallback = (process.env.V10_IMG_FALLBACK || "on").toLowerCase() !== "off";
          if (!vertexOk && files.length < needShots && allowFallback && files.length >= needShots * 0.5) {
            // Partial but meaningful: try Vertex once more after a longer pause
            // (rate window) before spending the paid fallback.
            console.warn(`[v10] images: Vertex still short (${files.length}/${needShots}) — one more Vertex fill`);
            await new Promise((r) => setTimeout(r, 60000));
            try {
              py(["image_generator.py", "--manifest", manifestPath, "--images", imagesDir, ...limArgs]);
              files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
            } catch (e) { console.warn(`[v10] images: final Vertex fill failed (${e.message})`); }
          }
          if (files.length < needShots && allowFallback) {
            console.warn(`[v10] images: Vertex gave ${files.length}/${needShots} — falling back to Gemini/Qwen batch`);
            py(["tools/_v10_gemini_qwen_batch.py", "--manifest", manifestPath, "--images", imagesDir, ...limArgs]);
            files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
          }
          // TRUNCATION GUARD (2026-09-01): guarantee EVERY scene has >=1 frame so
          // the assembler never drops a scene — a dropped final scene means the
          // video's last sentences vanish. Fill any fully-missing scene with the
          // nearest available frame (visual continuity beats an abrupt cut).
          const fillManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          const nScenes = (fillManifest.scenes || []).length;
          let prevImg = null;
          for (let sc = 1; sc <= nScenes; sc++) {
            let got = null;
            for (let j = 1; j <= 9; j++) {
              const p = path.join(imagesDir, `rep_${String(sc).padStart(2, "0")}_${String(j).padStart(2, "0")}.png`);
              if (fs.existsSync(p) && fs.statSync(p).size > 0) { got = p; break; }
            }
            if (got) { prevImg = got; continue; }
            if (prevImg) {
              const dest = path.join(imagesDir, `rep_${String(sc).padStart(2, "0")}_01.png`);
              fs.copyFileSync(prevImg, dest);
              console.warn(`[v10] images: scene ${sc} missing frames — filled from scene ${sc - 1} (keeps final sentences in the video)`);
            } else {
              console.warn(`[v10] images: scene ${sc} missing frames and no prior frame to copy`);
            }
          }
          files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
          // TRUNCATION GUARD (2026-09-01): guarantee EVERY scene has at least one
          // frame so the assembler never drops a scene from BOTH video and audio
          // (a dropped FINAL scene = the last sentences vanish from the video).
          // Fill any scene that came up empty with the nearest available frame;
          // the assembler reuses that frame for the scene's missing shots.
          {
            const m2 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const nScenes = (m2.scenes || []).length;
            let prevImg = null;
            for (let sc = 1; sc <= nScenes; sc++) {
              let got = null;
              for (let j = 1; j <= 9; j++) {
                const p = path.join(imagesDir, `rep_${String(sc).padStart(2, "0")}_${String(j).padStart(2, "0")}.png`);
                if (fs.existsSync(p) && fs.statSync(p).size > 0) { got = p; break; }
              }
              if (got) { prevImg = got; continue; }
              if (prevImg) {
                const dest = path.join(imagesDir, `rep_${String(sc).padStart(2, "0")}_01.png`);
                fs.copyFileSync(prevImg, dest);
                console.warn(`[v10] images: scene ${sc} missing frames — filled from scene ${sc - 1} (keeps final sentences in video)`);
              } else {
                console.warn(`[v10] images: scene ${sc} missing frames and no prior frame to copy — will fail the check`);
              }
            }
            files = fs.readdirSync(imagesDir).filter((f) => /^rep_.*\.png$/.test(f) && fs.statSync(path.join(imagesDir, f)).size > 0);
          }
          // Every scene must be representable (>=1 frame). Missing shots within a
          // scene are fine — the assembler reuses the scene's available frame.
          {
            const m3 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const zeroScenes = [];
            for (let sc = 1; sc <= (m3.scenes || []).length; sc++) {
              const has = files.some((f) => f.startsWith(`rep_${String(sc).padStart(2, "0")}_`));
              if (!has) zeroScenes.push(sc);
            }
            if (zeroScenes.length) throw new Error(`images: scenes with zero frames (would truncate video): ${zeroScenes.join(", ")}`);
          }
          console.log(`[v10] images: ${files.length} frames present (${needShots} shots required)`);
        } else if (stage === "assemble") {
          // USER DIRECTIVE (2026-09-01): burn subtitles INTO the video (bottom
          // captions synced to each shot) + the curiosity-gap "WHY" hook over
          // the opening seconds — every video ships with visible captions that
          // carry the "why", not just an optional YouTube caption track.
          const v10m = require("./v10Metadata.js");
          const metaForHook = JSON.parse(fs.existsSync(metaPath) ? fs.readFileSync(metaPath, "utf8") : "{}");
          const hookTitle = v10m.buildV10CuriosityTitle(metaForHook.title || "", metaForHook);
          // --to-downloads is a Windows-dev convenience only (copies to ~/Downloads);
          // on the VPS that dir may not exist, so skip it to avoid a post-write crash.
          const dlArg = process.platform === "win32" ? ["--to-downloads"] : [];
          py(["tools/_v10_repl_assemble.py", "v10_" + rid, "--manifest", manifestPath, "--images", imagesDir, "--wavs", voiceDir, "--subtitles", "--hook", hookTitle.slice(0, 90), "--no-kenburns", ...dlArg, "--sfx"]);
          if (!fs.existsSync(mp4) || fs.statSync(mp4).size < 500000) throw new Error("assemble output missing/too small");
          // TRUNCATION GUARD (2026-09-01): the video must not be shorter than the
          // narration (dropped final scene = missing last sentences). Compare the
          // assembled duration to the total narration wav duration.
          const nTotal = fs.readdirSync(voiceDir)
            .filter((f) => /^r\d\d\.wav$/.test(f))
            .reduce((a, f) => a + probeDur(path.join(voiceDir, f)), 0);
          const vDur = probeDur(mp4);
          if (nTotal > 1 && vDur > 0 && vDur < nTotal * 0.90) {
            throw new Error(`assemble truncated: video ${vDur.toFixed(1)}s < narration ${nTotal.toFixed(1)}s`);
          }
        } else if (stage === "thumb") {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          // USER DIRECTIVE (2026-08-31): thumbnail carries the same curiosity-gap
          // "WHY" hook as the title — makes people want to click.
          const hookTitle = v10.buildV10CuriosityTitle(meta.title, meta);
          py(["tools/_v10_thumbnail.py", mp4, "--title", hookTitle.slice(0, 60), "--out", thumb, "--at", "30"]);
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
  // USER DIRECTIVE (2026-08-31): delete the video + build artifacts once published
  // (only when the upload stage actually ran — build-only keeps the mp4 for the publish phase).
  if (out.stages.upload && out.stages.upload.status === "done" && !out.stages.upload.skip) {
    cleanupRun(runDir, mp4);
  }
  return out;
}

async function uploadStage(runDir, mp4, thumb, rid) {
  const fsr = require("fs");
  const { uploadVideo, setThumbnail, uploadCaptions } = require("./youtube.js");
  const { postV10Video } = require("./facebookVideo.js");
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

  const baseTitle = v10.buildV10CuriosityTitle(meta.title, meta); // "WHY" curiosity-gap hook
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
  // captions for deaf viewers (per-scene SRT built from narration + wav timing)
  try {
    const srt = buildSrt(manifest, voiceDir);
    const srtPath = path.join(runDir, "captions.srt");
    fsr.writeFileSync(srtPath, srt);
    await uploadCaptions(result.videoId, srtPath);
    console.log("[v10] captions uploaded");
  } catch (e) { console.warn("[v10] captions failed:", e.message); }
  // V10 playlist: auto-sort into the topic category playlist (5 fixed playlists)
  try {
    const { ensureV10Playlist, addVideoToPlaylist } = require("./v10Playlists.js");
    const { refreshAccess } = require("./youtube.js");
    const token = await refreshAccess();
    // Prefer the category written by v10ScriptGen; else classify from topic/theme.
    const forced = meta.category ? { title: meta.category } : null;
    const pl = forced
      ? await (async () => {
          const { findOrCreatePlaylist } = require("./v10Playlists.js");
          return findOrCreatePlaylist(token, forced.title, `V10 long-form stories — ${forced.title}`);
        })()
      : await ensureV10Playlist(token, meta.topic, meta.theme);
    await addVideoToPlaylist(token, pl.playlistId, result.videoId);
    console.log(`[v10] added to playlist "${pl.title}" (${pl.playlistId})`);
  } catch (e) { console.warn("[v10] playlist add failed:", e.message); }
  // V10 Facebook page post (long-form video)
  try {
    const fbres = await postV10Video(mp4, { title, description: baseTitle });
    console.log("[v10] facebook posted:", fbres.url);
  } catch (e) { console.warn("[v10] facebook post failed:", e.message); }
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
  // USER DIRECTIVE (2026-08-31): delete the video + run once it has been published.
  cleanupRun(runDir, mp4);
  if (notify) { try { notify(`✅ V10 published: ${res.url}`); } catch {} }
  return res;
}

// Delete a published run's video + build artifacts (mp4, images, voice wavs, run dir)
// so we don't accumulate multi-GB files in temp_media after a video goes live.
function cleanupRun(runDir, mp4) {
  const fsr = require("fs");
  const dirSize = (d) => {
    let n = 0;
    try { for (const f of fsr.readdirSync(d)) { const p = path.join(d, f); n += fsr.statSync(p).isDirectory() ? dirSize(p) : fsr.statSync(p).size; } } catch {}
    return n;
  };
  let freed = 0;
  const del = (p) => {
    try {
      if (fsr.existsSync(p)) {
        freed += fsr.statSync(p).isDirectory() ? dirSize(p) : fsr.statSync(p).size;
        fsr.rmSync(p, { recursive: true, force: true });
        console.log("[v10] deleted", p);
      }
    } catch (e) { console.warn("[v10] cleanup failed:", p, e.message); }
  };
  del(mp4);
  del(runDir);
  if (freed) console.log(`[v10] cleanup done — freed ~${(freed / 1024 / 1024).toFixed(1)} MB`);
}

module.exports = { runOnce, publishRun, cleanupRun, STAGES };

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
