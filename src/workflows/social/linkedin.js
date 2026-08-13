// LinkedIn Graph API posting helper
const { detectImageMime } = require("./imageMime");

async function postToLinkedIn({ content, imageBuffer }) {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const authorUrn = process.env.LINKEDIN_AUTHOR_URN; // e.g. urn:li:person:XXXX or urn:li:organization:XXXX

  if (!accessToken || !authorUrn) {
    throw new Error("Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_AUTHOR_URN in environment variables");
  }

  console.log(`[LinkedIn API] Starting post for Author ${authorUrn}...`);

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0"
  };

  // Case 1: Post with Image Buffer (3-step upload - Section 4)
  if (imageBuffer) {
    // Step 1: Register upload
    const registerBody = {
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent"
          }
        ]
      }
    };

    const regRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
      method: "POST",
      headers,
      body: JSON.stringify(registerBody)
    });

    const regData = await regRes.json();
    if (!regRes.ok) {
      throw new Error(`LinkedIn Register Upload failed: ${JSON.stringify(regData)}`);
    }

    const uploadUrl = regData.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
    const assetUrn = regData.value?.asset;

    if (!uploadUrl || !assetUrn) {
      throw new Error("LinkedIn Register Upload did not return uploadUrl or asset URN");
    }

    console.log(`[LinkedIn API] Registered upload. Asset URN: ${assetUrn}`);

    // Step 2: Upload binary bytes to uploadUrl (declare the actual image type)
    const { mime: uploadMime } = detectImageMime(imageBuffer);
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": uploadMime
      },
      body: imageBuffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`LinkedIn Image Binary Upload failed (${uploadRes.status}): ${errText}`);
    }

    console.log("[LinkedIn API] Image binary uploaded successfully.");

    // Step 3: Create ugcPost referencing the asset URN
    const postBody = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content || "" },
          shareMediaCategory: "IMAGE",
          media: [
            {
              status: "READY",
              media: assetUrn
            }
          ]
        }
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
      }
    };

    const postRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers,
      body: JSON.stringify(postBody)
    });

    const postData = await postRes.json();
    if (!postRes.ok) {
      throw new Error(`LinkedIn ugcPost failed: ${JSON.stringify(postData)}`);
    }

    console.log(`[LinkedIn API] Successfully posted with photo to LinkedIn (Post ID: ${postData.id})`);
    return { success: true, postId: postData.id, platform: "linkedin" };
  }

  // Case 2: Text-Only Post
  const postBody = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: content || "" },
        shareMediaCategory: "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  const postRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers,
    body: JSON.stringify(postBody)
  });

  const postData = await postRes.json();
  if (!postRes.ok) {
    throw new Error(`LinkedIn ugcPost text-only failed: ${JSON.stringify(postData)}`);
  }

  console.log(`[LinkedIn API] Successfully posted text-only to LinkedIn (Post ID: ${postData.id})`);
  return { success: true, postId: postData.id, platform: "linkedin" };
}

module.exports = { postToLinkedIn };
