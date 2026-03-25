"use strict";

/**
 * checkpoint.js — Crawl checkpoint system
 *
 * Saves crawl state every N steps to SQLite so a crash mid-crawl
 * doesn't lose all progress. State can be restored to resume.
 */

const { db } = require("../jobs/store");

const saveStmt = db.prepare(
  "INSERT INTO checkpoints (session_id, step, data) VALUES (?, ?, ?)"
);

const restoreStmt = db.prepare(
  "SELECT data FROM checkpoints WHERE session_id = ? ORDER BY step DESC LIMIT 1"
);

const cleanupStmt = db.prepare(
  "DELETE FROM checkpoints WHERE session_id = ?"
);

/**
 * Save a crawl checkpoint.
 * @param {string} sessionId - Job or session ID
 * @param {number} step - Current step number
 * @param {object} state - Serializable crawl state
 */
function save(sessionId, step, state) {
  const data = {
    step,
    stateGraph: state.stateGraph,
    coverage: state.coverage,
    flows: state.flows,
    plan: state.plan || null,
    timestamp: Date.now(),
  };

  saveStmt.run(sessionId, step, JSON.stringify(data));
}

/**
 * Restore the most recent checkpoint for a session.
 * @param {string} sessionId
 * @returns {object|null} Parsed checkpoint data, or null if none
 */
function restore(sessionId) {
  const row = restoreStmt.get(sessionId);
  return row ? JSON.parse(row.data) : null;
}

/**
 * Delete all checkpoints for a session (cleanup after successful crawl).
 * @param {string} sessionId
 */
function cleanup(sessionId) {
  cleanupStmt.run(sessionId);
}

module.exports = { save, restore, cleanup };
