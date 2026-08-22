// ForChi Facebook video poster — uploads a Short video to the configured Page.
// Uses the Page video endpoint (POST /{page_id}/videos) with the raw mp4 bytes.
// Credentials: FACEBOOK_PAGE_ID + FACEBOOK_PAGE_TOKEN (or FACEBOOK_PAGE_ACCESS_TOKEN).
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "..", ".env") });

async function postToFacebookVideo(filePath, { title = "", description = "" } = {}) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !pageToken) {
    throw new Error("Missing FACEBOOK_PAGE_ID or FACEBOOK_PAGE_TOKEN (or FACEBOOK_PAGE_ACCESS_TOKEN) in environment variables");
  }
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Facebook video file not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("source", new Blob([buffer], { type: "video/mp4" }), path.basename(filePath));
  if (title) form.append("title", title);
  if (description) form.append("description", description);
  form.append("access_token", pageToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/videos`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Facebook Video Upload failed: ${JSON.stringify(data.error || data)}`);
  }
  console.log(`[Facebook API] Video posted to Page ${pageId} (Video ID: ${data.id})`);
  return { success: true, postId: data.id, platform: "facebook", url: `https://www.facebook.com/${pageId}/videos/${data.id}` };
}

module.exports = { postToFacebookVideo };
