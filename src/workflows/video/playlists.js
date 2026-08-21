// src/workflows/video/playlists.js
// YouTube playlist management (create / list / add video) + topic -> playlist mapping.
// Used by the auto-workflow to sort every Short into a themed playlist.
const TOPIC_PLAYLISTS = {
  "dating, romance and the ache of waiting": "Dating & Romance",
  "what we owe the people we love": "Relationships",
  "grace, faith and forgiveness": "Christian Faith & Morals",
  "the quiet work of a lasting relationship": "Relationships",
  "why we lie to ourselves about love": "Human Behavior",
  "christian hope in a broken world": "Christian Faith & Morals",
  "the courage of staying when it is hard": "Relationships",
  "human behavior and the masks we wear": "Human Behavior",
  "love that outlasts time": "Romance & Poetry",
  "the cost of virtue and the weight of empathy": "Christian Faith & Morals",
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

// Create a playlist (defaults to private; pass 'public' to make it visible).
async function createPlaylist(token, title, description = "", privacyStatus = "private") {
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
  await ytJson("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
    method: "POST",
    body: {
      snippet: {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      },
    },
  });
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
  ensureTopicPlaylist,
};
