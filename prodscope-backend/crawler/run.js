/**
 * run.js - Main crawl loop orchestrator
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
const { detectScreenIntent } = require('./screen-intent');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function getPrimaryPackage(xml) {
  if (!xml) return '';
  const matches = [...xml.matchAll(/package="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  if (!matches.length) return '';
  const counts = {};
  for (const pkg of matches) counts[pkg] = (counts[pkg] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function isAllowedNonTargetPackage(pkg) {
  if (!pkg) return true;
  if (pkg === 'android') return true;
  if (pkg === 'com.android.permissioncontroller') return true;
  if (pkg === 'com.google.android.gms') return true;
  return false;
}

function isTransientEmptyXml(xml) {
  if (!xml) return true;
  const trimmed = String(xml).trim();
  if (!trimmed) return true;
  if (/null root node returned by UiTestAutomationBridge/i.test(trimmed)) return true;
  if (/^ERROR:/i.test(trimmed)) return true;
  return false;
}

function authSubmitScore(action) {
  const haystack = `${action.text || ''} ${action.contentDesc || ''} ${action.resourceId || ''}`.toLowerCase();
  const cls = (action.className || '').toLowerCase();

  if (/(sign in|signin|log in|login)/i.test(haystack)) return 130;
  if (/(continue|next|submit|done|finish|verify|confirm|get started|start)/i.test(haystack)) return 110;
  if (/(sign up|signup|create account|register)/i.test(haystack)) return 90;
  if (cls.includes('button') && haystack.trim()) return 80;
  if (action.type === actions.ACTION_TYPES.TAP && haystack.trim()) return 60;
  return 0;
}

function findBestAuthSubmitAction(candidates) {
  const submitCandidates = candidates.filter((a) => {
    if (a.type !== actions.ACTION_TYPES.TAP) return false;
    const haystack = `${a.text || ''} ${a.contentDesc || ''} ${a.resourceId || ''}`.toLowerCase();
    return /(sign up|signup|create account|register|sign in|signin|log in|login|continue|next|submit|done|finish|verify|confirm|get started|start)/i.test(haystack);
  });

  if (!submitCandidates.length) return null;

  submitCandidates.sort((a, b) => authSubmitScore(b) - authSubmitScore(a));
  return submitCandidates[0];
}

function makeAuthSubmitKey(action) {
  return (
    action.text ||
    action.resourceId ||
    action.contentDesc ||
    'auth_submit_unknown'
  )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasValidationErrorText(xml) {
  if (!xml) return false;
  return /(invalid|required|already exists|already registered|password must|enter a valid|try again|error|incorrect|failed|unable|not available)/i.test(xml);
}

async function captureStableScreen(screenshotDir, index, maxRetries = 3, retryDelayMs = 2000) {
  let snapshot = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    snapshot = screen.capture(screenshotDir, index);

    if (!snapshot || snapshot.error === 'capture_failed' || snapshot.error === 'device_offline') {
      return snapshot;
    }

    if (!isTransientEmptyXml(snapshot.xml)) {
      return snapshot;
    }

    console.log(`  [crawler] Transient empty/null XML on capture ${index} (attempt ${attempt + 1}/${maxRetries + 1})`);
    if (attempt < maxRetries) {
      await sleep(retryDelayMs);
    }
  }

  return snapshot;
}

async function relaunchTargetApp(packageName) {
  console.log(`  [crawler] Relaunching target app: ${packageName}`);
  adb.pressBack();
  await sleep(1000);
  adb.pressBack();
  await sleep(1000);
  adb.run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
  await sleep(5000);
}

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

  let consecutiveDeviceFails = 0;
  const MAX_DEVICE_FAILS = 3;

  let consecutiveCaptureFails = 0;
  const MAX_CAPTURE_FAILS = 3;

  const handledFormScreens = new Set();
  const filledFingerprints = new Set();

  let authFillCount = 0;
  const MAX_AUTH_FILLS = 5;

  let outOfAppRecoveries = 0;
  const MAX_OUT_OF_APP_RECOVERIES = 4;

  let authFlowActive = false;
  let authFlowStepsRemaining = 0;
  const AUTH_FLOW_MAX_STEPS = 8;

  let lastAuthSubmitKey = null;
  let consecutiveSameAuthSubmit = 0;
  const MAX_SAME_AUTH_SUBMIT = 3;

  for (let step = 0; step < maxSteps; step++) {
    if (onProgress) onProgress(step, maxSteps);
    console.log(`\n[crawler] === Step ${step + 1}/${maxSteps} ===`);

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

    const snapshot = await captureStableScreen(screenshotDir, step, 3, 2000);

    if (!snapshot || snapshot.error === 'capture_failed') {
      consecutiveCaptureFails++;
      console.log(`  [crawler] Screenshot capture failed (${consecutiveCaptureFails}/${MAX_CAPTURE_FAILS})`);
      if (consecutiveCaptureFails >= MAX_CAPTURE_FAILS) {
        stopReason = 'capture_failed';
        break;
      }
      await sleep(2000);
      continue;
    }

    if (snapshot.error === 'device_offline') {
      consecutiveDeviceFails++;
      console.log(`  [crawler] Device lost during capture (${consecutiveDeviceFails}/${MAX_DEVICE_FAILS})`);
      if (consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
        stopReason = 'device_offline';
        break;
      }
      await sleep(3000);
      continue;
    }

    consecutiveCaptureFails = 0;
    consecutiveDeviceFails = 0;
    screens.push(snapshot);

    const primaryPackage = getPrimaryPackage(snapshot.xml);
    console.log(`  [crawler] Primary package: ${primaryPackage || 'unknown'}`);

    const screenIntent = detectScreenIntent(snapshot.xml);
    console.log(`  [intent] type=${screenIntent.type} confidence=${screenIntent.confidence}`);

    const sysResult = systemHandlers.check(snapshot.xml);
    if (sysResult.handled) {
      actionsTaken.push({
        step,
        type: 'system_handler',
        handler: sysResult.handler,
        description: sysResult.action,
      });
      await sleep(1500);
      continue;
    }

    if (primaryPackage && primaryPackage !== packageName && !isAllowedNonTargetPackage(primaryPackage)) {
      outOfAppRecoveries++;
      console.log(`  [crawler] Out-of-app screen detected: ${primaryPackage} (target=${packageName})`);

      if (outOfAppRecoveries > MAX_OUT_OF_APP_RECOVERIES) {
        stopReason = 'left_target_app';
        break;
      }

      await relaunchTargetApp(packageName);
      continue;
    }

    outOfAppRecoveries = 0;

    const fp = fingerprint.compute(snapshot.xml);
    const isNew = !stateGraph.isVisited(fp);

    console.log(
      `  [crawler] Fingerprint: ${fp} (${isNew ? 'NEW' : 'visited ' + stateGraph.visitCount(fp) + 'x'}) activity=${snapshot.activity}`,
    );

    if (authFlowActive) {
      if (screenIntent.type.startsWith('auth') || screenIntent.type.includes('login') || screenIntent.type.includes('signup') || screenIntent.type === 'email_entry' || screenIntent.type === 'phone_entry' || screenIntent.type === 'otp_verification') {
        authFlowStepsRemaining = AUTH_FLOW_MAX_STEPS;
        console.log('  [crawler] Auth flow still active');
      } else {
        authFlowStepsRemaining--;
        if (authFlowStepsRemaining <= 0) {
          authFlowActive = false;
          lastAuthSubmitKey = null;
          consecutiveSameAuthSubmit = 0;
          console.log('  [crawler] Auth flow expired');
        }
      }
    }

    if (isNew) {
      consecutiveNoNewState = 0;
    } else {
      consecutiveNoNewState++;
      if (consecutiveNoNewState >= MAX_NO_NEW_STATE) {
        console.log(`  [crawler] ${MAX_NO_NEW_STATE} consecutive steps with no new state - stopping`);
        stopReason = 'no_new_states';
        stateGraph.addState(fp, snapshot);
        break;
      }
    }

    stateGraph.addState(fp, snapshot);

    if (credentials && authFillCount < MAX_AUTH_FILLS) {
      const formResult = forms.detectForm(snapshot.xml);

      if (formResult.isForm) {
        const formKey = `${fp}::${formResult.fields.map((f) => f.type).sort().join('|')}`;

        if (!handledFormScreens.has(formKey)) {
          console.log(`  [crawler] Login/signup form detected with ${formResult.fields.length} fields`);

          const fillActions = await forms.fillForm(formResult.fields, credentials, sleep);

          if (fillActions.length > 0) {
            handledFormScreens.add(formKey);
            filledFingerprints.add(fp);
            authFillCount++;
            authFlowActive = true;
            authFlowStepsRemaining = AUTH_FLOW_MAX_STEPS;

            actionsTaken.push({
              step,
              type: 'form_fill',
              fields: fillActions,
              fromFingerprint: fp,
            });

            await sleep(1000);

            const submitXml = adb.dumpXml();
            const submitCandidates = actions.extract(submitXml);
            const submitBtn = findBestAuthSubmitAction(submitCandidates);

            if (submitBtn) {
              const submitKey = makeAuthSubmitKey(submitBtn);

              if (submitKey === lastAuthSubmitKey) {
                consecutiveSameAuthSubmit++;
              } else {
                lastAuthSubmitKey = submitKey;
                consecutiveSameAuthSubmit = 1;
              }

              const submitDescription = executeAction(submitBtn);

              actionsTaken.push({
                step,
                type: 'form_submit',
                description: `Tapped submit: "${submitBtn.text || submitBtn.resourceId}"`,
                fromFingerprint: fp,
              });

              console.log(`  [crawler] ${submitDescription}`);
              console.log('  [crawler] Tapped submit button after form fill');

              if (consecutiveSameAuthSubmit >= MAX_SAME_AUTH_SUBMIT) {
                const xmlNow = adb.dumpXml() || '';
                if (hasValidationErrorText(xmlNow)) {
                  console.log('  [crawler] Validation error detected after repeated auth submit');
                  stopReason = 'auth_validation_error';
                  break;
                }

                console.log('  [crawler] Repeated semantic auth submit loop detected after form fill');
                stopReason = 'auth_submit_loop';
                break;
              }
            } else {
              console.log('  [crawler] No auth submit button found after form fill');
            }

            if (!adb.ensureDeviceReady()) {
              consecutiveDeviceFails++;
              console.log(`  [crawler] Device not ready after form submit (${consecutiveDeviceFails}/${MAX_DEVICE_FAILS})`);
              if (consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
                stopReason = 'device_offline';
                break;
              }
            }

            await sleep(2500);
            continue;
          }
        }
      }
    }

    const tried = stateGraph.triedActionsFor(fp);
    let candidates = actions.extract(snapshot.xml, tried);

    if (screenIntent.type === 'auth_choice' || screenIntent.type === 'phone_entry' || screenIntent.type === 'email_entry') {
      const authSubmit = findBestAuthSubmitAction(candidates);
      if (authSubmit) {
        candidates = [authSubmit, ...candidates.filter((a) => a.key !== authSubmit.key)];
        console.log(`  [intent] Prioritizing auth CTA for ${screenIntent.type}`);
      }
    }

    if (filledFingerprints.has(fp) || authFlowActive || screenIntent.type.startsWith('auth') || screenIntent.type.includes('login') || screenIntent.type.includes('signup') || screenIntent.type === 'email_entry' || screenIntent.type === 'phone_entry' || screenIntent.type === 'otp_verification') {
      const authSubmit = findBestAuthSubmitAction(candidates);

      if (authSubmit) {
        const authKey = makeAuthSubmitKey(authSubmit);

        if (authKey === lastAuthSubmitKey) {
          consecutiveSameAuthSubmit++;
        } else {
          lastAuthSubmitKey = authKey;
          consecutiveSameAuthSubmit = 1;
        }

        if (consecutiveSameAuthSubmit >= MAX_SAME_AUTH_SUBMIT) {
          if (hasValidationErrorText(snapshot.xml)) {
            console.log('  [crawler] Validation error detected on repeated auth CTA screen');
            stopReason = 'auth_validation_error';
            break;
          }

          console.log('  [crawler] Repeated semantic auth submit loop detected');
          stopReason = 'auth_submit_loop';
          break;
        }

        candidates = [
          authSubmit,
          ...candidates.filter((a) => a.key !== authSubmit.key && a.type !== actions.ACTION_TYPES.TYPE),
        ];
        console.log('  [crawler] Prioritizing auth CTA in auth flow');
      } else {
        candidates = candidates.filter((a) => a.type !== actions.ACTION_TYPES.TYPE);
        console.log('  [crawler] Suppressing extra TYPE actions in auth flow');
      }
    } else {
      lastAuthSubmitKey = null;
      consecutiveSameAuthSubmit = 0;
    }

    console.log(`  [crawler] ${candidates.length} candidate actions (${tried.size} already tried)`);

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

    const description = executeAction(decision.action);
    console.log(`  [crawler] Executed: ${description} (reason: ${decision.reason})`);

    if (!adb.ensureDeviceReady()) {
      consecutiveDeviceFails++;
      console.log(`  [crawler] Device not ready after action (${consecutiveDeviceFails}/${MAX_DEVICE_FAILS})`);
      if (consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
        stopReason = 'device_offline';
        break;
      }
      await sleep(3000);
      continue;
    }

    const actionKey = decision.action.key || description;
    actionsTaken.push({
      step,
      type: decision.action.type,
      description,
      reason: decision.reason,
      actionKey,
      fromFingerprint: fp,
    });

    await sleep(2000);

    const postSnapshot = await captureStableScreen(screenshotDir, `${step}_post`, 2, 1500);

    if (postSnapshot && !postSnapshot.error && !isTransientEmptyXml(postSnapshot.xml)) {
      const postFp = fingerprint.compute(postSnapshot.xml);
      stateGraph.addTransition(fp, actionKey, postFp);
    } else if (postSnapshot && postSnapshot.error === 'device_offline') {
      consecutiveDeviceFails++;
      console.log(`  [crawler] Device lost during post-action capture (${consecutiveDeviceFails}/${MAX_DEVICE_FAILS})`);
      if (consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
        stopReason = 'device_offline';
        break;
      }
    } else if (postSnapshot && postSnapshot.error === 'capture_failed') {
      consecutiveCaptureFails++;
      console.log(`  [crawler] Post-action screenshot capture failed (${consecutiveCaptureFails}/${MAX_CAPTURE_FAILS})`);
      if (consecutiveCaptureFails >= MAX_CAPTURE_FAILS) {
        stopReason = 'capture_failed';
        break;
      }
    }
  }

  const result = {
    screens: screens.map((s) => ({
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

  console.log(
    `\n[crawler] Crawl complete: ${result.stats.totalSteps} steps, ${result.stats.uniqueStates} unique states, stop reason: ${stopReason}`,
  );

  const artifactPath = `${screenshotDir}/crawl_artifacts.json`;
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  console.log(`[crawler] Artifacts saved to ${artifactPath}`);

  return result;
}

module.exports = { runCrawl };
