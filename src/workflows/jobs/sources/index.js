// Discovery orchestrator: runs every scraper best-effort and returns normalized jobs.
const { getTargetCompanies } = require("./companies");
const { fetchCompanyBoard } = require("./ats");
const { fetchRemoteOK, fetchWeWorkRemotely } = require("./remote");

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
      if (!jobs.length) logs.push(`[Jobs] ${c.ats}:${c.slug} -> 0 jobs`);
      return jobs;
    } catch (e) {
      logs.push(`[Jobs] ${c.ats}:${c.slug} skipped (${e.message})`);
      return [];
    }
  });

  const remoteTasks = [
    async () => { try { return await fetchRemoteOK(); } catch (e) { logs.push(`[Jobs] remoteok skipped (${e.message})`); return []; } },
    async () => { try { return await fetchWeWorkRemotely(); } catch (e) { logs.push(`[Jobs] weworkremotely skipped (${e.message})`); return []; } },
  ];

  const all = await runWithConcurrency([...boardTasks, ...remoteTasks], CONCURRENCY);
  for (const l of logs) console.log(l);
  const jobs = all.filter(Boolean).flat();
  console.log(`[Jobs] Discovered ${jobs.length} raw jobs across ${companies.length} companies + remote boards.`);
  return jobs;
}

module.exports = { discoverJobs };
