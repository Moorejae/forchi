// src/workflows/video/v10Playlists.js
// V10 LONG-FORM playlist system (user spec 2026-08-30).
//
// Every V10 video rotates through one of FIVE main topic categories, and after
// upload is auto-sorted into that category's YouTube playlist:
//   1. Church & Bible Stories        (modern + historical church stories, bible histories)
//   2. Family Stories                (modern + historical family stories)
//   3. World Folklore                (traditional + modern folklore from around the world)
//   4. Love & Relationship Stories   (modern + historical love stories from around the world)
//   5. Book Summaries                (wealth, psychology, marriage, friendship, power,
//                                     politics, religion, spirituality, philosophy, human nature)
//
// A video's topic is read from meta.json ("topic") and ALSO from the theme
// (theme is what v10ScriptGen rotates). classifyV10(topic, theme) maps either to
// one of the five playlist titles. If nothing matches, it falls back to a
// default V10 playlist.
const path = require("path");

const V10_PLAYLISTS = [
  { title: "Church & Bible Stories", desc: "Modern and historical church stories and Bible histories." },
  { title: "Family Stories", desc: "Modern and historical family stories — love, sacrifice, and loyalty." },
  { title: "World Folklore", desc: "Traditional and modern folklore from countries and traditions around the world." },
  { title: "Love & Relationship Stories", desc: "Modern and historical love stories from around the world." },
  { title: "Book Summaries", desc: "Summaries of books on wealth, psychology, marriage, friendship, power, politics, religion, spirituality, philosophy, and human nature." },
];
const DEFAULT_V10_PLAYLIST = "V10 Stories";

// Keyword -> playlist title classifier (checked in order; first hit wins).
// World Folklore and the story-category keywords are checked BEFORE Book
// Summaries' generic terms ("human nature", "power") so a folklore legend or a
// family/relationship story never gets misrouted just because it mentions one.
const V10_CLASSIFIERS = [
  { title: "World Folklore", keys: ["folklore", "folktale", "legend", "myth", "mytholog", "fable", "fairy", "folk", "tradition", "tribe", "village", "kingdom", "parable of", "folk story", "country", "ancient tale", "creature", "beast", "monster", "dragon", "hunt", "hunter", "siren", "troll", "yeti", "cryptid"] },
  { title: "Church & Bible Stories", keys: ["church", "bible", "biblical", "scripture", "christ", "jesus", "gospel", "apostle", "prophet", "psalm", "parable", "exodus", "genesis", "revelation", "saint", "monk", "priest", "nun", "crusade", "missionary", "covenant", "faith"] },
  { title: "Family Stories", keys: ["family", "mother", "father", "sibling", "brother", "sister", "son ", "daughter", "parent", "grandmother", "grandfather", "grandparent", "household", "clan", "dynasty", "inheritance", "home"] },
  { title: "Love & Relationship Stories", keys: ["love", "romance", "romantic", "relationship", "dating", "courtship", "marry", "wedding", "bride", "groom", "lover", "heartbreak", "longing", "passion", "devotion"] },
  { title: "Book Summaries", keys: ["book", "summary", "summar", "wealth", "psychology", "psycholog", "marriage", "friendship", "money", "mindset", "stoic", "treatise", "essay", "influence", "habit", "atomic", "deep work", "think and grow", "power", "politic", "religio", "spiritu", "philosoph", "human nature"] },
];

function classifyV10(topic = "", theme = "") {
  const hay = `${topic} ${theme}`.toLowerCase();
  if (!hay.trim()) return DEFAULT_V10_PLAYLIST;
  for (const c of V10_CLASSIFIERS) {
    for (const k of c.keys) {
      if (hay.includes(k)) return c.title;
    }
  }
  // A "book summary" style theme (e.g. "Book Summary: ...") always lands in Book Summaries
  if (/summary|summariz/i.test(hay)) return "Book Summaries";
  return DEFAULT_V10_PLAYLIST;
}

async function listPlaylists(token) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,status&mine=true&maxResults=50`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`list playlists ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return (d.items || []).map((p) => ({ playlistId: p.id, title: p.snippet.title }));
}

async function createPlaylist(token, title, description = "", privacyStatus = "public") {
  const res = await fetch("https://www.googleapis.com/youtube/v3/playlists?part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { title, description }, status: { privacyStatus } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`create playlist ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return { playlistId: d.id, title: d.snippet.title };
}

async function addVideoToPlaylist(token, playlistId, videoId) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`add to playlist ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// Find by title (case-insensitive) else create. Returns { playlistId, title }.
async function findOrCreatePlaylist(token, title, description = "") {
  const pls = await listPlaylists(token);
  const hit = pls.find((p) => p.title.toLowerCase() === title.toLowerCase());
  if (hit) return { playlistId: hit.playlistId, title };
  const created = await createPlaylist(token, title, description);
  return { playlistId: created.playlistId, title };
}

// Ensure the playlist for a topic/theme exists and return { playlistId, title }.
async function ensureV10Playlist(token, topic, theme) {
  const title = classifyV10(topic, theme);
  const desc = (V10_PLAYLISTS.find((p) => p.title === title) || {}).desc || "V10 long-form stories";
  return findOrCreatePlaylist(token, title, desc);
}

module.exports = {
  V10_PLAYLISTS,
  DEFAULT_V10_PLAYLIST,
  classifyV10,
  listPlaylists,
  createPlaylist,
  addVideoToPlaylist,
  findOrCreatePlaylist,
  ensureV10Playlist,
};
