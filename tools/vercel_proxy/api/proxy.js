export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, endpoint, payload } = req.body || {};
  if (!token || !endpoint || !payload) {
    return res.status(400).json({ error: "Missing token, endpoint, or payload" });
  }

  const tgUrl = `https://api.telegram.org/bot${token}/${endpoint}`;

  try {
    const r = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
