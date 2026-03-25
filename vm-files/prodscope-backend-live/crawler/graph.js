/**
 * graph.js — Visited-state graph with loop detection
 * Tracks every screen the crawler visits as a node (keyed by fingerprint)
 * and every action as a directed edge. Provides loop detection and
 * backtrack target computation.
 */

class StateGraph {
  constructor() {
    /** Map<fingerprint, { screenData, visitCount, triedActions: Set<string> }> */
    this.nodes = new Map();
    /** Array<{ from, action, to, timestamp }> */
    this.transitions = [];
    /** Ordered list of fingerprints visited (with repeats) */
    this.history = [];
  }

  /**
   * Register a state. If already visited, increments visit count.
   * @param {string} fingerprint
   * @param {object} screenData - { screenshotPath, xml, activity, ... }
   */
  addState(fingerprint, screenData) {
    if (this.nodes.has(fingerprint)) {
      const node = this.nodes.get(fingerprint);
      node.visitCount++;
    } else {
      this.nodes.set(fingerprint, {
        screenData,
        visitCount: 1,
        triedActions: new Set(),
      });
    }
    this.history.push(fingerprint);
  }

  /**
   * Record an action taken from one state leading to another.
   */
  addTransition(fromFingerprint, actionKey, toFingerprint) {
    this.transitions.push({
      from: fromFingerprint,
      action: actionKey,
      to: toFingerprint,
      timestamp: Date.now(),
    });

    // Mark this action as tried on the source state
    const node = this.nodes.get(fromFingerprint);
    if (node) node.triedActions.add(actionKey);
  }

  /** Check whether a fingerprint has been visited. */
  isVisited(fingerprint) {
    return this.nodes.has(fingerprint);
  }

  /** Get the visit count for a fingerprint. */
  visitCount(fingerprint) {
    const node = this.nodes.get(fingerprint);
    return node ? node.visitCount : 0;
  }

  /** Get the set of already-tried action keys for a given state. */
  triedActionsFor(fingerprint) {
    const node = this.nodes.get(fingerprint);
    return node ? node.triedActions : new Set();
  }

  /**
   * Detect if the crawler is stuck in a loop.
   * Returns true if the last `windowSize` states contain `threshold` or fewer
   * unique fingerprints (meaning the crawler is cycling between 1-2 screens).
   */
  detectLoop(windowSize = 6, threshold = 2) {
    if (this.history.length < windowSize) return false;
    const recent = this.history.slice(-windowSize);
    const unique = new Set(recent);
    return unique.size <= threshold;
  }

  /**
   * Find a backtrack target — the most recent state in history that still
   * has untried actions, excluding the current state.
   * Returns the fingerprint or null.
   */
  getBacktrackTarget(currentFingerprint) {
    // Walk history backwards looking for a state with untried potential
    for (let i = this.history.length - 1; i >= 0; i--) {
      const fp = this.history[i];
      if (fp === currentFingerprint) continue;
      // We can't really know if it has untried actions without re-extracting XML,
      // but we can check if it was visited fewer times
      const node = this.nodes.get(fp);
      if (node && node.visitCount < 3) return fp;
    }
    return null;
  }

  /** Total unique states discovered. */
  uniqueStateCount() {
    return this.nodes.size;
  }

  /** Serialize the graph for crawl artifacts. */
  toJSON() {
    const nodes = [];
    for (const [fp, data] of this.nodes) {
      nodes.push({
        fingerprint: fp,
        activity: data.screenData?.activity || 'unknown',
        screenshotPath: data.screenData?.screenshotPath || null,
        visitCount: data.visitCount,
        triedActions: Array.from(data.triedActions),
      });
    }
    return {
      nodes,
      transitions: this.transitions,
      totalSteps: this.history.length,
      uniqueStates: this.nodes.size,
    };
  }
}

module.exports = { StateGraph };
