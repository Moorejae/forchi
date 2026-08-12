const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DATABASE_PATH || "./data/forchi.db";

let dbInstance = null;

async function getDB() {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Initialize SQLite tables if not existing
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      theme TEXT NOT NULL,
      destinations TEXT NOT NULL,
      days_total INTEGER DEFAULT 30,
      days_completed INTEGER DEFAULT 0,
      start_date TEXT NOT NULL,
      next_run TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );
  `);

  console.log(`[SQLite DB] Storage initialized at ${dbPath}`);
  return dbInstance;
}

async function createCampaign({ theme, destinations, daysTotal = 30 }) {
  const db = await getDB();
  const now = new Date().toISOString();
  const destJson = JSON.stringify(destinations);

  const res = await db.run(
    `INSERT INTO campaigns (theme, destinations, days_total, days_completed, start_date, next_run, active)
     VALUES (?, ?, ?, 0, ?, ?, 1)`,
    [theme, destJson, daysTotal, now, now]
  );

  return res.lastID;
}

async function getDueCampaigns() {
  const db = await getDB();
  const now = new Date().toISOString();

  const rows = await db.all(
    `SELECT * FROM campaigns WHERE active = 1 AND next_run <= ?`,
    [now]
  );

  return rows.map((r) => ({
    ...r,
    destinations: JSON.parse(r.destinations)
  }));
}

async function advanceCampaign(id) {
  const db = await getDB();
  const row = await db.get(`SELECT * FROM campaigns WHERE id = ?`, [id]);
  if (!row) return;

  const nextCompleted = row.days_completed + 1;
  const isActive = nextCompleted < row.days_total ? 1 : 0;

  // Set next_run += 1 day (24 hours)
  const currentRunDate = new Date(row.next_run);
  currentRunDate.setDate(currentRunDate.getDate() + 1);
  const nextRunIso = currentRunDate.toISOString();

  await db.run(
    `UPDATE campaigns 
     SET days_completed = ?, next_run = ?, active = ?
     WHERE id = ?`,
    [nextCompleted, nextRunIso, isActive, id]
  );

  console.log(`[SQLite DB] Campaign #${id} advanced to ${nextCompleted}/${row.days_total} days.`);
}

module.exports = {
  getDB,
  createCampaign,
  getDueCampaigns,
  advanceCampaign
};
