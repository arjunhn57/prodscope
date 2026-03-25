"use strict";

/**
 * coverage-tracker.js — Feature-level coverage tracking
 *
 * Tracks which feature categories have been explored, how deeply, and
 * whether they are saturated (no new screens discovered in recent visits).
 */

const {
  SATURATION_VISIT_THRESHOLD,
  SATURATION_STALE_WINDOW,
  COVERED_UNIQUE_SCREENS,
} = require("../config/defaults");

class CoverageTracker {
  constructor() {
    // feature → { visits, uniqueFingerprints: Set, recentFingerprints: [], status }
    this.categories = {};
  }

  /**
   * Record a screen visit under a feature category.
   * @param {string} feature - Feature category (e.g. "auth_flow", "browsing")
   * @param {string} exactFp - Exact fingerprint
   * @param {string} screenType - Classified screen type
   */
  recordVisit(feature, exactFp, screenType) {
    if (!this.categories[feature]) {
      this.categories[feature] = {
        visits: 0,
        uniqueFingerprints: new Set(),
        recentFingerprints: [],
        screenTypes: new Set(),
        status: "exploring",
      };
    }

    const cat = this.categories[feature];
    cat.visits++;
    cat.uniqueFingerprints.add(exactFp);
    cat.screenTypes.add(screenType);

    // Track recent fingerprints for staleness detection
    cat.recentFingerprints.push(exactFp);
    if (cat.recentFingerprints.length > SATURATION_STALE_WINDOW) {
      cat.recentFingerprints.shift();
    }

    // Update status
    if (cat.status !== "saturated") {
      if (this._isSaturated(cat)) {
        cat.status = "saturated";
      } else if (cat.uniqueFingerprints.size >= COVERED_UNIQUE_SCREENS) {
        cat.status = "covered";
      }
    }
  }

  /**
   * Check if a feature category is saturated (no new screens in recent visits).
   */
  isSaturated(feature) {
    const cat = this.categories[feature];
    if (!cat) return false;
    return cat.status === "saturated";
  }

  /**
   * Check if a feature has basic coverage.
   */
  isCovered(feature) {
    const cat = this.categories[feature];
    if (!cat) return false;
    return cat.status === "covered" || cat.status === "saturated";
  }

  /**
   * Return the least-covered feature category.
   */
  leastCoveredCategory() {
    let minVisits = Infinity;
    let result = null;

    for (const [feature, cat] of Object.entries(this.categories)) {
      if (cat.status !== "saturated" && cat.visits < minVisits) {
        minVisits = cat.visits;
        result = feature;
      }
    }

    return result;
  }

  /**
   * Return a compact summary for logging and LLM context.
   */
  summary() {
    const result = {};
    for (const [feature, cat] of Object.entries(this.categories)) {
      result[feature] = {
        visits: cat.visits,
        uniqueScreens: cat.uniqueFingerprints.size,
        status: cat.status,
      };
    }
    return result;
  }

  /**
   * Serialize for checkpoint persistence.
   */
  serialize() {
    const out = {};
    for (const [feature, cat] of Object.entries(this.categories)) {
      out[feature] = {
        visits: cat.visits,
        uniqueFingerprints: [...cat.uniqueFingerprints],
        recentFingerprints: cat.recentFingerprints,
        screenTypes: [...cat.screenTypes],
        status: cat.status,
      };
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _isSaturated(cat) {
    if (cat.visits < SATURATION_VISIT_THRESHOLD) return false;
    if (cat.recentFingerprints.length < SATURATION_STALE_WINDOW) return false;

    // Check if all recent fingerprints are already known
    const recentUnique = new Set(cat.recentFingerprints);
    for (const fp of recentUnique) {
      // If we saw something in the recent window that wasn't in the set before
      // the window started, it's not stale. But since we can't easily track
      // "before window," we use a simpler heuristic: if all recent fps are the
      // same 1-2 fingerprints, it's saturated.
      if (recentUnique.size <= 2) return true;
    }

    return false;
  }
}

module.exports = { CoverageTracker };
