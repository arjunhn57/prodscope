/**
 * policy.js — Crawl policy / action selection
 * Decides what action to take given the current state, history, and user goals.
 * Never picks randomly — uses deterministic scoring and backtracking.
 */

const { ACTION_TYPES } = require('./actions');

/**
 * Boost an action's priority if it matches crawl guidance keywords.
 * @param {object} action
 * @param {object} guidance - { goldenPath, goals, painPoints }
 * @returns {number} Bonus priority
 */
function computeGuidanceBoost(action, guidance) {
  if (!guidance) return 0;

  const text = `${action.text || ''} ${action.contentDesc || ''} ${action.resourceId || ''}`.toLowerCase();
  if (!text.trim()) return 0;

  let boost = 0;
  const sources = [
    guidance.goldenPath,
    guidance.goals,
    guidance.painPoints,
  ].filter(Boolean);

  for (const source of sources) {
    const keywords = source.toLowerCase().split(/[\s,;|]+/).filter(w => w.length > 2);
    for (const kw of keywords) {
      if (text.includes(kw)) {
        boost += 15;
        break; // one boost per source
      }
    }
  }

  return boost;
}

/**
 * Choose the best action from candidates given graph state and guidance.
 *
 * Decision logic:
 * 1. If in a loop → backtrack (press back)
 * 2. If no untried actions available → backtrack
 * 3. Otherwise → highest-priority untried action, boosted by guidance keywords
 *
 * @param {Array<object>} candidates - Ranked actions from actions.extract()
 * @param {import('./graph').StateGraph} graph
 * @param {string} currentFingerprint
 * @param {object} config - { goldenPath, goals, painPoints, maxRevisits }
 * @returns {{ action: object, reason: string } | { action: { type: 'stop' }, reason: string }}
 */
function choose(candidates, graph, currentFingerprint, config = {}) {
  const maxRevisits = config.maxRevisits || 4;

  // Check: are we in a detected loop?
  if (graph.detectLoop(6, 2)) {
    console.log('  [policy] Loop detected — backtracking');
    return {
      action: { type: ACTION_TYPES.BACK, key: 'back' },
      reason: 'loop_detected',
    };
  }

  // Check: have we revisited this screen too many times?
  if (graph.visitCount(currentFingerprint) > maxRevisits) {
    console.log(`  [policy] Screen visited ${graph.visitCount(currentFingerprint)} times — backtracking`);
    return {
      action: { type: ACTION_TYPES.BACK, key: 'back' },
      reason: 'max_revisits_exceeded',
    };
  }

  // Filter to only untried actions on this screen
  const tried = graph.triedActionsFor(currentFingerprint);
  const untried = candidates.filter(a => !tried.has(a.key));

  if (untried.length === 0) {
    // All actions exhausted → check if we should stop or backtrack
    if (graph.uniqueStateCount() <= 1) {
      return {
        action: { type: 'stop' },
        reason: 'no_actions_available',
      };
    }
    console.log('  [policy] All actions tried on this screen — backtracking');
    return {
      action: { type: ACTION_TYPES.BACK, key: 'back' },
      reason: 'all_actions_exhausted',
    };
  }

  // Apply guidance boost
  const guidance = {
    goldenPath: config.goldenPath,
    goals: config.goals,
    painPoints: config.painPoints,
  };

  const boosted = untried.map(a => ({
    ...a,
    effectivePriority: a.priority + computeGuidanceBoost(a, guidance),
  }));

  // Sort by effective priority
  boosted.sort((a, b) => b.effectivePriority - a.effectivePriority);

  const chosen = boosted[0];
  const boostInfo = chosen.effectivePriority > chosen.priority
    ? ` (boosted from ${chosen.priority} to ${chosen.effectivePriority} by guidance)`
    : '';
  console.log(`  [policy] Chose: ${chosen.type} "${chosen.text || chosen.resourceId || ''}" priority=${chosen.effectivePriority}${boostInfo}`);

  return {
    action: chosen,
    reason: 'highest_priority_untried',
  };
}

module.exports = { choose, computeGuidanceBoost };
