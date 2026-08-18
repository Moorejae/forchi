// Target companies to scrape, by ATS. This is a STARTER list — edit freely.
// Each fetch is best-effort: a wrong/missing slug is skipped, never fatal.
// Format: { name, ats: 'greenhouse'|'lever'|'workable'|'ashby', slug }
const TARGET_COMPANIES = [
  // ── Greenhouse (public JSON at boards-api.greenhouse.io/v1/boards/{slug}/jobs)
  { name: "OpenAI", ats: "greenhouse", slug: "openai" },
  { name: "Anthropic", ats: "greenhouse", slug: "anthropic" },
  { name: "Stripe", ats: "greenhouse", slug: "stripe" },
  { name: "Shopify", ats: "greenhouse", slug: "shopify" },
  { name: "GitLab", ats: "greenhouse", slug: "gitlab" },
  { name: "DataDog", ats: "greenhouse", slug: "datadog" },
  { name: "Airbnb", ats: "greenhouse", slug: "airbnb" },
  { name: "Reddit", ats: "greenhouse", slug: "reddit" },
  { name: "Notion", ats: "greenhouse", slug: "notion" },
  { name: "Canva", ats: "greenhouse", slug: "canva" },
  { name: "Grammarly", ats: "greenhouse", slug: "grammarly" },
  { name: "Scale AI", ats: "greenhouse", slug: "scale" },
  { name: "Mozilla", ats: "greenhouse", slug: "mozilla" },
  { name: "HubSpot", ats: "greenhouse", slug: "hubspot" },
  { name: "Dropbox", ats: "greenhouse", slug: "dropbox" },

  // ── Lever (public JSON at api.lever.co/v0/postings/{slug}?mode=json)
  { name: "Netflix", ats: "lever", slug: "netflix" },
  { name: "Coinbase", ats: "lever", slug: "coinbase" },
  { name: "Spotify", ats: "lever", slug: "spotify" },
  { name: "Asana", ats: "lever", slug: "asana" },
  { name: "Box", ats: "lever", slug: "box" },
  { name: "Elastic", ats: "lever", slug: "elastic" },
  { name: "Pinterest", ats: "lever", slug: "pinterest" },
  { name: "Wealthsimple", ats: "lever", slug: "wealthsimple" },

  // ── v3.1: remote-friendly AI/cloud/backend targets (more mid-level matches
  // for auto-apply; wrong slugs are skipped best-effort, never fatal) ──
  // Greenhouse
  { name: "Zapier", ats: "greenhouse", slug: "zapier" },
  { name: "HashiCorp", ats: "greenhouse", slug: "hashicorp" },
  { name: "DigitalOcean", ats: "greenhouse", slug: "digitalocean" },
  { name: "Render", ats: "greenhouse", slug: "render" },
  { name: "Vercel", ats: "greenhouse", slug: "vercel" },
  { name: "PostHog", ats: "greenhouse", slug: "posthog" },
  { name: "Sentry", ats: "greenhouse", slug: "sentry" },
  { name: "Sourcegraph", ats: "greenhouse", slug: "sourcegraph" },
  { name: "Mux", ats: "greenhouse", slug: "mux" },
  { name: "Airtable", ats: "greenhouse", slug: "airtable" },
  { name: "Figma", ats: "greenhouse", slug: "figma" },
  { name: "Webflow", ats: "greenhouse", slug: "webflow" },
  { name: "Mixpanel", ats: "greenhouse", slug: "mixpanel" },
  { name: "Duolingo", ats: "greenhouse", slug: "duolingo" },
  { name: "Zendesk", ats: "greenhouse", slug: "zendesk" },
  { name: "Instacart", ats: "greenhouse", slug: "instacart" },
  { name: "Perplexity", ats: "greenhouse", slug: "perplexity" },
  { name: "Cohere", ats: "greenhouse", slug: "cohere" },
  { name: "Mistral AI", ats: "greenhouse", slug: "mistral" },
  { name: "Databricks", ats: "greenhouse", slug: "databricks" },
  { name: "CrowdStrike", ats: "greenhouse", slug: "crowdstrike" },
  { name: "Discord", ats: "greenhouse", slug: "discord" },
  // Lever
  { name: "Fivetran", ats: "lever", slug: "fivetran" },
  { name: "Intercom", ats: "lever", slug: "intercom" },
  { name: "Quora", ats: "lever", slug: "quora" },
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
