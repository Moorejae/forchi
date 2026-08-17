// Jobs workflow persistence — SQLite tables for discovered jobs and applications.
// Separate file (data/jobs.db) so it never locks the social DB.
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const fs = require("fs");

const dbFile = process.env.JOBS_DB_PATH || "./data/jobs.db";

let dbInstance = null;

async function getJobsDB() {
  if (dbInstance) return dbInstance;
  const dir = path.dirname(path.resolve(dbFile));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  dbInstance = await open({ filename: path.resolve(dbFile), driver: sqlite3.Database });
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      ref_id TEXT,
      board TEXT,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      location TEXT,
      salary TEXT,
      description TEXT,
      posted_at TEXT,
      match_score INTEGER,
      status TEXT NOT NULL DEFAULT 'new',   -- new | matched | applied | skipped | archived | failed
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs (source, company, title, url);

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,        -- HARD RULE: never apply to the same job twice
      cover_letter TEXT,
      answers TEXT,                           -- JSON array of screening-question answers
      resume_tailored TEXT,
      company_research TEXT,
      submitted INTEGER DEFAULT 0,
      response TEXT,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at);
    CREATE INDEX IF NOT EXISTS idx_app_applied ON applications (applied_at);
  `);
  console.log("[JobsDB] Initialized at", path.resolve(dbFile));
  return dbInstance;
}

// Insert discovered jobs, ignoring duplicates. Returns count of NEW jobs added.
// Dedup is BOTH per-source (unique index) AND across sources (same url seen via
// e.g. Remotive + our Greenhouse board must never create two rows → never
// double-applied).
async function insertJobs(list) {
  const db = await getJobsDB();
  const now = new Date().toISOString();
  let added = 0;
  for (const j of list || []) {
    if (!j || !j.company || !j.title || !j.url) continue;
    const seen = await db.get(`SELECT 1 FROM jobs WHERE url = ?`, [j.url]);
    if (seen) continue;
    const r = await db.run(
      `INSERT OR IGNORE INTO jobs (source, ref_id, board, company, title, url, location, salary, description, posted_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      [j.source || "?", j.refId || null, j.board || null, j.company, j.title, j.url, j.location || null,
       j.salary || null, j.description || null, j.posted_at || null, now]
    );
    if (r.changes && r.changes > 0) added++;
  }
  return added;
}

async function getNewJobs(limit = 50) {
  const db = await getJobsDB();
  return db.all(`SELECT * FROM jobs WHERE status = 'new' ORDER BY id DESC LIMIT ?`, [limit]);
}

async function getJobsByStatus(status, limit = 50) {
  const db = await getJobsDB();
  return db.all(`SELECT * FROM jobs WHERE status = ? ORDER BY id DESC LIMIT ?`, [status, limit]);
}

async function getJobById(id) {
  const db = await getJobsDB();
  return db.get(`SELECT * FROM jobs WHERE id = ?`, [id]);
}

async function setJobStatus(id, status) {
  const db = await getJobsDB();
  await db.run(`UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?`, [status, new Date().toISOString(), id]);
}

async function setJobScore(id, score) {
  const db = await getJobsDB();
  await db.run(`UPDATE jobs SET match_score = ?, updated_at = ? WHERE id = ?`, [score, new Date().toISOString(), id]);
}

// Store a prepared application (never applied yet). job_id UNIQUE enforces never-twice.
async function storeApplication({ jobId, coverLetter, answers, resumeTailored, companyResearch }) {
  const db = await getJobsDB();
  await db.run(
    `INSERT INTO applications (job_id, cover_letter, answers, resume_tailored, company_research, submitted)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(job_id) DO UPDATE SET
       cover_letter = excluded.cover_letter,
       answers = excluded.answers,
       resume_tailored = excluded.resume_tailored,
       company_research = excluded.company_research`,
    [jobId, coverLetter || null, answers ? JSON.stringify(answers) : null, resumeTailored || null, companyResearch || null]
  );
}

async function getApplicationForJob(jobId) {
  const db = await getJobsDB();
  return db.get(`SELECT * FROM applications WHERE job_id = ?`, [jobId]);
}

async function hasApplied(jobId) {
  const db = await getJobsDB();
  const row = await db.get(`SELECT submitted, applied_at FROM applications WHERE job_id = ?`, [jobId]);
  return !!row && !!row.submitted;
}

async function markApplied(jobId, response) {
  const db = await getJobsDB();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE applications SET submitted = 1, response = ?, applied_at = ? WHERE job_id = ?`,
    [response || null, now, jobId]
  );
  await setJobStatus(jobId, "applied");
}

async function countAppliedToday() {
  const db = await getJobsDB();
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM applications WHERE submitted = 1 AND applied_at >= ?`,
    [start.toISOString()]
  );
  return row ? row.c : 0;
}

async function countAppliedSince(iso) {
  const db = await getJobsDB();
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM applications WHERE submitted = 1 AND applied_at >= ?`,
    [iso]
  );
  return row ? row.c : 0;
}

async function getApplied() {
  const db = await getJobsDB();
  return db.all(
    `SELECT j.id, j.company, j.title, j.url, j.match_score, a.applied_at, a.response
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.submitted = 1 ORDER BY a.applied_at DESC LIMIT 50`
  );
}

async function getStats() {
  const db = await getJobsDB();
  const total = await db.get(`SELECT COUNT(*) AS c FROM jobs`);
  const byStatus = await db.all(`SELECT status, COUNT(*) AS c FROM jobs GROUP BY status`);
  const bySource = await db.all(`SELECT source, COUNT(*) AS c FROM jobs GROUP BY source`);
  const applied = await db.get(`SELECT COUNT(*) AS c FROM applications WHERE submitted = 1`);
  const pending = await db.get(`SELECT COUNT(*) AS c FROM jobs WHERE status = 'matched'`);
  return {
    totalJobs: total ? total.c : 0,
    applied: applied ? applied.c : 0,
    pendingApply: pending ? pending.c : 0,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r.c])),
  };
}

module.exports = {
  getJobsDB, insertJobs, getNewJobs, getJobsByStatus, getJobById,
  setJobStatus, setJobScore, storeApplication, getApplicationForJob,
  hasApplied, markApplied, countAppliedToday, getApplied, getStats,
};
