// Jobs workflow persistence — SQLite (default, data/jobs.db) OR PostgreSQL
// (persistent across Render redeploys) when JOBS_DATABASE_URL is set.
// Postgres is the durable option for a free-tier Render host whose disk resets
// on every deploy; SQLite stays as the zero-config fallback.
const path = require("path");
const fs = require("fs");

// Accept both spellings (JOBS_DATABASE_URL, and the misspelled JOBS_DATABASE_UR
// the user initially used) — but the value MUST be a postgresql:// DSN.
function getDbUrl() {
  return (process.env.JOBS_DATABASE_URL || process.env.JOBS_DATABASE_UR || "").trim();
}
const USE_PG = !!getDbUrl();
const dbFile = process.env.JOBS_DB_PATH || "./data/jobs.db";

let dbInstance = null;

const SQLITE_DDL = `
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
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs (source, company, title, url);
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      cover_letter TEXT,
      answers TEXT,
      resume_tailored TEXT,
      company_research TEXT,
      submitted INTEGER DEFAULT 0,
      response TEXT,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at);
    CREATE INDEX IF NOT EXISTS idx_app_applied ON applications (applied_at);
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      sent_at TEXT NOT NULL
    );
`;

const PG_DDL = `
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGSERIAL PRIMARY KEY,
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
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs (source, company, title, url);
    CREATE TABLE IF NOT EXISTS applications (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL UNIQUE,
      cover_letter TEXT,
      answers TEXT,
      resume_tailored TEXT,
      company_research TEXT,
      submitted INTEGER DEFAULT 0,
      response TEXT,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at);
    CREATE INDEX IF NOT EXISTS idx_app_applied ON applications (applied_at);
    CREATE TABLE IF NOT EXISTS emails (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL UNIQUE,
      sent_at TEXT NOT NULL
    );
`;

// Convert SQLite ? placeholders to Postgres $1, $2, ...
function pgParams(sql, params) {
  let i = 0;
  const text = String(sql).replace(/\?/g, () => `$${++i}`);
  return { text, values: params || [] };
}

async function openSqlite() {
  const sqlite3 = require("sqlite3");
  const { open } = require("sqlite");
  const dir = path.dirname(path.resolve(dbFile));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = await open({ filename: path.resolve(dbFile), driver: sqlite3.Database });
  await db.exec(SQLITE_DDL);
  console.log("[JobsDB] SQLite initialized at", path.resolve(dbFile));
  return {
    run: (...a) => db.run(...a),
    get: (...a) => db.get(...a),
    all: (...a) => db.all(...a),
    exec: (...a) => db.exec(...a),
    close: () => db.close(),
  };
}

