/**
 * screen.js — Screen state capture
 * Captures a complete snapshot of the current device state:
 * screenshot PNG + UI XML + current activity.
 */

const path = require('path');
const adb = require('./adb');

/**
 * Capture the current screen state.
 * Returns:
 *   - snapshot object on success
 *   - { error: 'device_offline' } if device is not ready
 *   - { error: 'capture_failed' } if screenshot fails
 *
 * @param {string} screenshotDir - Directory to save screenshot PNGs
 * @param {number|string} index - Screen index for filename
 * @returns {{ screenshotPath: string, xml: string, activity: string, timestamp: number, index: number|string } | { error: string }}
 */
function capture(screenshotDir, index) {
  const screenshotPath = path.join(screenshotDir, `screen_${index}.png`);

  if (!adb.ensureDeviceReady()) {
    return { error: 'device_offline' };
  }

  const ok = adb.screencap(screenshotPath);
  if (!ok) {
    return { error: 'capture_failed' };
  }

  if (!adb.ensureDeviceReady()) {
    return { error: 'device_offline' };
  }

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
