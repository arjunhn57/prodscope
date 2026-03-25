/**
 * screen.js — Screen state capture
 * Captures a complete snapshot of the current device state:
 * screenshot PNG + UI XML + current activity.
 */

const path = require('path');
const adb = require('./adb');

/**
 * Capture the current screen state.
 * @param {string} screenshotDir - Directory to save screenshot PNGs
 * @param {number} index - Screen index for filename
 * @returns {{ screenshotPath: string, xml: string, activity: string, timestamp: number } | null}
 */
function capture(screenshotDir, index) {
  const screenshotPath = path.join(screenshotDir, `screen_${index}.png`);

  const ok = adb.screencap(screenshotPath);
  if (!ok) return null;

  const xml = adb.dumpXml();
  const activity = adb.getCurrentActivity();

  return {
    screenshotPath,
    xml,
    activity,
    timestamp: Date.now(),
    index,
  };
}

module.exports = { capture };
