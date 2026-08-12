#!/usr/bin/env node
/**
 * Keep-alive ping script for the ForChi bot.
 *
 * Render's free tier sleeps a web service after ~15 minutes of HTTP inactivity.
 * Run this script on a schedule (every 5-10 minutes) to keep it awake.
 *
 * Usage:
 *   node tools/ping_keepalive.js [url]
 *   # or set PING_URL env var
 *
 * For a free, reliable scheduler use one of:
 *   - UptimeRobot  (free, 5-minute interval, 50 monitors)
 *   - cron-job.org (free, 1-minute interval)
 */
const url = process.env.PING_URL || process.argv[2] || "https://milo-agent.onrender.com";

fetch(url)
  .then((res) => {
    console.log(`[KeepAlive] ${new Date().toISOString()} ${url} -> HTTP ${res.status}`);
    process.exit(res.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(`[KeepAlive] ${new Date().toISOString()} ${url} -> ERROR: ${err.message}`);
    process.exit(1);
  });
