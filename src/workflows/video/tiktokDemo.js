// ForChi TikTok review demo — a clean camera-friendly web page + API endpoints
// that demonstrate the TikTok for Developers integration (Content Posting API).
//
// Routes served by bot.js:
//   GET  /tiktok                -> the demo page (record this for the review)
//   GET  /api/tiktok/status     -> { connected, hasToken, disabled }
//   POST /api/tiktok/post       -> generates a fresh Short and posts it to TikTok
//
// The page shows: brand, connection status, a "Connect TikTok" button (OAuth
// consent -> user.info.basic + video.publish scopes), and a "Post Test Video"
// button that runs the real pipeline and uploads via the Content Posting API.
// This is exactly what the TikTok review video needs to demonstrate.
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const VENV_PY = process.platform === "win32"
  ? path.join(BASE, ".venv", "Scripts", "python.exe")
  : path.join(BASE, ".venv", "bin", "python");

// ── The demo page (self-contained HTML, no external assets) ─────────────────
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ForChi — TikTok Integration</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
         min-height: 100vh; color: #fff; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 520px; width: 100%; background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15); border-radius: 20px; padding: 36px 32px;
          backdrop-filter: blur(10px); box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
  h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 4px; }
  .brand { color: #69f0ae; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  p.sub { color: rgba(255,255,255,0.7); font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
  .status { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.25);
            border-radius: 12px; padding: 14px 16px; margin-bottom: 20px; font-size: 15px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #ffb300; flex-shrink: 0; }
  .dot.ok { background: #4caf50; }
  .dot.no { background: #f44336; }
  .btn { width: 100%; border: none; border-radius: 12px; padding: 16px; font-size: 16px; font-weight: 600;
         cursor: pointer; margin-top: 12px; transition: transform .1s, opacity .2s; color: #fff; }
  .btn:hover { transform: translateY(-1px); opacity: .92; }
  .btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
  .btn.connect { background: linear-gradient(135deg, #25f4ee, #fe2c55); }
  .btn.post { background: linear-gradient(135deg, #69f0ae, #00b0ff); }
  .btn:first-of-type { margin-top: 0; }
  #log { margin-top: 20px; background: rgba(0,0,0,0.35); border-radius: 12px; padding: 14px 16px;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.6;
         min-height: 60px; white-space: pre-wrap; word-break: break-word; color: #a5d6ff; display: none; }
  .ok-text { color: #69f0ae; } .bad-text { color: #ff8a80; }
  a { color: #80d8ff; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">ForChi · AI Content Studio</div>
    <h1>TikTok Integration</h1>
    <p class="sub">Connect your TikTok account and publish Shorts automatically via the TikTok for Developers Content Posting API.</p>

    <div class="status"><span class="dot" id="dot"></span><span id="statustext">Checking connection…</span></div>

    <button class="btn connect" id="connectBtn" onclick="connect()">Connect TikTok</button>
    <button class="btn post" id="postBtn" onclick="postVideo()" disabled>Post Test Video</button>

    <div id="log"></div>
  </div>

<script>
async function refreshStatus() {
  try {
    const r = await fetch('/api/tiktok/status');
    const d = await r.json();
    const dot = document.getElementById('dot');
    const txt = document.getElementById('statustext');
    const postBtn = document.getElementById('postBtn');
    if (d.disabled) { dot.className='dot no'; txt.textContent='TikTok posting is disabled in config.'; }
    else if (d.hasToken) { dot.className='dot ok'; txt.textContent='Connected — ready to post to TikTok.'; postBtn.disabled=false; }
    else { dot.className='dot no'; txt.textContent='Not connected yet. Click "Connect TikTok" to authorize.'; }
  } catch(e) { document.getElementById('statustext').textContent='Could not reach server.'; }
}
function log(msg, cls) {
  const el = document.getElementById('log');
  el.style.display = 'block';
  el.innerHTML += '<div class="' + (cls||'') + '">' + msg + '</div>';
}
async function connect() {
  const r = await fetch('/api/tiktok/status');
  const d = await r.json();
  if (d.consentUrl) window.location.href = d.consentUrl;
  else log('No consent URL — check TIKTOK_CLIENT_KEY / TIKTOK_CALLBACK_URL.', 'bad-text');
}
async function postVideo() {
  const btn = document.getElementById('postBtn');
  btn.disabled = true;
  log('▶ Generating a fresh Short, then posting to TikTok…');
  try {
    const r = await fetch('/api/tiktok/post', { method: 'POST' });
    const d = await r.json();
    if (d.ok) { log('✅ ' + d.message, 'ok-text'); if (d.publishId) log('Publish ID: ' + d.publishId); if (d.tiktokUrl) log('View: <a target="_blank" href="' + d.tiktokUrl + '">' + d.tiktokUrl + '</a>'); }
    else log('❌ ' + (d.message || 'post failed'), 'bad-text');
  } catch(e) { log('❌ ' + e, 'bad-text'); }
  btn.disabled = false;
  refreshStatus();
}
refreshStatus();
</script>
</body>
</html>`;

// ── API handlers ────────────────────────────────────────────────────────────
async function statusHandler() {
  const ts = require("./tokenStore.js");
  const hasToken = !!(process.env.TIKTOK_ACCESS_TOKEN || (await ts.getTikTokToken().catch(() => null)));
  const tiktok = require("./tiktok.js");
  return {
    connected: hasToken,
    hasToken,
    disabled: process.env.TIKTOK_DISABLED === "true",
    consentUrl: tiktok.consentUrl(),
  };
}

function py(args, timeoutMs = 25 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(VENV_PY, args, { cwd: BASE, timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message || "").trim().split("\n").filter(Boolean).pop() || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

// Generate a fresh Short and post it ONLY to TikTok (focused Content Posting API demo).
// Uses a FAST no-voice ~10s clip video (1-2 clips) instead of the full script+voice
// pipeline, so the demo post is quick and reliable for the review video.
async function postHandler() {
  const ts = require("./tokenStore.js");
  const hasToken = !!(process.env.TIKTOK_ACCESS_TOKEN || (await ts.getTikTokToken().catch(() => null)));
  if (!hasToken) return { ok: false, message: "TikTok not connected. Click Connect TikTok first." };
  if (process.env.TIKTOK_DISABLED === "true") return { ok: false, message: "TikTok posting is disabled (TIKTOK_DISABLED=true)." };

  const name = "ttdemo_" + Math.floor(Date.now() % 1000000);
  let mp4 = path.join(BASE, "temp_media", name + ".mp4");
  try {
    // 1. Build a fast no-voice ~10s Short from 1-2 clips (no script/voice needed)
    await py([path.join("tools", "_video_ttdemo.py"), name]);
    if (!fs.existsSync(mp4)) return { ok: false, message: "video not produced (check clip library on server)." };

    // 2. Post to TikTok via the Content Posting API
    const tiktok = require("./tiktok.js");
    const title = "Victor Moore — a short reflection #shorts #poetry";
    const result = await tiktok.uploadVideo(mp4, { title, description: title });
    return {
      ok: true,
      message: "Published to TikTok (Content Posting API).",
      publishId: result.publishId || result.publish_id,
      tiktokUrl: result.url || "",
    };
  } catch (e) {
    return { ok: false, message: String(e.message || e).slice(0, 300) };
  } finally {
    // cleanup the generated artifacts
    try { if (fs.existsSync(mp4)) fs.unlinkSync(mp4); } catch {}
    try { if (fs.existsSync(path.join(BASE, "temp_media", name + ".mp3"))) fs.unlinkSync(path.join(BASE, "temp_media", name + ".mp3")); } catch {}
    const build = path.join(BASE, "temp_media", name + "_ttbuild");
    try { if (fs.existsSync(build)) fs.rmSync(build, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { PAGE, statusHandler, postHandler };
