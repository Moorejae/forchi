const FormData = require("form-data");

async function postToFacebook({ content, imageBuffer }) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  // Accept both FACEBOOK_PAGE_TOKEN (canonical) and FACEBOOK_PAGE_ACCESS_TOKEN (HF Secrets alias)
  const pageToken = process.env.FACEBOOK_PAGE_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !pageToken) {
    throw new Error("Missing FACEBOOK_PAGE_ID or FACEBOOK_PAGE_TOKEN (or FACEBOOK_PAGE_ACCESS_TOKEN) in environment variables");
  }

  console.log(`[Facebook API] Starting post to Page ID ${pageId}...`);

  // Case 1: Post with Image Buffer (2-call process Graph API - Section 4)
  if (imageBuffer) {
    // Step 1: Upload photo unpublished
    const photoForm = new FormData();
    photoForm.append("source", imageBuffer, { filename: "post.jpg", contentType: "image/jpeg" });
    photoForm.append("caption", content || "");
    photoForm.append("published", "false");
    photoForm.append("access_token", pageToken);

    const photoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
      method: "POST",
      body: photoForm
    });

    const photoData = await photoRes.json();
    if (!photoRes.ok || photoData.error) {
      throw new Error(`Facebook Photo Upload failed: ${JSON.stringify(photoData.error || photoData)}`);
    }

    const photoId = photoData.id;
    console.log(`[Facebook API] Photo uploaded unpublished with ID: ${photoId}`);

    // Step 2: Create Feed post with attached media
    const feedParams = new URLSearchParams();
    feedParams.append("message", content || "");
    feedParams.append("attached_media[0]", JSON.stringify({ media_fbid: photoId }));
    feedParams.append("access_token", pageToken);

    const feedRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
      method: "POST",
      body: feedParams
    });

    const feedData = await feedRes.json();
    if (!feedRes.ok || feedData.error) {
      throw new Error(`Facebook Feed Post failed: ${JSON.stringify(feedData.error || feedData)}`);
    }

    console.log(`[Facebook API] Successfully posted with photo to Facebook Feed (Post ID: ${feedData.id})`);
    return { success: true, postId: feedData.id, platform: "facebook" };
  }

  // Case 2: Text-Only Post
  const feedParams = new URLSearchParams();
  feedParams.append("message", content || "");
  feedParams.append("access_token", pageToken);

  const feedRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    body: feedParams
  });

  const feedData = await feedRes.json();
  if (!feedRes.ok || feedData.error) {
    throw new Error(`Facebook Feed Text Post failed: ${JSON.stringify(feedData.error || feedData)}`);
  }

  console.log(`[Facebook API] Successfully posted text-only to Facebook Feed (Post ID: ${feedData.id})`);
  return { success: true, postId: feedData.id, platform: "facebook" };
}

module.exports = { postToFacebook };
