"use strict";

const path = require("path");

module.exports = {
  PORT: process.env.PORT || 8080,
  USE_CRAWLER_V1: process.env.USE_CRAWLER_V1 !== "false",
  SKIP_AI_FOR_TESTS: process.env.SKIP_AI_FOR_TESTS === "true",
  UPLOAD_DEST: "/tmp/uploads/",
  SCREENSHOT_DIR_PREFIX: "/tmp/screenshots-",
  MAX_CRAWL_STEPS: 60,
  EMULATOR_AVD: "prodscope-test",
  SNAPSHOT_NAME: process.env.SNAPSHOT_NAME || "prodscope-ready",
  SNAPSHOT_BOOT_TIMEOUT: 30,   // seconds — snapshot restore should be fast
  COLD_BOOT_TIMEOUT: 240,      // seconds — fallback if no snapshot
  ANALYSIS_MODEL: "claude-haiku-4-5-20251001",
  REPORT_MODEL: "claude-sonnet-4-20250514",
  DB_PATH: process.env.DB_PATH || path.join(__dirname, "..", "data", "prodscope.db"),

  // Coverage thresholds
  SATURATION_VISIT_THRESHOLD: 4,  // min visits before a feature can be saturated
  SATURATION_STALE_WINDOW: 3,     // consecutive visits with no new fingerprints = saturated
  COVERED_UNIQUE_SCREENS: 2,      // unique screens needed for "covered" status

  // Oracle/triage thresholds (Week 4)
  MAX_AI_TRIAGE_SCREENS: 8,       // max screens sent to AI vision analysis
  ACCESSIBILITY_MIN_TAP_DP: 48,   // minimum tap target size in dp
  SLOW_RESPONSE_THRESHOLD_MS: 3000, // screen transition > 3s = slow
};
