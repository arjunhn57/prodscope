"use strict";

/**
 * anr-detector.js — Detect Application Not Responding (ANR) conditions
 *
 * Checks both dumpsys output and UI XML for ANR indicators.
 * Zero LLM tokens.
 */

const adb = require("../crawler/adb");

/**
 * Check if the target app has an ANR condition.
 * @param {string} packageName - Target app package name
 * @param {string} [xml] - Optional current UI XML to check for ANR dialog
 * @returns {{ anrDetected: boolean, source: string, detail: string }}
 */
function checkANR(packageName, xml) {
  // Check 1: ANR dialog visible in UI XML
  if (xml) {
    const xmlAnr = checkANRInXml(xml);
    if (xmlAnr.anrDetected) return xmlAnr;
  }

  // Check 2: dumpsys for ANR records
  try {
    const output = adb.run(
      "adb shell dumpsys activity processes | grep -i ANR",
      { ignoreError: true, timeout: 5000 }
    );

    if (output && output.includes(packageName)) {
      return {
        anrDetected: true,
        source: "dumpsys",
        detail: output.substring(0, 500).trim(),
      };
    }
  } catch (e) {
    // Non-critical — continue
  }

  return { anrDetected: false, source: "", detail: "" };
}

/**
 * Check for ANR dialog in UI XML.
 * @param {string} xml
 * @returns {{ anrDetected: boolean, source: string, detail: string }}
 */
function checkANRInXml(xml) {
  if (!xml) return { anrDetected: false, source: "", detail: "" };

  const anrPatterns = [
    /android:id\/aerr_wait/i,
    /android:id\/aerr_close/i,
    /Application Not Responding/i,
    /isn't responding/i,
    /Wait|Close app/,
  ];

  for (const pattern of anrPatterns) {
    if (pattern.test(xml)) {
      return {
        anrDetected: true,
        source: "xml_dialog",
        detail: `ANR dialog detected (matched: ${pattern.source})`,
      };
    }
  }

  return { anrDetected: false, source: "", detail: "" };
}

/**
 * Dismiss an ANR dialog by tapping "Wait" or pressing Enter.
 */
function dismissANR() {
  try {
    // Try pressing Enter (usually selects "Wait" or default button)
    adb.run("adb shell input keyevent KEYCODE_ENTER", {
      ignoreError: true,
      timeout: 3000,
    });
  } catch (e) {
    // Non-critical
  }
}

module.exports = { checkANR, checkANRInXml, dismissANR };
