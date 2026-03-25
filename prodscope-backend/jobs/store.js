"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { DB_PATH } = require("../config/defaults");

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Schema — jobs table used now, rest created for Week 2+ tasks
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    step INTEGER DEFAULT 0,
    app_package TEXT,
    config JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    data JSON DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS crawl_sessions (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES jobs(id),
    started_at DATETIME,
    ended_at DATETIME,
    stats JSON,
    stop_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS screen_cache (
    fingerprint TEXT PRIMARY KEY,
    fuzzy_fingerprint TEXT,
    screen_type TEXT,
    element_count INTEGER,
    classified_by TEXT,
    app_package TEXT
  );

  CREATE TABLE IF NOT EXISTS coverage (
    session_id TEXT REFERENCES crawl_sessions(id),
    feature_category TEXT,
    screen_type TEXT,
    fingerprint TEXT,
    visit_count INTEGER DEFAULT 1,
    actions_available INTEGER,
    actions_tried INTEGER,
    status TEXT DEFAULT 'exploring'
  );

  CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES crawl_sessions(id),
    feature_type TEXT,
    sub_type TEXT,
    fingerprint TEXT,
    steps JSON,
    outcome TEXT,
    bug_found BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES crawl_sessions(id),
    type TEXT,
    severity TEXT,
    confidence REAL,
    title TEXT,
    description TEXT,
    screen_fingerprint TEXT,
    screenshot_path TEXT,
    detected_by TEXT,
    evidence JSON,
    reproduction_steps JSON
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    session_id TEXT,
    step INTEGER,
    data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_screen_cache_pkg ON screen_cache(app_package);
  CREATE INDEX IF NOT EXISTS idx_coverage_session ON coverage(session_id);
  CREATE INDEX IF NOT EXISTS idx_flows_session ON flows(session_id);
  CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmts = {
  insert: db.prepare(
    "INSERT INTO jobs (id, status, step, config, data) VALUES (?, ?, ?, ?, ?)"
  ),
  get: db.prepare("SELECT * FROM jobs WHERE id = ?"),
  update: db.prepare(
    "UPDATE jobs SET status = ?, step = ?, completed_at = ?, data = ? WHERE id = ?"
  ),
};

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["complete", "degraded", "failed"]);

function createJob(id, initialData) {
  const { status, step, ...rest } = initialData;
  stmts.insert.run(
    id,
    status || "queued",
    step ?? 0,
    JSON.stringify(rest._config || null),
    JSON.stringify(rest)
  );
}

function getJob(id) {
  const row = stmts.get.get(id);
  if (!row) return null;
  const data = JSON.parse(row.data || "{}");
  return {
    ...data,
    status: row.status,
    step: row.step,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function updateJob(id, fields) {
  const row = stmts.get.get(id);
  if (!row) return;

  const existing = JSON.parse(row.data || "{}");
  const newStatus = fields.status ?? row.status;
  const newStep = fields.step ?? row.step;

  // Auto-set completed_at on terminal status
  const completedAt =
    TERMINAL_STATUSES.has(newStatus) && !row.completed_at
      ? new Date().toISOString()
      : row.completed_at;

  // Merge non-column fields into the JSON blob
  const { status: _s, step: _st, ...rest } = fields;
  const newData = { ...existing, ...rest };

  stmts.update.run(newStatus, newStep, completedAt, JSON.stringify(newData), id);
}

module.exports = { createJob, getJob, updateJob, db };