async function openPostgres() {
  const dsn = getDbUrl();
  if (!/^postgres(ql)?:\/\//.test(dsn)) {
    throw new Error(
      "JOBS_DATABASE_URL is not a Postgres connection string. Expected postgresql://user:password@host:5432/db. " +
      `Got: ${dsn.slice(0, 40)}... (If this is a Neon 'https://...apirest.../rest/v1' URL, copy the CONNECTION STRING tab in the Neon dashboard instead — it includes your DB password.)`
    );
  }
  const { Client } = require("pg");

  // A dropped Postgres connection used to emit an UNHANDLED 'error' event that
  // crashed the ENTIRE process (killing the Telegram bot + the social auto-post
  // scheduler with it). We now attach an error handler so the process survives,
  // mark the socket dead, and reconnect lazily on the next query.
  let client = null;
  let connecting = null;

  async function connect() {
    // Fast path: existing healthy client.
    if (client && !client._forchiDead) {
      try {
        await client.query("SELECT 1"); // cheap liveness check (low query rate)
        return client;
      } catch (_) {
        client = null; // silently dead socket — reconnect below
      }
    }
    if (connecting) return connecting;
    connecting = (async () => {
      const c = new Client({
        connectionString: dsn,
        ssl: { rejectUnauthorized: false },
        statement_timeout: 30000,
        connectionTimeoutMillis: 15000,
      });
      // CRITICAL: without this handler, a dropped connection crashes the bot.
      c.on("error", (err) => {
        c._forchiDead = true;
        console.error(`[JobsDB] PostgreSQL connection dropped (process kept alive): ${err.message}`);
      });
      await c.connect();
      await c.query(PG_DDL);
      client = c;
      console.log("[JobsDB] PostgreSQL connected (persistent across deploys).");
      return c;
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  // Run an op against a live client; on a connection-type failure, reconnect
  // exactly once and retry so transient DB drops never fail the workflow.
  async function withClient(op) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = await connect();
      try {
        return await op(db);
      } catch (err) {
        lastErr = err;
        if (/ECONNRESET|ECONNREFUSED|socket|terminat|Connection|connection/i.test(err.message || "")) {
          client = null; // force a fresh connection and retry once
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  await connect();
  return {
    run: (sql, params) => withClient((db) => db.query(pgParams(sql, params)).then((r) => ({ changes: r.rowCount || 0 }))),
    get: (sql, params) => withClient((db) => db.query(pgParams(sql, params)).then((r) => r.rows[0])),
    all: (sql, params) => withClient((db) => db.query(pgParams(sql, params)).then((r) => r.rows)),
    exec: (sql) => withClient((db) => db.query(sql)),
    close: () => (client && !client._forchiDead ? client.end().catch(() => {}) : Promise.resolve()),
  };
}

async function getJobsDB() {
  if (dbInstance) return dbInstance;
  dbInstance = USE_PG ? await openPostgres() : await openSqlite();
  return dbInstance;
}

// Insert discovered jobs, ignoring duplicates. Returns count of NEW jobs added.
// Dedup is BOTH per-source (unique index) AND across sources (same url seen via
// e.g. Remotive + our Greenhouse board must never create two rows → never
// double-applied).
async function insertJobs(list) {
  const db = await getJobsDB();
  const now = new Date().toISOString();
  const insert = USE_PG
    ? `INSERT INTO jobs (source, ref_id, board, company, title, url, location, salary, description, posted_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
       ON CONFLICT (source, company, title, url) DO NOTHING`
    : `INSERT OR IGNORE INTO jobs (source, ref_id, board, company, title, url, location, salary, description, posted_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`;
  let added = 0;
  for (const j of list || []) {
    if (!j || !j.company || !j.title || !j.url) continue;
    const seen = await db.get(`SELECT 1 FROM jobs WHERE url = ?`, [j.url]);
    if (seen) continue;
    const r = await db.run(insert,
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
  return row ? Number(row.c) : 0;
}

// Record WHY a submission failed so /jobs status and diagnostics can show the
// real reason (previously the response was never stored — failures were opaque).
async function markApplyError(jobId, response) {
  const db = await getJobsDB();
  try {
    await db.run(`UPDATE applications SET response = ? WHERE job_id = ?`, [String(response || "").slice(0, 500), jobId]);
  } catch (e) {
    // applications row may not exist yet — fine, status still gets set
  }
  await setJobStatus(jobId, "failed");
}

async function countAppliedSince(iso) {
  const db = await getJobsDB();
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM applications WHERE submitted = 1 AND applied_at >= ?`,
    [iso]
  );
  return row ? Number(row.c) : 0;
}

async function markEmailSent(jobId) {
  const db = await getJobsDB();
  await db.run(
    `INSERT INTO emails (job_id, sent_at) VALUES (?, ?) ON CONFLICT (job_id) DO NOTHING`,
    [jobId, new Date().toISOString()]
  );
}

async function hasEmailSent(jobId) {
  const db = await getJobsDB();
  const row = await db.get(`SELECT 1 FROM emails WHERE job_id = ?`, [jobId]);
  return !!row;
}

async function countEmailsSent() {
  const db = await getJobsDB();
  const row = await db.get(`SELECT COUNT(*) AS c FROM emails`);
  return row ? Number(row.c) : 0;
}

// Cross-source "never handle the same job twice": true if a job with the same
// company + title (case-insensitive) was already emailed OR already applied to
// via ANY source (the same real role can be discovered by LinkedIn + a board).
async function hasSimilarHandled(company, title) {
  if (!company || !title) return false;
  const db = await getJobsDB();
  const row = await db.get(
    `SELECT 1 FROM emails e JOIN jobs j ON j.id = e.job_id
     WHERE LOWER(j.company) = LOWER(?) AND LOWER(j.title) = LOWER(?) LIMIT 1`,
    [company, title]
  );
  if (row) return true;
  const appRow = await db.get(
    `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.submitted = 1 AND LOWER(j.company) = LOWER(?) AND LOWER(j.title) = LOWER(?) LIMIT 1`,
    [company, title]
  );
  return !!appRow;
}

// Drop stale queued matches (> maxAgeDays) so the queue only holds fresh roles.
async function expireStaleMatched(maxAgeDays) {
  const db = await getJobsDB();
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const r = await db.run(
    `UPDATE jobs SET status = 'skipped', updated_at = ? WHERE status = 'matched' AND COALESCE(posted_at, created_at) < ?`,
    [new Date().toISOString(), cutoff]
  );
  const n = (r && r.changes) || 0;
  if (n) console.log(`[Jobs] Expired ${n} stale queued matches (> ${maxAgeDays}d).`);
  return n;
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
    totalJobs: total ? Number(total.c) : 0,
    applied: applied ? Number(applied.c) : 0,
    pendingApply: pending ? Number(pending.c) : 0,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r.c])),
  };
}

module.exports = {
  getJobsDB, insertJobs, getNewJobs, getJobsByStatus, getJobById,
  setJobStatus, setJobScore, storeApplication, getApplicationForJob,
  hasApplied, markApplied, markApplyError, countAppliedToday, countAppliedSince, getApplied, getStats,
  markEmailSent, hasEmailSent, countEmailsSent, hasSimilarHandled, expireStaleMatched,
};
