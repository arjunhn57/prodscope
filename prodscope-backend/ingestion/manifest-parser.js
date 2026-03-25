"use strict";

/**
 * manifest-parser.js — Extract app metadata from APK
 *
 * Uses `aapt dump badging` (part of Android SDK build-tools) to extract
 * package name, launcher activity, permissions, and declared activities
 * from an APK file — without needing to install it on the emulator first.
 *
 * This replaces the unreliable `pm list packages -3 | tail -1` approach.
 */

const { execSync } = require("child_process");

/**
 * Parse an APK file and return its manifest metadata.
 * @param {string} apkPath - Path to the APK file
 * @returns {{ packageName, launcherActivity, activities, permissions, appName, versionName, versionCode, sdkVersion }}
 */
function parseApk(apkPath) {
  const result = {
    packageName: "",
    launcherActivity: "",
    activities: [],
    permissions: [],
    appName: "",
    versionName: "",
    versionCode: "",
    sdkVersion: "",
  };

  let output;
  try {
    output = execSync(`aapt dump badging "${apkPath}"`, {
      timeout: 15000,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (e) {
    // aapt might not be on PATH — try finding it in common SDK locations
    try {
      const aaptPath = findAapt();
      output = execSync(`"${aaptPath}" dump badging "${apkPath}"`, {
        timeout: 15000,
        encoding: "utf-8",
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch (e2) {
      console.error("[manifest-parser] aapt not found, falling back to basic extraction");
      return result;
    }
  }

  // Package name, version
  const pkgMatch = output.match(/package: name='([^']+)'/);
  if (pkgMatch) result.packageName = pkgMatch[1];

  const versionNameMatch = output.match(/versionName='([^']+)'/);
  if (versionNameMatch) result.versionName = versionNameMatch[1];

  const versionCodeMatch = output.match(/versionCode='([^']+)'/);
  if (versionCodeMatch) result.versionCode = versionCodeMatch[1];

  // SDK version
  const sdkMatch = output.match(/sdkVersion:'(\d+)'/);
  if (sdkMatch) result.sdkVersion = sdkMatch[1];

  // App name
  const labelMatch = output.match(/application-label(?:-en)?:'([^']+)'/);
  if (labelMatch) result.appName = labelMatch[1];

  // Launcher activity
  const launcherMatch = output.match(/launchable-activity: name='([^']+)'/);
  if (launcherMatch) result.launcherActivity = launcherMatch[1];

  // All activities
  const activityMatches = output.matchAll(/activity.*?name='([^']+)'/g);
  for (const m of activityMatches) {
    if (!result.activities.includes(m[1])) {
      result.activities.push(m[1]);
    }
  }

  // Permissions
  const permMatches = output.matchAll(/uses-permission: name='([^']+)'/g);
  for (const m of permMatches) {
    result.permissions.push(m[1]);
  }

  return result;
}

/**
 * Try to find aapt in common Android SDK locations.
 */
function findAapt() {
  const paths = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    `${process.env.HOME}/android-sdk`,
    `${process.env.HOME}/Android/Sdk`,
  ].filter(Boolean);

  for (const sdk of paths) {
    try {
      // Find the latest build-tools version
      const buildTools = execSync(`ls -1 "${sdk}/build-tools/" | sort -V | tail -1`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      if (buildTools) {
        const aaptPath = `${sdk}/build-tools/${buildTools}/aapt`;
        execSync(`test -x "${aaptPath}"`, { timeout: 2000 });
        return aaptPath;
      }
    } catch (e) {
      continue;
    }
  }

  throw new Error("aapt not found in any known SDK location");
}

module.exports = { parseApk };
