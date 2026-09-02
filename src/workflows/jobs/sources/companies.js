// Target companies to scrape, by ATS. This is a STARTER list — edit freely.
// Each fetch is best-effort: a wrong/missing slug is skipped, never fatal.
// Format: { name, ats: 'greenhouse'|'lever'|'workable'|'ashby', slug, url }
// `url` = the company's OWN website (NOT the jobsite/LinkedIn URL). USER
// DIRECTIVE (2026-09-02): prefer applying via the company's own site — a
// LinkedIn/jobsite application is ~90% likely to never be seen by a human. The
// companyUrl is attached to each job so the resume/cover letter/email points
// the reader at the real company website.
const TARGET_COMPANIES = [
  // ── Greenhouse (public JSON at boards-api.greenhouse.io/v1/boards/{slug}/jobs)
  { name: "OpenAI", ats: "greenhouse", slug: "openai", url: "https://openai.com" },
  { name: "Anthropic", ats: "greenhouse", slug: "anthropic", url: "https://anthropic.com" },
  { name: "Stripe", ats: "greenhouse", slug: "stripe", url: "https://stripe.com" },
  { name: "Shopify", ats: "greenhouse", slug: "shopify", url: "https://shopify.com" },
  { name: "GitLab", ats: "greenhouse", slug: "gitlab", url: "https://gitlab.com" },
  { name: "DataDog", ats: "greenhouse", slug: "datadog", url: "https://datadoghq.com" },
  { name: "Airbnb", ats: "greenhouse", slug: "airbnb", url: "https://airbnb.com" },
  { name: "Reddit", ats: "greenhouse", slug: "reddit", url: "https://reddit.com" },
  { name: "Notion", ats: "greenhouse", slug: "notion", url: "https://notion.so" },
  { name: "Canva", ats: "greenhouse", slug: "canva", url: "https://canva.com" },
  { name: "Grammarly", ats: "greenhouse", slug: "grammarly", url: "https://grammarly.com" },
  { name: "Scale AI", ats: "greenhouse", slug: "scale", url: "https://scale.com" },
  { name: "Mozilla", ats: "greenhouse", slug: "mozilla", url: "https://mozilla.org" },
  { name: "HubSpot", ats: "greenhouse", slug: "hubspot", url: "https://hubspot.com" },
  { name: "Dropbox", ats: "greenhouse", slug: "dropbox", url: "https://dropbox.com" },

  // ── Lever (public JSON at api.lever.co/v0/postings/{slug}?mode=json)
  { name: "Netflix", ats: "lever", slug: "netflix", url: "https://netflix.com" },
  { name: "Coinbase", ats: "lever", slug: "coinbase", url: "https://coinbase.com" },
  { name: "Spotify", ats: "lever", slug: "spotify", url: "https://spotify.com" },
  { name: "Asana", ats: "lever", slug: "asana", url: "https://asana.com" },
  { name: "Box", ats: "lever", slug: "box", url: "https://box.com" },
  { name: "Elastic", ats: "lever", slug: "elastic", url: "https://elastic.co" },
  { name: "Pinterest", ats: "lever", slug: "pinterest", url: "https://pinterest.com" },
  { name: "Wealthsimple", ats: "lever", slug: "wealthsimple", url: "https://wealthsimple.com" },

  // ── v3.1: remote-friendly AI/cloud/backend targets (more mid-level matches
  // for auto-apply; wrong slugs are skipped best-effort, never fatal) ──
  // Greenhouse
  { name: "Zapier", ats: "greenhouse", slug: "zapier", url: "https://zapier.com" },
  { name: "HashiCorp", ats: "greenhouse", slug: "hashicorp", url: "https://hashicorp.com" },
  { name: "DigitalOcean", ats: "greenhouse", slug: "digitalocean", url: "https://digitalocean.com" },
  { name: "Render", ats: "greenhouse", slug: "render", url: "https://render.com" },
  { name: "Vercel", ats: "greenhouse", slug: "vercel", url: "https://vercel.com" },
  { name: "PostHog", ats: "greenhouse", slug: "posthog", url: "https://posthog.com" },
  { name: "Sentry", ats: "greenhouse", slug: "sentry", url: "https://sentry.io" },
  { name: "Sourcegraph", ats: "greenhouse", slug: "sourcegraph", url: "https://sourcegraph.com" },
  { name: "Mux", ats: "greenhouse", slug: "mux", url: "https://mux.com" },
  { name: "Airtable", ats: "greenhouse", slug: "airtable", url: "https://airtable.com" },
  { name: "Figma", ats: "greenhouse", slug: "figma", url: "https://figma.com" },
  { name: "Webflow", ats: "greenhouse", slug: "webflow", url: "https://webflow.com" },
  { name: "Mixpanel", ats: "greenhouse", slug: "mixpanel", url: "https://mixpanel.com" },
  { name: "Duolingo", ats: "greenhouse", slug: "duolingo", url: "https://duolingo.com" },
  { name: "Zendesk", ats: "greenhouse", slug: "zendesk", url: "https://zendesk.com" },
  { name: "Instacart", ats: "greenhouse", slug: "instacart", url: "https://instacart.com" },
  { name: "Perplexity", ats: "greenhouse", slug: "perplexity", url: "https://perplexity.ai" },
  { name: "Cohere", ats: "greenhouse", slug: "cohere", url: "https://cohere.com" },
  { name: "Mistral AI", ats: "greenhouse", slug: "mistral", url: "https://mistral.ai" },
  { name: "Databricks", ats: "greenhouse", slug: "databricks", url: "https://databricks.com" },
  { name: "CrowdStrike", ats: "greenhouse", slug: "crowdstrike", url: "https://crowdstrike.com" },
  { name: "Discord", ats: "greenhouse", slug: "discord", url: "https://discord.com" },
  // Lever
  { name: "Fivetran", ats: "lever", slug: "fivetran", url: "https://fivetran.com" },
  { name: "Intercom", ats: "lever", slug: "intercom", url: "https://intercom.com" },
  { name: "Quora", ats: "lever", slug: "quora", url: "https://quora.com" },
];

// Env override: JSON array, e.g. JOBS_COMPANIES='[{"name":"X","ats":"greenhouse","slug":"x"}]'
function getTargetCompanies() {
  try {
    const raw = process.env.JOBS_COMPANIES;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {
    console.warn("[Jobs] Invalid JOBS_COMPANIES env:", e.message);
  }
  return TARGET_COMPANIES;
}

module.exports = { TARGET_COMPANIES, getTargetCompanies };
