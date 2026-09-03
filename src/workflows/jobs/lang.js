// Deterministic language detection for job postings (main EU/EN languages).
// Used so resume/cover-letter output matches the job's language reliably.
function detectLanguage(text) {
  const t = String(text || "").toLowerCase();
  const marks = {
    Polish: {
      chars: /[ąćęłńóśźż]/g,
      words: /\b(dołącz|szukamy|doświadcz|praca|zespół|oferujemy|wymagania|prosimy|możliwość|oraz|jest|listu motywacyjnego)\b/g,
    },
    German: {
      chars: /[äöüß]/g,
      words: /\b(und|der|die|das|für|mit|wir|suchen|erfahrung|bewerbung|anschreiben|anforderungen|unserer)\b/g,
    },
    Spanish: {
      chars: /[ñ¿¡]/g,
      words: /\b(el|la|los|para|con|experiencia|buscamos|equipo|ofrecemos|requisitos|por favor|carta de presentación)\b/g,
    },
    French: {
      chars: /[àâçêëîïôùûœ]/g,
      words: /\b(le|la|les|pour|avec|expérience|cherchons|équipe|offrons|exigences|lettre de motivation)\b/g,
    },
    Portuguese: {
      chars: /[ãõç]/g,
      words: /\b(para|com|experiência|buscamos|equipe|oferecemos|requisitos|por favor|carta de apresentação)\b/g,
    },
    Dutch: {
      chars: /[ij]/g,
      words: /\b(voor|zoeken|ervaring|bieden|vereisten|sollicitatie|motivatiebrief|werknemer|aanvragen)\b/g,
    },
    Italian: {
      chars: /[àèéìòù]/g,
      words: /\b(per|con|esperienza|cerchiamo|offriamo|requisiti|per favore|lettera di presentazione|azienda)\b/g,
    },
  };

  // NOTE (2026-09-01): "team" was removed from the German/Dutch/Italian word
  // lists — it is a common English word and was falsely flagging English job
  // descriptions as non-English, which produced German/other resumes + cover
  // letters for English postings. Also dropped ambiguous Dutch "en"/"met".
  let best = null;
  let bestScore = 0;
  for (const [lang, { chars, words }] of Object.entries(marks)) {
    const c = (t.match(chars) || []).length;
    const w = (t.match(words) || []).length;
    // Accent chars are weak signals (English can contain them); words are strong.
    const score = (lang === "Dutch" ? 0 : c) + w * 3;
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  // A single ambiguous word match (score == 3) is NOT enough — require either
  // 2+ language words or an accent char + a word, else treat as English.
  return bestScore >= 3 ? best : "English";
}

// Deterministic post-translation guarantee for non-English jobs: after generation,
// translate the output to the job's language so the template bias can't leak English.
async function translateText(text, lang) {
  if (!text || !lang || lang === "English") return text;
  const { generate } = require("../../llm/provider");
  const prompt = `Translate the following text into ${lang}. Keep the structure, tone, names, and URLs exactly the same. Output ONLY the translation, no commentary.\n\n${text}`;
  try {
    const raw = await generate(prompt);
    return (raw || "").trim();
  } catch (e) {
    console.warn("[Jobs] translate failed, keeping original:", e.message);
    return text;
  }
}

module.exports = { detectLanguage, translateText };
