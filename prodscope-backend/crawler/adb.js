/**
 * adb.js ΓÇö Thin ADB command wrapper
 * Centralizes all adb shell interactions with error handling + timeouts.
 */

const { execSync } = require('child_process');
const fs = require('fs');

const DEFAULT_TIMEOUT = 15000;

function run(cmd, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  try {
    return execSync(cmd, { timeout, encoding: 'utf-8', ...opts }).toString().trim();
  } catch (err) {
    if (opts.ignoreError) return '';
    throw new Error(`ADB command failed: ${cmd}\n${err.message}`);
  }
}

/** Capture a screenshot to outPath. Returns true on success. */
function screencap(outPath) {
  try {
    execSync(`adb exec-out screencap -p > "${outPath}"`, { timeout: DEFAULT_TIMEOUT });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
  } catch (err) {
    return false;
  }
}

/** Dump the current UI hierarchy XML. Returns XML string or ''. */
function dumpXml() {
  try {
    const raw = run('adb exec-out uiautomator dump /dev/tty 2>/dev/null || echo ""', { ignoreError: true });
    // uiautomator prefixes with "UI hierchary dumped to: /dev/tty" ΓÇö strip it
    const xmlStart = raw.indexOf('<?xml');
    return xmlStart >= 0 ? raw.substring(xmlStart) : raw;
  } catch (e) {
    return '';
  }
}

/** Tap at (x, y) coordinates. */
function tap(x, y) {
  run(`adb shell input tap ${x} ${y}`);
}

/** Swipe from (x1,y1) to (x2,y2) over durationMs. */
function swipe(x1, y1, x2, y2, durationMs = 300) {
  run(`adb shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
}

/** Press the Back button. */
function pressBack() {
  run('adb shell input keyevent KEYCODE_BACK');
}

/** Press the Home button. */
function pressHome() {
  run('adb shell input keyevent KEYCODE_HOME');
}

/** Press Enter/Return. */
function pressEnter() {
  run('adb shell input keyevent KEYCODE_ENTER');
}

/** Type text into the currently focused field. */
function inputText(text) {
  // Escape special shell characters
  const escaped = text.replace(/([\\$"`!])/g, '\\$1').replace(/ /g, '%s');
  run(`adb shell input text "${escaped}"`);
}

/** Get the current foreground activity. */
function getCurrentActivity() {
  const out = run('adb shell dumpsys activity activities | grep mResumedActivity', { ignoreError: true });
  const match = out.match(/u0\s+(\S+\/\S+)/);
  return match ? match[1] : 'unknown';
}

/** Get the current foreground package name. */
function getCurrentPackage() {
  const activity = getCurrentActivity();
  return activity.includes('/') ? activity.split('/')[0] : activity;
}

/** List third-party packages. */
function listThirdPartyPackages() {
  const out = run('adb shell pm list packages -3', { ignoreError: true });
  return out
    .split('\n')
    .map(line => line.replace('package:', '').trim())
    .filter(Boolean);
}

/** Launch an app by package name using monkey. */
function launchApp(packageName) {
  run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
}

/** Wait for device with timeout. */
function waitForDevice(timeoutMs = 10000) {
  run('adb wait-for-device', { timeout: timeoutMs });
}

/**
 * Check if an emulator/device is online and in 'device' state.
 * Returns false for offline, empty device list, or errors.
 */
function isDeviceOnline() {
  try {
    const out = run('adb devices', { ignoreError: true });
    const lines = out.split('\n').slice(1).map(s => s.trim()).filter(Boolean);
    return lines.some(line => line.startsWith('emulator-') && line.endsWith('\tdevice'));
  } catch (e) {
    return false;
  }
}

/**
 * Ensure the device is online AND fully booted.
 * Returns true only when boot prop sys.boot_completed is '1'.
 */
function ensureDeviceReady() {
  try {
    if (!isDeviceOnline()) return false;
    const boot = run('adb shell getprop sys.boot_completed', { ignoreError: true });
    return boot.trim() === '1';
  } catch (e) {
    return false;
  }
}

module.exports = {
  run,
  screencap,
  dumpXml,
  tap,
  swipe,
  pressBack,
  pressHome,
  pressEnter,
  inputText,
  getCurrentActivity,
  getCurrentPackage,
  listThirdPartyPackages,
  launchApp,
  waitForDevice,
  isDeviceOnline,
  ensureDeviceReady,
};
