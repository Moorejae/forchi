// Remote job boards (no company config needed). RemoteOK = JSON, WeWorkRemotely = RSS.
const { stripHtml, guessCompanyUrl } = require("./ats");

function normalize({ source, refId, company, title, url, location, salary, description, postedAt }) {
  return {
    source, refId, board: null, company, title, url,
    companyUrl: guessCompanyUrl(company),
    location: location || "Remote",
    salary: salary || null,
    description: stripHtml(description).slice(0, 12000),
    postedAt,
  };
}

// ── RemoteOK (public JSON; first element is metadata) ────────────────────────
async function fetchRemoteOK() {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ForChiJobs/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RemoteOK: HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data.slice(1) : [];
  return list.map((j) =>
    normalize({
      source: "remoteok",
      refId: String(j.id || ""),
      company: j.company || "?",
      title: j.position || "Untitled",
      url: j.url || "",
      salary: j.salary || null,
      description: (j.description || "") + " " + (j.tags || []).join(" "),
      postedAt: j.date || null,
    })
  );
}

// ── WeWorkRemotely (RSS; lightweight regex parse) ────────────────────────────
async function fetchWeWorkRemotely() {
  const res = await fetch("https://weworkremotely.com/categories/remote-programming-jobs.rss", {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WWR: HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 60) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const desc = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "";
    items.push(normalize({
      source: "weworkremotely",
      refId: link,
      company: title.split(":")[0].trim() || "?",
      title: title.split(":")[1] ? title.split(":")[1].trim() : title,
      url: link,
      description: desc,
    }));
  }
  if (!items.length) throw new Error("WWR: no items parsed");
  return items;
}

module.exports = { fetchRemoteOK, fetchWeWorkRemotely };
