// Temp: inspect the img Space's gradio API endpoints + params.
(async () => {
  const base = "https://slymun-forchi-img.hf.space";
  const r = await fetch(base + "/gradio_api/info", { signal: AbortSignal.timeout(20000) });
  console.log("status:", r.status);
  const d = await r.json();
  const named = d.named_endpoints || d.api_name || {};
  for (const [name, info] of Object.entries(named)) {
    console.log("\nAPI:", name);
    console.log(JSON.stringify(info).slice(0, 900));
  }
  if (d.unnamed_endpoints) {
    console.log("\nunnamed:", JSON.stringify(d.unnamed_endpoints).slice(0, 300));
  }
  if (d.parameters) {
    console.log("\ntop params:", JSON.stringify(d.parameters).slice(0, 500));
  }
})();
