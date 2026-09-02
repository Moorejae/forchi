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
    "I ship production AI systems, cloud infrastructure, and API integrations end-to-end — and I have the live builds to prove it: a 24/7 Telegram agent (ForChi) that automates social posting, runs a 2-videos-a-day YouTube pipeline, and applies to jobs by itself; a completed non-custodial multi-chain crypto wallet (CloudVoid) with real on-chain send and swap; and a blind-validated sports prediction engine (Flamchi) covering football, basketball and tennis. Everything I list below is live in production, not a demo. I'm applying for intern and junior roles in cloud security, AI integration, workflow automation, and API integration where I can ship real work and keep learning from stronger engineers.",

  // Resume headline + summary variants — USER DIRECTIVE (2026-09-02). The resume
  // swaps its headline + professional summary to match the role being applied to.
  // `key` is matched against the job title/description in tailor.js.
  resumeVersions: [
    {
      key: "cloud-ai",
      headline: "Cloud & AI Systems Engineer",
      summary:
        "Cloud & AI Systems Engineer who ships production AI, cloud, and API systems end-to-end — a 24/7 Telegram agent (ForChi) that automates social posting, video production, and job applications; a completed non-custodial multi-chain crypto wallet (CloudVoid) with real on-chain send and swap; and a blind-validated sports prediction engine. Built live on a $0 stack (Contabo VPS, Hugging Face, Gemini free tier). Seeking a remote junior cloud / AI integration role where I can ship real work and learn from stronger engineers.",
    },
    {
      key: "devops",
      headline: "DevOps & Cloud Infrastructure Engineer",
      summary:
        "DevOps & Cloud Infrastructure Engineer who self-manages production on Linux — migrated every service to a Contabo VPS with systemd auto-restart, a Telegram-driven health watchdog, self-healing deploys, and encrypted service-to-service traffic. Automated a 2-videos-a-day YouTube pipeline and a 24/7 multi-agent system on a $0 stack (Docker, GitHub Actions CI/CD, Cloudflare WAF, Hugging Face). Seeking a remote junior DevOps / SRE / platform role where I can ship real infrastructure and grow with a strong team.",
    },
    {
      key: "automation",
      headline: "Automation & Workflow Systems Engineer",
      summary:
        "Automation & Workflow Systems Engineer who builds agents and pipelines that run themselves — ForChi, a trigger-only Telegram agent that auto-posts social content, runs a full YouTube pipeline, and applies to jobs by itself; plus n8n-style workflow automation and API integrations across YouTube, Facebook, LinkedIn, and Telegram. Completed a non-custodial crypto wallet with automated on-chain send and swap. Seeking a remote junior workflow-automation / AI-integration role where I can design systems that remove manual work.",
    },
  ],
  skills: {
    cloud: [
      "AWS", "Azure", "Oracle Cloud (OCI)", "Google Cloud (Vertex AI)", "Linux (Ubuntu)", "Nginx",
      "Docker", "Kubernetes", "Terraform", "GitHub Actions CI/CD", "PM2", "systemd",
      "Cloudflare Pages + WAF", "Contabo VPS", "Hugging Face Spaces (ZeroGPU)",
    ],
    security: [
      "zero-trust network design", "Cloudflare WAF", "DDoS mitigation", "DNS routing",
      "custom iptables rules", "encrypted service-to-service communication (P-256 ECDH + HKDF-SHA256 + AES-256-GCM)",
      "non-custodial / self-custody key handling", "threshold (3-of-5) arbitration", "self-healing / auto-recovery infrastructure",
    ],
    ai: [
      "LangChain", "multi-agent orchestration", "trigger-based automation design",
      "structured function-calling", "multi-tier LLM failover routing (Gemini rotation + self-hosted Qwen)",
      "RAG and vector agent memory", "prompt engineering", "AI voice cloning (Higgs Audio v3, F5-TTS)",
      "AI image generation (FLUX, Gemini-image, Stable Diffusion)", "auto-transcription (Whisper / Moonshine)",
    ],
    integration: [
      "API integration & automation", "RESTful API design", "webhooks", "OAuth 2.0 flows",
      "YouTube Data API v3 (upload, captions, thumbnails, playlists)", "Facebook Graph API", "LinkedIn API",
      "Telegram Bot API", "Gemini / OpenAI-style LLM APIs", "ParaSwap DEX API", "CoinGecko & Binance price APIs",
      "Alchemy / chain RPCs (EVM, Solana, Tron, Aptos, Stellar)", "ATS application APIs (Lever, Ashby, Greenhouse, Workable)",
    ],
    workflow: [
      "n8n workflow automation", "trigger-based pipelines", "scheduled cron workflows",
      "resume-safe self-healing build pipelines", "data pipelines", "daily autonomous agents",
    ],
    data: ["Python (FastAPI, Asyncio)", "Node.js", "PostgreSQL", "Neon", "SQLite", "association-rule mining", "blind / out-of-sample validation"],
    web3: ["Aptos MoveVM", "Move smart contracts", "non-custodial escrow design", "multi-chain wallets (EVM, UTXO, Solana, Tron, Aptos, Stellar)"],
  },
  // The agent hunts for these kinds of roles. Positioning: intern / junior /
  // intermediate — a large part of the skill set is research-driven and
  // self-trained, and the user explicitly wants to keep learning from others.
  // USER DIRECTIVE (2026-09-01): FIVE focus domains ONLY — cloud security,
  // DevOps / SRE, AI integration, workflow automation, and API integration —
  // at intern / junior / entry level.
  targetRoles: [
    "Cloud Security (Intern / Junior / Entry Level)",
    "DevOps / SRE Engineer (Intern / Junior / Entry Level)",
    "Cloud / Platform Engineer (Intern / Junior)",
    "AI Integration Engineer (Intern / Junior)",
    "AI / LLM Engineer (Intern / Junior)",
    "Workflow Automation Engineer (Intern / Junior)",
    "Automation Engineer (Intern / Junior)",
    "API Integration Engineer (Intern / Junior)",
    "Backend Developer (Intern / Junior, API-focused)",
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
    youtube: "https://www.youtube.com/@sirxlud", // live V10 long-form channel
    cloudvoid: "https://cloudvoid.online",
    myzelva: "https://myzelva.com",
  },
  // Portfolio sites shown on the COVER LETTER signature — NO socials.
  portfolioLinks: ["https://myzelva.com", "https://cloudvoid.online", "https://www.youtube.com/@sirxlud"],
  // ATS application-form answers (standard fields). Tweak as needed.
  yearsExperience: 3, // earliest real project (2024) → ~3 years
  // REAL work history — the "TECHNICAL PROJECTS & EXPERIENCE" section from the
  // base resume. These are the candidate's genuine builds; the TAILOR connects
  // each one to the target company's vision (proof the JD was read).
  experience: [
    {
      role: "Designer & Builder",
      company: "ForChi — AI Workflow Agent + full YouTube automation (live 24/7 Telegram bot)",
      years: "2026 – Present",
      bullets: [
        "Built and shipped a trigger-only Node.js/LangChain agent that runs deterministic automation workflows (social posting, video pipeline, job applications) from text or voice commands, using a two-step gate-and-extraction pipeline so casual chat never accidentally fires a workflow",
        "Built an autonomous JOB-APPLICATION workflow: discovers remote intern/junior roles from LinkedIn + company ATS boards (Greenhouse, Lever, Ashby, Workable) + 4 aggregators, scores each against a real profile with Gemini, writes a tailored resume and human-voice cover letter per job description, then auto-applies via the ATS APIs — with a daily Telegram digest",
        "Built a full long-form YouTube automation pipeline (channel @sirxlud): AI script generation with a 4-act retention structure and curiosity-gap 'Why' titles, voice-cloned narration (Higgs Audio v3 TTS), AI scene + image generation, frame assembly, burned-in subtitles, thumbnails and auto-sorting into topic playlists — posting up to 2 videos a day end-to-end",
        "Built an earlier YouTube Shorts pipeline (AI poem → cloned voice → stock clips → assembly → upload → playlist) posting ~5 Shorts/day with topic rotation across 3 pillars: romance, philosophy, and faith",
        "Designed a multi-tier LLM failover (Gemini key rotation with a self-hosted Qwen model as backup) to stay responsive under free-tier rate limits; integrated self-hosted Whisper transcription and FLUX/Gemini image generation",
        "Set up OAuth-based YouTube auth with an automatic weekly re-auth watcher, plus human-friendly self-healing error reports delivered by the bot itself",
      ],
    },
    {
      role: "Founder & Lead Systems Architect",
      company: "CloudVoid — non-custodial multi-chain wallet (COMPLETED, https://cloudvoid.online)",
      years: "2025 – 2026",
      bullets: [
        "Built and COMPLETED a non-custodial multi-chain crypto wallet (15 chains: EVM, Bitcoin-family UTXO, Solana, Tron, Aptos, Stellar) — Expo/React Native UI (web + Android APK) with a Node.js/Express backend on Oracle Cloud; private keys derived client-side so the server only ever sees public addresses",
        "Implemented an encrypted 'Riverbed' frontend-backend envelope (P-256 ECDH + HKDF-SHA256 + AES-256-GCM) so every request is end-to-end encrypted, and secured the backend with Cloudflare WAF and custom iptables rules",
        "Integrated real chain APIs (Alchemy, mempool.space, Blockchair, TronGrid, Aptos fullnode, Horizon) for live balances, and real on-chain Send (locally signed) + DEX Swap via the ParaSwap API with automatic token approval — no platform fee",
        "Wired live price feeds from Binance + CoinGecko, real scannable QR codes, multi-wallet support with per-wallet encrypted seeds, and deployed via Cloudflare Pages + a GitHub Actions APK release pipeline",
        "Shipped a genuine on-chain layer end-to-end: real EVM send (local signing, nonce + gas + broadcast), real ParaSwap aggregator swaps routed through Uniswap/Curve, live balances and prices — verified against live chain RPCs (the project is complete and live)",
        "Earlier work on the platform: a P2P crypto-to-fiat escrow layer on Aptos MoveVM with pre-commit locking, trust-bond penalties, gas abstraction via Paymaster, and a cryptographic 3-of-5 threshold arbitration system",
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
        "Built a sports prediction engine for football, basketball, and tennis using data-driven association-rule mining, discarding six earlier approaches that failed on unseen data before one held up",
        "Every rule validated on a blind, never-touched data window: ~69-70% football, 67% NBA, 70% tennis; the capital-safe +1 handicap market hits ~86-90%; refuses to predict when no validated pattern matches",
        "Latest 'Odonata dragonfly' ruleset: ~6,900 football / ~1,900 basketball / ~1,500 tennis blind-validated rules, extended to EuroLeague (through 2026), WNBA, and a table-tennis audit (~75% blind)",
        "Ships daily and weekly digests per sport (time · teams · projected winner) and explains WHY a pick was made via a Qwen-powered chat bot; runs live on a self-managed VPS with systemd auto-restart",
      ],
    },
    {
      role: "Builder — Self-Hosting, Security & Automation",
      company: "Infrastructure (Contabo VPS, systemd, Hugging Face, Oracle Cloud)",
      years: "2026",
      bullets: [
        "Migrated all production services from Render to a self-managed Contabo VPS: systemd units with auto-restart, scheduled timers, and a Telegram-driven health watchdog (self-healing infra)",
        "Self-hosted a local Qwen3 4B LLM (llama.cpp) on the VPS as the always-on chat fallback, cutting cold-start latency from minutes to seconds",
        "Hardened production: encrypted service-to-service traffic, iptables/Cloudflare-WAF access control, and secure key handling (refresh tokens stored durably, never in plaintext env dumps)",
        "Distributed 148MB of media assets via a private Hugging Face dataset with a pull-on-deploy bundle so any host boots the full pipeline in one step",
        "Built API-integration plumbing across YouTube, Facebook, LinkedIn, Telegram, Gemini, HF Spaces, and cloud providers — all OAuth/key-rotated with automated health checks",
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
