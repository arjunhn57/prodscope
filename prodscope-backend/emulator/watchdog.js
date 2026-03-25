"use strict";

/**
 * watchdog.js — Emulator health monitoring + recovery
 *
 * Checks ADB connection, emulator responsiveness, app state, ANR, and
 * screen freeze. Returns recovery actions when issues are detected.
 */

const { execSync } = require("child_process");
const crypto = require("crypto");
const { sleep } = require("../utils/sleep");

class EmulatorWatchdog {
  constructor(packageName, options = {}) {
    this.packageName = packageName;
    this.freezeThresholdMs = options.freezeThreshold || 15000;
    this.maxConsecutiveFailures = options.maxFailures || 3;
    this.consecutiveFailures = 0;
    this.lastScreenHash = null;
    this.lastScreenTime = Date.now();
  }

  /**
   * Run all health checks. Returns { healthy, action, detail }.
   */
  checkHealth() {
    // 1. ADB connection
    try {
      const devices = execSync("adb devices", { timeout: 5000 }).toString();
      const connected = devices.includes("emulator-") && !devices.includes("offline");
      if (!connected) return { healthy: false, action: "restart_adb", detail: "no emulator in adb devices" };
    } catch (e) {
      return { healthy: false, action: "restart_adb", detail: "adb devices timed out" };
    }

    // 2. Emulator responsive
    try {
      execSync("adb shell echo ok", { timeout: 5000 });
    } catch (e) {
      return { healthy: false, action: "restart_emulator", detail: "shell echo timed out" };
    }

    // 3. App running
    try {
      const top = execSync("adb shell dumpsys activity top", { timeout: 5000 }).toString();
      if (!top.includes(this.packageName)) {
        return { healthy: false, action: "restart_app", detail: "app not in foreground" };
      }
    } catch (e) {
      return { healthy: false, action: "restart_app", detail: "dumpsys timed out" };
    }

    // 4. ANR check
    try {
      const anr = execSync("adb shell dumpsys activity processes | grep ANR", {
        timeout: 5000,
        encoding: "utf-8",
      });
      if (anr.trim().length > 0) {
        return { healthy: false, action: "dismiss_anr_restart_app", detail: "ANR detected" };
      }
    } catch (e) {
      // grep returns non-zero when no match — that's fine
    }

    // 5. Screen freeze detection
    try {
      const screencap = execSync("adb shell screencap -p", {
        timeout: 10000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const hash = crypto.createHash("md5").update(screencap).digest("hex");
      if (hash === this.lastScreenHash) {
        if (Date.now() - this.lastScreenTime > this.freezeThresholdMs) {
          return { healthy: false, action: "tap_to_unfreeze", detail: "screen frozen" };
        }
      } else {
        this.lastScreenHash = hash;
        this.lastScreenTime = Date.now();
      }
    } catch (e) {
      // screencap failure is not fatal by itself
    }

    this.consecutiveFailures = 0;
    return { healthy: true };
  }

  /**
   * Attempt recovery based on the action returned by checkHealth().
   * Returns true if recovery was attempted, false if max failures exceeded.
   */
  async recover(action) {
    this.consecutiveFailures++;
    console.log(`  [watchdog] Recovery attempt ${this.consecutiveFailures}/${this.maxConsecutiveFailures}: ${action}`);

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      console.log("  [watchdog] Max consecutive failures — requesting full restart");
      return false; // Caller should abort or do full emulator restart
    }

    switch (action) {
      case "restart_adb":
        try {
          execSync("adb kill-server && adb start-server", { timeout: 10000 });
        } catch (e) {}
        await sleep(2000);
        break;

      case "restart_app":
        try {
          execSync(`adb shell am force-stop ${this.packageName}`, { timeout: 5000 });
        } catch (e) {}
        await sleep(1000);
        try {
          execSync(`adb shell monkey -p ${this.packageName} -c android.intent.category.LAUNCHER 1`, { timeout: 5000 });
        } catch (e) {}
        await sleep(3000);
        break;

      case "dismiss_anr_restart_app":
        try {
          execSync("adb shell input keyevent KEYCODE_ENTER", { timeout: 3000 });
        } catch (e) {}
        await sleep(1000);
        await this.recover("restart_app");
        break;

      case "tap_to_unfreeze":
        try {
          execSync("adb shell input tap 540 960", { timeout: 3000 });
        } catch (e) {}
        this.lastScreenHash = null; // Reset freeze detection
        await sleep(2000);
        break;

      case "restart_emulator":
        return false; // Caller should handle full emulator restart
    }

    return true;
  }

  /**
   * Reset the failure counter (call after successful crawl step).
   */
  reportProgress() {
    this.consecutiveFailures = 0;
  }
}

module.exports = { EmulatorWatchdog };
