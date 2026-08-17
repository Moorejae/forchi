// GROUNDING CORPUS — real accomplishments the job agent may reference.
// Sources: Agu_Victor_Chiedozie_Resum.pdf + V61-Odonata-BLUEPRINT.pdf (Flamchi)
//          + ForChi blueprints. The writer may TAILOR and REPHRASE these, but it
//          must NEVER invent projects, employers, numbers, or years.
// Every fact here is real and from the user's own documents.

const PORTFOLIO = [
  {
    project: "ForChi",
    role: "Designer & Builder",
    years: "2026 – present",
    url: null, // live 24/7 Telegram bot (no public web URL)
    facts: [
      "A trigger-only Node.js + LangChain agent on Telegram that runs deterministic automation workflows — including AI-generated posts to Facebook and LinkedIn triggered by text or voice commands.",
      "Built a three-tier LLM failover system cycling through Gemini keys and models, self-hosted Qwen, and Llama, to stay responsive under free-tier rate limits.",
      "Integrated self-hosted Whisper for voice transcription and FLUX for platform-specific AI image generation, deployed on containerized Hugging Face infrastructure.",
      "Shipped the whole thing on a $0 stack: Render hosting, HF ZeroGPU, live web-search grounding (Serper/Exa/Firecrawl), SQLite, sharp image normalization.",
    ],
  },
  {
    project: "Flamchi (V61 Odonata)",
    role: "Architect & Builder",
    years: "2026 – present",
    url: null, // live 24/7 Telegram bot (@Flamchbot)
    facts: [
      "A 24/7 sports-prediction Telegram bot (@Flamchbot) covering football, basketball (NBA/WNBA/NBB/EuroLeague/ACB), and tennis.",
      "Blind-validated engine: ~69.6% football, 66.8% NBA, 69.8% tennis on matches it never trained on; the capital-safe side hits ~86.6%.",
      "Uses data-driven association-rule mining plus an 'immune gate' — every rule must survive an untouched out-of-sample window or it is discarded — and a 'foraging' rule that refuses to predict when no validated pattern matches.",
      "Runs in production on Render + Hugging Face + a self-hosted Qwen LLM, with self-updating data pipelines.",
    ],
  },
  {
    project: "Project CLAY",
    role: "Solo Architect & Builder",
    years: "2026",
    url: null,
    facts: [
      "Designed and built a 21-container multi-agent architecture with working AI image generation, conversational handling, and automated social posting.",
      "Hit a real limitation in video-generation handling, evaluated it honestly, and retired the architecture in favor of a leaner, trigger-based design that directly informed ForChi.",
    ],
  },
  {
    project: "CloudVoid",
    role: "Founder & Lead Systems Architect",
    years: "2025 – present",
    url: "https://cloudvoid.online",
    facts: [
      "Built a non-custodial P2P crypto-to-fiat escrow and wallet platform: React frontend, Python and Node.js backend, PostgreSQL ledger, hosted on a zero-trust Kubernetes cluster on Oracle Cloud.",
      "Implemented an Aptos MoveVM escrow layer with pre-commit locking, trust-bond penalty logic, and gas abstraction via Paymaster sponsorship.",
      "Built a cryptographic 3-of-5 threshold arbitration system for autonomous on-chain dispute resolution, with the backend locked behind Cloudflare WAF and custom iptables rules.",
      "Set up self-healing infrastructure: a webhook-triggered watchdog tied to PM2 for automatic recovery and zero-downtime deploys.",
    ],
  },
  {
    project: "Footchristo (Sports Prediction Engine)",
    role: "Systems Developer",
    years: "2024 – 2026",
    url: null,
    facts: [
      "Built a sports prediction engine for football, basketball, and tennis using association-rule mining, discarding six earlier approaches that failed on unseen data before finding one that held up.",
      "Every rule is validated on a blind, never-touched data window before going live: 69.6% accuracy on football (vs. 43% baseline), 66.8% on NBA, 69.8% on tennis.",
      "Deployed as a live 24/7 Telegram bot on Render, Hugging Face, and a self-hosted LLM.",
    ],
  },
  {
    project: "Myzelva",
    role: "Founder & Builder",
    years: "2026 – present",
    url: "https://myzelva.com",
    facts: [
      "A prompt-engineering frontend website: a user describes what they want, and the AI asks clarifying questions, then tailors the perfect prompt for them.",
    ],
  },
];

module.exports = { PORTFOLIO };
