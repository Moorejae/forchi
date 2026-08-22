// User's professional profile for the jobs agent.
// Source: Agu_Victor_Chiedozie_Resum.pdf (2026-08-16). Keep every fact real.
const PROFILE = {
  name: "Agu Victor Chiedozie",
  title: "Cloud & AI Systems Engineer",
  timezone: "WAT (GMT+1)",
  email: "aguchiedoxie@gmail.com",
  phone: "+234 816 280 2162",
  linkedin: "linkedin.com/in/aguchiedoxie",
  github: "github.com/Moorejae",
  summary:
    "I build cloud infrastructure and AI systems, alone or with a team, fast — usually in days rather than months. Much of what I know came from deep research and from shipping real things end-to-end, and I'm actively learning from stronger engineers every day. I'm applying for intern, junior and intermediate roles where I can ship real work and keep growing.",
  skills: {
    cloud: [
      "AWS", "Azure", "Oracle Cloud (OCI)", "Google Cloud", "Linux (Ubuntu)", "Nginx",
      "Docker", "Kubernetes", "Terraform", "GitHub Actions CI/CD", "PM2",
    ],
    ai: [
      "LangChain", "multi-agent orchestration", "trigger-based automation design",
      "structured function-calling", "multi-tier LLM failover routing", "RAG and vector agent memory",
    ],
    security: [
      "zero-trust network design", "Cloudflare WAF", "DDoS mitigation", "DNS routing",
      "encrypted service-to-service communication", "self-healing / auto-recovery infrastructure",
    ],
    data: ["Python (FastAPI, Asyncio)", "Node.js", "PostgreSQL", "RESTful APIs", "n8n workflow automation"],
    web3: ["Aptos MoveVM", "Move smart contracts", "non-custodial escrow design"],
  },
  // The agent hunts for these kinds of roles. Positioning: intern / junior /
  // intermediate — a large part of the skill set is research-driven and
  // self-trained, and the user explicitly wants to keep learning from others.
  targetRoles: [
    "AI / LLM Engineer (Junior / Intermediate)",
    "AI Integration Engineer (Junior / Intermediate)",
    "AI Automation Engineer (Junior / Intermediate)",
    "AI Solutions Engineer (Junior / Intermediate)",
    "Cloud / DevOps Engineer (Junior / Intermediate)",
    "Automation Engineer (Junior / Intermediate)",
    "Backend Developer Intern / Junior (Node.js / Python)",
    "AI / ML Intern",
  ],
  // Application identity — real, used only to fill ATS forms.
  identity: {
    fullName: "Agu Victor Chiedozie",
    firstName: "Victor",
    lastName: "Agu",
    email: "aguchiedoxie@gmail.com",
    phone: "+234 816 280 2162",
    location: "Lagos, Nigeria (WAT, GMT+1)",
  },
  // Public proof links (used in the RESUME header, like the original).
  links: {
    github: "https://github.com/Moorejae",
    linkedin: "https://linkedin.com/in/aguchiedoxie",
    facebook: "https://www.facebook.com/realfickleyouth", // "Fickle youth" page
    cloudvoid: "https://cloudvoid.online",
    myzelva: "https://myzelva.com",
  },
  // Portfolio sites shown on the COVER LETTER signature — NO socials.
  portfolioLinks: ["https://myzelva.com", "https://cloudvoid.online"],
  // ATS application-form answers (standard fields). Tweak as needed.
  yearsExperience: 3, // earliest real project (2024) → ~3 years
  // REAL work history — the "TECHNICAL PROJECTS & EXPERIENCE" section from the
  // base resume. These are the candidate's genuine builds; the TAILOR connects
  // each one to the target company's vision (proof the JD was read).
  experience: [
    {
      role: "Designer & Builder",
      company: "ForChi — AI Workflow Agent (live 24/7 Telegram bot)",
      years: "2026 – Present",
      bullets: [
        "Built and shipped a trigger-only Node.js/LangChain agent that posts to Facebook and LinkedIn automatically, using a two-step gate-and-extraction pipeline so casual chat never accidentally fires a workflow",
        "Designed a multi-tier LLM fallback (Gemini key rotation with a self-hosted Qwen model as backup) to stay responsive under free-tier rate limits",
        "Added voice-note handling and a multi-stage AI image generation pipeline, styled differently per platform",
        "Built an automated YouTube Shorts pipeline (AI poem → cloned voice → stock clips → assembly → upload → playlist) posting ~5 Shorts/day with topic rotation across 3 pillars: romance, philosophy, and faith",
        "Set up OAuth-based YouTube auth with an automatic weekly re-auth watcher, plus human-friendly self-healing error reports delivered by the bot itself",
      ],
    },
    {
      role: "Founder & Lead Systems Architect",
      company: "CloudVoid — non-custodial escrow platform (https://cloudvoid.online)",
      years: "2025 – Present",
      bullets: [
        "Designed and built a non-custodial P2P crypto-to-fiat escrow platform: React frontend, Python/Node.js backend, on a zero-trust Kubernetes cluster on Oracle Cloud",
        "Implemented an Aptos MoveVM escrow layer with pre-commit locking, trust-bond penalty logic, and gas abstraction via Paymaster sponsorship",
        "Built a cryptographic 3-of-5 threshold arbitration system for on-chain dispute resolution, backend locked behind Cloudflare WAF and custom iptables rules",
        "Set up self-healing infrastructure: a webhook-triggered watchdog tied to PM2 for automatic recovery and zero-downtime deploys",
      ],
    },
    {
      role: "Solo Architect & Builder",
      company: "Project CLAY — 21-container multi-agent system",
      years: "2026",
      bullets: [
        "Designed and built a 21-container multi-agent architecture with working image generation, conversational handling, and automated social posting",
        "Evaluated honestly and retired the architecture in favor of a leaner, trigger-based design that directly informed ForChi",
      ],
    },
    {
      role: "Systems Developer",
      company: "Flamchi / Footchristo — sports prediction engine (live 24/7 Telegram bot)",
      years: "2024 – 2026",
      bullets: [
        "Built a sports prediction engine for football, basketball, and tennis using association-rule mining, discarding six earlier approaches that failed on unseen data",
        "Every rule validated on a blind, never-touched data window: 69.6% football, 66.8% NBA, 69.8% tennis; refuses to predict when no validated pattern matches",
        "Latest 'Odonata dragonfly' ruleset: 950 football / 1,927 basketball / 1,495 tennis blind-validated rules",
        "Ships one weekly digest per sport (time · teams · projected winner) and explains WHY a pick was made via a Qwen-powered chat bot",
      ],
    },
    {
      role: "Builder — Self-Hosting & Automation",
      company: "Infrastructure (Contabo VPS, systemd, Hugging Face)",
      years: "2026",
      bullets: [
        "Migrated all production services from Render to a self-managed Contabo VPS: systemd units with auto-restart, scheduled timers, and a Telegram-driven health watchdog",
        "Self-hosted a local Qwen3 4B LLM (llama.cpp) on the VPS as the always-on chat fallback, cutting cold-start latency from minutes to seconds",
        "Distributed 148MB of media assets via a private Hugging Face dataset with a pull-on-deploy bundle so any host boots the full pipeline",
      ],
    },
  ],
  languages: ["English (professional / fluent)", "Igbo (native)"],
  // Preferred job-hunting regions (user rule).
  preferredRegions: ["Poland", "Europe", "Australia", "New Zealand", "North America", "South America", "Israel"],
  workAuthorization: "Not authorized to work in-country; available for remote work worldwide",
  securityClearance: "None (no security clearance)",
  // Salary the AI fills into forms — user rule: any amount BELOW $5,000/month.
  salaryExpectation: "$3,500 per month",
  certifications: [
    "Cloud Computing Certification, Digital Witch (2026)",
    "Certified Customer Service Professional, CURSA (2025)",
    "IT Support Specialist, Digital Witch (2024)",
  ],
  // Real short testimonial from a past collaborator/client (optional). Cover
  // letters only include a quote when this has a value — never fabricated.
  testimonial: "",
};

module.exports = { PROFILE };
