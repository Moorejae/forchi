// src/workflows/video/playlists.js
// YouTube playlist management (create / list / add video) + topic -> playlist mapping.
// Used by the auto-workflow to sort every Short into a themed playlist.
//
// The Shorts workflow posts 3 Shorts/day across THREE posting pillars (categories):
//   Romance & Relationship / Life & Philosophy / Family & Christian Moral.
// Every Short is filed into its category's themed playlist so the channel is
// organized by topic (the user's directive). The category label (passed from
// index.js) is the lookup key; each maps to a dedicated titled playlist.
const TOPIC_PLAYLISTS = {
  // Three posting pillars (categories) -> themed playlists
  "Romance & Relationship": "Victor Moore — Romance & Relationships",
  "Life & Philosophy": "Victor Moore — Life & Philosophy",
  "Family & Christian Moral": "Victor Moore — Faith & Family",
  // Backwards-compat topic-level keys (some videos were recorded by topic)
  "dating, romance and the ache of waiting": "Victor Moore — Romance & Relationships",
  "what we owe the people we love": "Victor Moore — Romance & Relationships",
  "the quiet work of a lasting relationship": "Victor Moore — Romance & Relationships",
  "why we lie to ourselves about love": "Victor Moore — Life & Philosophy",
  "love that outlasts time": "Victor Moore — Romance & Relationships",
  "human behavior and the masks we wear": "Victor Moore — Life & Philosophy",
  "the cost of virtue and the weight of empathy": "Victor Moore — Faith & Family",
  "the courage of staying when it is hard": "Victor Moore — Romance & Relationships",
  "the illusion of safety and the tyranny of tomorrow": "Victor Moore — Life & Philosophy",
  "outgrowing what no longer fits": "Victor Moore — Life & Philosophy",
  "grace, faith and forgiveness": "Victor Moore — Faith & Family",
  "christian hope in a broken world": "Victor Moore — Faith & Family",
  "family, faith and the weight of duty": "Victor Moore — Faith & Family",
  "forgiveness as a discipline": "Victor Moore — Faith & Family",
  "the quiet sacrifice that holds the world together": "Victor Moore — Faith & Family",
};
const DEFAULT_PLAYLIST = "Victor Moore";

async function ytJson(token, url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 30000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`YouTube API ${res.status}: ${txt.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Create a playlist (defaults to public so the themed playlists are visible on
// the channel; pass 'private' to hide one).
async function createPlaylist(token, title, description = "", privacyStatus = "public") {
  const data = await ytJson(
    token,
    "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status",
    {
      method: "POST",
      body: {
        snippet: { title, description },
        status: { privacyStatus },
      },
    }
  );
  return { playlistId: data.id, title: data.snippet.title };
}

async function listPlaylists(token, maxResults = 50) {
  const data = await ytJson(
    token,
    `https://www.googleapis.com/youtube/v3/playlists?part=snippet,status&mine=true&maxResults=${maxResults}`
  );
  return (data.items || []).map((p) => ({
    playlistId: p.id,
    title: p.snippet.title,
    privacy: p.status.privacyStatus,
  }));
}

// Add an existing video to a playlist.
async function addVideoToPlaylist(token, playlistId, videoId) {
  await ytJson(
    token,
    "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
    {
      method: "POST",
      body: {
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      },
    }
  );
  return true;
}

// Find a playlist by exact title, else create it (idempotent).
async function findOrCreatePlaylist(token, title, description = "") {
  const playlists = await listPlaylists(token);
  const existing = playlists.find((p) => p.title.toLowerCase() === title.toLowerCase());
  if (existing) return existing.playlistId;
  const created = await createPlaylist(token, title, description);
  return created.playlistId;
}

// ── Playlist-item helpers (for re-sorting existing videos) ──────────────────
// Find the playlistItem id for a video inside a playlist (null if not present).
async function findPlaylistItem(token, playlistId, videoId) {
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&pageToken=${pageToken}`;
    const data = await ytJson(token, url);
    const hit = (data.items || []).find(
      (it) => it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId === videoId
    );
    if (hit) return hit.id;
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return null;
}

// True if the video is already in the playlist.
async function isVideoInPlaylist(token, playlistId, videoId) {
  return !!(await findPlaylistItem(token, playlistId, videoId));
}

// Remove a video from a playlist by its playlistItem id.
async function removeFromPlaylist(token, playlistItemId) {
  await ytJson(token, `https://www.googleapis.com/youtube/v3/playlistItems?id=${playlistItemId}`, {
    method: "DELETE",
  });
  return true;
}

// Map a script topic -> playlist title -> playlist id (creates it if missing).
// Returns the playlistId (or null if topic is unknown and no default wanted).
async function ensureTopicPlaylist(token, topic) {
  const title = TOPIC_PLAYLISTS[topic] || DEFAULT_PLAYLIST;
  return findOrCreatePlaylist(token, title, "Victor Moore — AI-generated poetry & reflections");
}

module.exports = {
  TOPIC_PLAYLISTS,
  DEFAULT_PLAYLIST,
  createPlaylist,
  listPlaylists,
  addVideoToPlaylist,
  findOrCreatePlaylist,
  findPlaylistItem,
  isVideoInPlaylist,
  removeFromPlaylist,
  ensureTopicPlaylist,
};
