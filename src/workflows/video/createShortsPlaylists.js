// One-off: create the three themed Shorts playlists on the channel (if missing)
// and report existing playlists. Runs on the VPS where the YouTube token lives.
// Usage: node src/workflows/video/createShortsPlaylists.js
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });
const youtube = require("./youtube.js");
const pl = require("./playlists.js");

// The three posting pillars -> the themed playlists we want to exist.
const DESIRED = [
  { title: "Victor Moore — Romance & Relationships", desc: "Victor Moore — romantic poetry, longing, devotion, and the ache of waiting." },
  { title: "Victor Moore — Life & Philosophy", desc: "Victor Moore — philosophy, human nature, the masks we wear, and the stories we tell." },
  { title: "Victor Moore — Faith & Family", desc: "Victor Moore — grace, faith, forgiveness, family, and the quiet weight of duty." },
];

async function main() {
  const token = await youtube.refreshAccess();
  console.log("got access token ✓");

  const existing = await pl.listPlaylists(token);
  console.log(`\n${existing.length} playlist(s) on the channel:`);
  for (const p of existing) console.log(`  ${p.playlistId}  ${p.title}  (${p.privacy})`);

  console.log("\nEnsuring themed playlists exist...");
  const got = [];
  for (const d of DESIRED) {
    const hit = existing.find((p) => p.title.toLowerCase() === d.title.toLowerCase());
    if (hit) {
      console.log(`  exists: ${d.title} -> ${hit.playlistId}`);
      got.push({ title: d.title, playlistId: hit.playlistId });
    } else {
      const created = await pl.createPlaylist(token, d.title, d.desc, "public");
      console.log(`  CREATED: ${created.title} -> ${created.playlistId}`);
      got.push({ title: created.title, playlistId: created.playlistId });
    }
  }
  console.log("\nDONE. Themed playlists:");
  for (const g of got) console.log(`  ${g.playlistId}  ${g.title}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
