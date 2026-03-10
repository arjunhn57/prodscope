/**
 * run.js — Main crawl loop orchestrator
 * Ties together all crawler modules into a single `runCrawl()` function
 * that replaces the inline crawl logic from index.js.
 *
 * Exports: runCrawl(config) → Promise<CrawlResult>
 */

const fs = require('fs');
const screen = require('./screen');
const fingerprint = require('./fingerprint');
const actions = require('./actions');
const policy = require('./policy');
const forms = require('./forms');
const graph = require('./graph');
const systemHandlers = require('./system-handlers');
const adb = require('./adb');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Execute an action on the device.
 * @param {object} action - Action object from actions.extract() or policy.choose()
 * @returns {string} Description of what was done
 */
function executeAction(action) {
  switch (action.type) {
    case actions.ACTION_TYPES.TAP:
      adb.tap(action.bounds.cx, action.bounds.cy);
      return `tap(${action.bounds.cx}, ${action.bounds.cy}) on "${action.text || action.resourceId || 'element'}"`;

    case actions.ACTION_TYPES.TYPE:
      adb.tap(action.bounds.cx, action.bounds.cy);
      return `focus field "${action.resourceId || 'edittext'}" (filling handled by forms module)`;

    case actions.ACTION_TYPES.SCROLL_DOWN:
      adb.swipe(540, 1600, 540, 800, 400);
      return 'scroll_down';

    case actions.ACTION_TYPES.SCROLL_UP:
      adb.swipe(540, 800, 540, 1600, 400);
      return 'scroll_up';

    case actions.ACTION_TYPES.BACK:
      adb.pressBack();
      return 'press_back';

    default:
      console.log(`  [run] Unknown action type: ${action.type}`);
      return `unknown(${action.type})`;
  }
}

/**
 * Run the crawl loop.
 *
 * @param {object} config
 * @param {string} config.screenshotDir - Directory to save screenshots
 * @param {string} config.packageName - App package name
 * @param {object} [config.credentials] - { username, password }
 * @param {string} [config.goldenPath] - User-provided golden path
 * @param {string} [config.goals] - Analysis goals
 * @param {string} [config.painPoints] - Known pain points
 * @param {number} [config.maxSteps=20] - Maximum crawl steps
 * @param {Function} [config.onProgress] - Called with (stepIndex, totalSteps)
 * @returns {Promise<CrawlResult>}
 *
 * @typedef {object} CrawlResult
 * @property {Array<object>} screens - Captured screen snapshots
 * @property {Array<object>} actionsTaken - Actions executed with outcomes
 * @property {object} graph - Serialized state graph
 * @property {string} stopReason - Why the crawl stopped
 * @property {Array<string>} reproPath - Ordered fingerprints for reproducibility
 */
