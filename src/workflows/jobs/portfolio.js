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
      "A trigger-only Node.js + LangChain agent on Telegram that runs deterministic automation workflows — AI-generated posts to Facebook and LinkedIn, a full YouTube video pipeline, and autonomous job applications — triggered by text or voice commands.",
      "Built an autonomous JOB-APPLICATION workflow: discovers remote intern/junior roles from LinkedIn + company ATS boards (Greenhouse, Lever, Ashby, Workable) + 4 aggregators, scores each with Gemini, writes a tailored resume + human-voice cover letter per job description, and auto-applies via the ATS APIs — with a daily Telegram digest.",
      "Built a three-tier LLM failover system cycling through Gemini keys and models, self-hosted Qwen, and Llama, to stay responsive under free-tier rate limits.",
      "Integrated self-hosted Whisper for voice transcription and FLUX/Gemini for AI image generation, deployed on containerized Hugging Face infrastructure.",
      "Shipped the whole thing on a $0 stack: Contabo VPS, HF ZeroGPU, live web-search grounding (Serper/Exa/Firecrawl), SQLite, sharp image normalization.",
    ],
  },
  {
    project: "Sirxlud — YouTube Automation (@sirxlud)",
    role: "Creator & Automation Engineer",
    years: "2026 – present",
    url: "https://www.youtube.com/@sirxlud",
    facts: [
      "A fully automated long-form YouTube channel: AI script generation with a 4-act retention structure and curiosity-gap 'Why' titles, voice-cloned narration (Higgs Audio v3 TTS, 'Victor Moore' persona), AI scene/image generation with a consistent narrator character, frame assembly, subtitles/captions, thumbnails, and auto-sorting into topic playlists.",
      "The pipeline posts up to 2 videos a day end-to-end (build + publish schedule), with self-healing retries per stage, OAuth re-auth watchers, and automated upload via the YouTube Data API v3 (upload, captions, thumbnails, playlists).",
      "Earlier Shorts pipeline posts ~5 AI-poem Shorts/day across romance, philosophy, and faith pillars with cloned voice + stock clips.",
    ],
  },
  {
    project: "CloudVoid",
    role: "Founder & Lead Systems Architect",
    years: "2025 – present",
    url: "https://cloudvoid.online",
    facts: [
      "Built a non-custodial multi-chain crypto wallet (15 chains: EVM, Bitcoin-family UTXO, Solana, Tron, Aptos, Stellar): Expo/React Native UI (web + Android APK) with a Node.js/Express backend on Oracle Cloud; private keys derived client-side so the server only sees public addresses.",
      "Implemented an encrypted 'Riverbed' frontend-backend envelope (P-256 ECDH + HKDF-SHA256 + AES-256-GCM) so every request is end-to-end encrypted, with Cloudflare WAF + custom iptables lockdown.",
      "Integrated real chain APIs (Alchemy, mempool.space, Blockchair, TronGrid, Aptos fullnode, Horizon) for live balances, real on-chain Send (local signing), and DEX Swap via the ParaSwap API with automatic token approval.",
      "Wired live prices from Binance + CoinGecko, real scannable QR codes, multi-wallet support with per-wallet encrypted seeds, Cloudflare Pages deploy + GitHub Actions APK release CI.",
      "Earlier platform work: P2P crypto-to-fiat escrow on Aptos MoveVM with pre-commit locking, trust-bond penalties, Paymaster gas abstraction, and a 3-of-5 threshold arbitration system.",
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
      "Myzelva is a live prompt-engineering website that helps users create high-end, production-grade prompts for whatever they want to build or create: they describe their goal, the AI asks clarifying questions, then tailors the perfect prompt for them.",
    ],
  },
];

module.exports = { PORTFOLIO };
