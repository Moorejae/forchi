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
    "I build cloud infrastructure and AI systems, alone or with a team. I build fast, usually in days rather than months. Security is part of the design from day one, not added later.",
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
  // The agent hunts for these kinds of roles (locked in the blueprint).
  targetRoles: [
    "AI / LLM Engineer",
    "Cloud / DevOps Engineer",
    "Automation Engineer",
    "Backend Developer (Node.js / Python)",
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