async function runCrawl(config) {
  const {
    screenshotDir,
    packageName,
    credentials,
    goldenPath,
    goals,
    painPoints,
    maxSteps = 20,
    onProgress,
  } = config;

  console.log(`[crawler] Starting crawl for package=${packageName}, maxSteps=${maxSteps}`);
  console.log(`[crawler] Credentials provided: ${!!credentials}, goldenPath: ${!!goldenPath}`);

  const stateGraph = new graph.StateGraph();
  const screens = [];
  const actionsTaken = [];
  let stopReason = 'max_steps_reached';
  let consecutiveNoNewState = 0;
  const MAX_NO_NEW_STATE = 5;
  let formFilledOnce = false;
  let consecutiveDeviceFails = 0;
  const MAX_DEVICE_FAILS = 3;

  for (let step = 0; step < maxSteps; step++) {
    if (onProgress) onProgress(step, maxSteps);
    console.log(`\n[crawler] === Step ${step + 1}/${maxSteps} ===`);

    // 0. Device health check — abort early if emulator disappeared
    if (!adb.isDeviceOnline()) {
      consecutiveDeviceFails++;
      console.log(`  [crawler] Device offline (attempt ${consecutiveDeviceFails}/${MAX_DEVICE_FAILS})`);
      if (consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
        stopReason = 'device_offline';
        break;
      }
      await sleep(3000);
      continue;
    }
    consecutiveDeviceFails = 0;

    // 1. Capture current screen
    const snapshot = screen.capture(screenshotDir, step);
    if (!snapshot) {
      console.log('  [crawler] Screenshot capture failed, retrying...');
      await sleep(2000);
      continue;
    }
    screens.push(snapshot);

    // 2. Compute fingerprint
    const fp = fingerprint.compute(snapshot.xml);
    const isNew = !stateGraph.isVisited(fp);
    console.log(`  [crawler] Fingerprint: ${fp} (${isNew ? 'NEW' : 'visited ' + stateGraph.visitCount(fp) + 'x'}) activity=${snapshot.activity}`);

    // 3. Track new-state detection for stop condition
    if (isNew) {
      consecutiveNoNewState = 0;
    } else {
      consecutiveNoNewState++;
      if (consecutiveNoNewState >= MAX_NO_NEW_STATE) {
        console.log(`  [crawler] ${MAX_NO_NEW_STATE} consecutive steps with no new state — stopping`);
        stopReason = 'no_new_states';
        stateGraph.addState(fp, snapshot);
        break;
      }
    }

    // 4. Add state to graph
    stateGraph.addState(fp, snapshot);

    // 5. Handle system dialogs first
    const sysResult = systemHandlers.check(snapshot.xml);
    if (sysResult.handled) {
      actionsTaken.push({
        step,
        type: 'system_handler',
        handler: sysResult.handler,
        description: sysResult.action,
        fromFingerprint: fp,
      });
      await sleep(1500);
      continue; // re-capture after handling
    }

    // 6. Detect and fill forms (only if credentials provided and not already filled)
    if (credentials && !formFilledOnce) {
      const formResult = forms.detectForm(snapshot.xml);
      if (formResult.isForm) {
        console.log(`  [crawler] Login/signup form detected with ${formResult.fields.length} fields`);
        const fillActions = await forms.fillForm(formResult.fields, credentials, sleep);
        if (fillActions.length > 0) {
          formFilledOnce = true;
          actionsTaken.push({
            step,
            type: 'form_fill',
            fields: fillActions,
            fromFingerprint: fp,
          });
          await sleep(1000);

          // After filling, look for a submit button and tap it
          const submitXml = adb.dumpXml();
          const submitCandidates = actions.extract(submitXml);
          const submitBtn = submitCandidates.find(a =>
            a.type === actions.ACTION_TYPES.TAP &&
            /(login|sign.in|submit|continue|next|log.in)/i.test(`${a.text} ${a.contentDesc} ${a.resourceId}`)
          );
          if (submitBtn) {
            executeAction(submitBtn);
            actionsTaken.push({
              step,
              type: 'form_submit',
              description: `Tapped submit: "${submitBtn.text || submitBtn.resourceId}"`,
              fromFingerprint: fp,
            });
            console.log(`  [crawler] Tapped submit button after form fill`);
          }
          await sleep(2000);
          continue; // re-capture after form interaction
        }
      }
    }

    // 7. Extract candidate actions (filtering already-tried ones)
    const tried = stateGraph.triedActionsFor(fp);
    const candidates = actions.extract(snapshot.xml, tried);
    console.log(`  [crawler] ${candidates.length} candidate actions (${tried.size} already tried)`);

    // 8. Let policy choose the best action
    const decision = policy.choose(candidates, stateGraph, fp, {
      goldenPath,
      goals,
      painPoints,
    });

    if (decision.action.type === 'stop') {
      console.log(`  [crawler] Policy says stop: ${decision.reason}`);
      stopReason = decision.reason;
      break;
    }

    // 9. Execute the chosen action
    const description = executeAction(decision.action);
    console.log(`  [crawler] Executed: ${description} (reason: ${decision.reason})`);

    // 10. Record transition
    const actionKey = decision.action.key || description;
    actionsTaken.push({
      step,
      type: decision.action.type,
      description,
      reason: decision.reason,
      actionKey,
      fromFingerprint: fp,
    });

    // Wait for the screen to settle
    await sleep(2000);

    // Capture post-action fingerprint for the graph edge
    const postSnapshot = screen.capture(screenshotDir, `${step}_post`);
    if (postSnapshot) {
      const postFp = fingerprint.compute(postSnapshot.xml);
      stateGraph.addTransition(fp, actionKey, postFp);
    }
  }

  // Build result
  const result = {
    screens: screens.map(s => ({
      index: s.index,
      path: s.screenshotPath,
      activity: s.activity,
      timestamp: s.timestamp,
      xml: s.xml,
    })),
    actionsTaken,
    graph: stateGraph.toJSON(),
    stopReason,
    reproPath: stateGraph.history,
    stats: {
      totalSteps: screens.length,
      uniqueStates: stateGraph.uniqueStateCount(),
      totalTransitions: stateGraph.transitions.length,
    },
  };

  console.log(`\n[crawler] Crawl complete: ${result.stats.totalSteps} steps, ${result.stats.uniqueStates} unique states, stop reason: ${stopReason}`);

  // Save crawl artifacts
  const artifactPath = `${screenshotDir}/crawl_artifacts.json`;
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  console.log(`[crawler] Artifacts saved to ${artifactPath}`);

  return result;
}

module.exports = { runCrawl };
