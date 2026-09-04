// One-off: re-sort existing Shorts into their correct themed playlists.
// Reads temp_media/video_posts.json, maps each post to a themed playlist by its
// category (or topic), ensures the playlist exists, and adds the video to it.
// Removes the video from the legacy "Victor Moore" catch-all playlist so the
// channel isn't duplicated. Runs on the VPS where the YouTube token lives.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const youtube = require("./youtube.js");
const pl = require("./playlists.js");

const BASE = process.env.FORCHI_BASE || path.resolve(__dirname, "..", "..", "..");
const POSTS_FILE = path.join(BASE, "temp_media", "video_posts.json");

// The legacy catch-all playlist every Short was dumped into before the fix.
const LEGACY_PLAYLIST_TITLES = ["Victor Moore", "Relationships", "Dating & Romance"];

async function main() {
  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
  console.log(`${posts.length} posts in video_posts.json`);
  const token = await youtube.refreshAccess();
  console.log("got access token ✓");

  const existing = await pl.listPlaylists(token);
  const byTitle = {};
  for (const p of existing) byTitle[p.title.toLowerCase()] = p;

  // Resolve the legacy playlist IDs (to remove videos from them)
  const legacyIds = [];
  for (const t of LEGACY_PLAYLIST_TITLES) {
    const hit = byTitle[t.toLowerCase()];
    if (hit) legacyIds.push({ playlistId: hit.playlistId, title: hit.title });
  }
  console.log(`legacy catch-all playlists to clean: ${legacyIds.map((l) => l.title).join(", ") || "none"}`);

  let moved = 0, skipped = 0, errors = 0;
  for (const post of posts) {
    const videoId = post.videoId;
    if (!videoId) { skipped++; continue; }
    // Determine the target playlist title from category or topic
    const cat = post.category;
    const topic = post.topic;
    const targetTitle = cat ? (pl.TOPIC_PLAYLISTS[cat] || pl.DEFAULT_PLAYLIST)
                            : (pl.TOPIC_PLAYLISTS[topic] || pl.DEFAULT_PLAYLIST);
    if (targetTitle === pl.DEFAULT_PLAYLIST) { console.log(`  skip ${videoId}: no themed playlist for cat=${cat} topic=${topic}`); skipped++; continue; }

    // Ensure the target playlist exists (normalize to {playlistId, title})
    let target = byTitle[targetTitle.toLowerCase()];
    if (!target) {
      const createdId = await pl.findOrCreatePlaylist(token, targetTitle, "Victor Moore — AI-generated poetry & reflections");
      target = { playlistId: createdId, title: targetTitle };
      byTitle[targetTitle.toLowerCase()] = target;
    }

    // Check whether the video is already in the target playlist
    const already = await pl.isVideoInPlaylist(token, target.playlistId, videoId);
    if (!already) {
      try {
        await pl.addVideoToPlaylist(token, target.playlistId, videoId);
        console.log(`  + ${videoId} -> ${targetTitle} (${target.playlistId}) [cat=${cat} topic=${topic}]`);
        moved++;
      } catch (e) { console.log(`  ! ${videoId} add failed: ${e.message}`); errors++; }
    } else {
      console.log(`  = ${videoId} already in ${targetTitle}`);
      skipped++;
    }

    // Remove from legacy catch-all playlists (dedupe)
    for (const leg of legacyIds) {
      if (leg.playlistId === target.playlistId) continue;
      try {
        const itemId = await pl.findPlaylistItem(token, leg.playlistId, videoId);
        if (itemId) { await pl.removeFromPlaylist(token, itemId); console.log(`  - ${videoId} removed from ${leg.title}`); }
      } catch (e) { console.log(`  ! ${videoId} remove from ${leg.title} failed: ${e.message}`); }
    }
  }

  console.log(`\nDONE. moved=${moved} already/skipped=${skipped} errors=${errors}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
