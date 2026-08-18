// Discovery orchestrator: runs every scraper best-effort and returns normalized jobs.
const { getTargetCompanies } = require("./companies");
const { fetchCompanyBoard } = require("./ats");
const { fetchRemoteOK, fetchWeWorkRemotely } = require("./remote");
const { fetchAggregators, passesFilter, isFreshEnough } = require("./aggregators");
const { fetchLinkedInJobs } = require("./linkedin");

const CONCURRENCY = 6;

async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch (e) {
        results[idx] = null;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function discoverJobs() {
  const companies = getTargetCompanies();
  const logs = [];

  const boardTasks = companies.map((c) => async () => {
    try {
      const jobs = await fetchCompanyBoard(c);
      // KEYWORD PRE-FILTER on board jobs too: only AI/cloud/backend/automation
      // roles enter the pipeline — keeps auto-apply focused and the queue clean.
      const kept = jobs.filter((j) => passesFilter(j.title, ""));
      if (jobs.length) logs.push(`[Jobs] ${c.ats}:${c.slug} -> ${kept.length}/${jobs.length} kept`);
      else logs.push(`[Jobs] ${c.ats}:${c.slug} -> 0 jobs`);
      return kept;
    } catch (e) {
      logs.push(`[Jobs] ${c.ats}:${c.slug} skipped (${e.message})`);
      return [];
    }
  });

  const remoteTasks = [
    async () => {
      try {
        const jobs = await fetchRemoteOK();
        const kept = jobs.filter((j) => passesFilter(j.title, j.tags || "") && isFreshEnough(j.postedAt));
        if (jobs.length) logs.push(`[Jobs] remoteok -> ${kept.length}/${jobs.length} kept`);
        return kept;
      } catch (e) { logs.push(`[Jobs] remoteok skipped (${e.message})`); return []; }
    },
    async () => {
      try {
        const jobs = await fetchWeWorkRemotely();
        const kept = jobs.filter((j) => passesFilter(j.title, ""));
        if (jobs.length) logs.push(`[Jobs] weworkremotely -> ${kept.length}/${jobs.length} kept`);
        return kept;
      } catch (e) { logs.push(`[Jobs] weworkremotely skipped (${e.message})`); return []; }
    },
    async () => { try { return await fetchAggregators(); } catch (e) { logs.push(`[Jobs] aggregators skipped (${e.message})`); return []; } },
    async () => { try { return await fetchLinkedInJobs(); } catch (e) { logs.push(`[Jobs] linkedin skipped (${e.message})`); return []; } },
  ];

  const all = await runWithConcurrency([...boardTasks, ...remoteTasks], CONCURRENCY);
  for (const l of logs) console.log(l);
  const jobs = all.filter(Boolean).flat();
  const bySource = {};
  for (const j of jobs) bySource[j.source] = (bySource[j.source] || 0) + 1;
  console.log(`[Jobs] Discovered ${jobs.length} raw jobs — ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  return jobs;
}

module.exports = { discoverJobs };
