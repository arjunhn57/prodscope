"use strict";

/**
 * crash-detector.js — Detect app crashes via logcat
 *
 * Checks for FATAL EXCEPTION in logcat filtered to the target package.
 * Zero LLM tokens — pure ADB/logcat parsing.
 */

const adb = require("../crawler/adb");

/**
 * Check if the app has crashed since the last logcat clear.
 * @param {string} packageName - Target app package name
 * @returns {{ crashed: boolean, exceptionType: string, stackTrace: string }}
 */
function checkCrash(packageName) {
  try {
    // Get recent logcat entries for fatal exceptions
    const output = adb.run(
      `adb logcat -d -s AndroidRuntime:E --format=brief`,
      { ignoreError: true, timeout: 5000 }
    );

    if (!output) return { crashed: false, exceptionType: "", stackTrace: "" };

    // Filter to lines mentioning the target package or FATAL EXCEPTION
    const lines = output.split("\n");
    const fatalIdx = lines.findIndex((l) => /FATAL EXCEPTION/i.test(l));

    if (fatalIdx === -1) {
      return { crashed: false, exceptionType: "", stackTrace: "" };
    }

    // Check if this crash is related to our package
    const crashBlock = lines.slice(fatalIdx, Math.min(fatalIdx + 30, lines.length)).join("\n");

    if (!crashBlock.includes(packageName)) {
      return { crashed: false, exceptionType: "", stackTrace: "" };
    }

    // Extract exception type
    const exMatch = crashBlock.match(
      /(?:Caused by|java\.lang\.|android\.|kotlin\.)(\S+Exception|\S+Error)/
    );
    const exceptionType = exMatch ? exMatch[0] : "UnknownException";

    return {
      crashed: true,
      exceptionType,
      stackTrace: crashBlock.substring(0, 2000), // Cap at 2KB
    };
  } catch (e) {
    return { crashed: false, exceptionType: "", stackTrace: "" };
  }
}

/**
 * Clear logcat so subsequent checks only see new crashes.
 */
function clearLogcat() {
  try {
    adb.run("adb logcat -c", { ignoreError: true, timeout: 3000 });
  } catch (e) {
    // Non-critical
  }
}

/**
 * Check if the app process is still alive.
 * @param {string} packageName
 * @returns {boolean}
 */
function isAppAlive(packageName) {
  try {
    const pid = adb.run(`adb shell pidof ${packageName}`, {
      ignoreError: true,
      timeout: 3000,
    });
    return pid.trim().length > 0;
  } catch (e) {
    return false;
  }
}

module.exports = { checkCrash, clearLogcat, isAppAlive };
