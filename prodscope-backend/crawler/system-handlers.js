/**
 * system-handlers.js - System dialog and permission prompt handler
 * Detects and auto-dismisses common Android system dialogs so the crawler
 * doesn't get stuck on permission prompts or crash dialogs.
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');

/**
 * Patterns for system dialogs we know how to handle.
 * Each entry: { detect: fn(xml) -> boolean, resolve: fn(xml) -> action description }
 */
const HANDLERS = [
  {
    name: 'permission_allow',
    detect: (xml) => /resource-id="com\.android\.permissioncontroller/.test(xml) ||
                     /text="(Allow|While using the app|ALLOW)"/.test(xml),
    resolve: (xml) => {
      const patterns = [
        /text="While using the app"[^>]*bounds="([^"]+)"/,
        /text="Allow"[^>]*bounds="([^"]+)"/,
        /text="ALLOW"[^>]*bounds="([^"]+)"/,
      ];
      for (const pat of patterns) {
        const m = xml.match(pat);
        if (m) {
          const bounds = parseBounds(m[1]);
          if (bounds) {
            adb.tap(bounds.cx, bounds.cy);
            return `Tapped "${m[0].includes('While') ? 'While using the app' : 'Allow'}"`;
          }
        }
      }
      adb.tap(540, 1600);
      return 'Tapped generic allow position';
    },
  },
  {
    name: 'skip_later_not_now',
    detect: (xml) =>
      /text="(Skip|SKIP|Later|LATER|Not now|NOT NOW|Maybe later|Remind me later)"/.test(xml),
    resolve: (xml) => {
      const patterns = [
        /text="Skip"[^>]*bounds="([^"]+)"/,
        /text="SKIP"[^>]*bounds="([^"]+)"/,
        /text="Later"[^>]*bounds="([^"]+)"/,
        /text="LATER"[^>]*bounds="([^"]+)"/,
        /text="Not now"[^>]*bounds="([^"]+)"/,
        /text="NOT NOW"[^>]*bounds="([^"]+)"/,
        /text="Maybe later"[^>]*bounds="([^"]+)"/,
        /text="Remind me later"[^>]*bounds="([^"]+)"/,
      ];

      for (const pat of patterns) {
        const m = xml.match(pat);
        if (m) {
          const bounds = parseBounds(m[1]);
          if (bounds) {
            adb.tap(bounds.cx, bounds.cy);
            return `Tapped onboarding dismiss action`;
          }
        }
      }

      adb.pressBack();
      return 'Dismissed onboarding/interstitial with BACK';
    },
  },
  {
    name: 'app_crashed',
    detect: (xml) => /text="(has stopped|keeps stopping|isn't responding)"/.test(xml),
    resolve: (xml) => {
      const patterns = [
        /text="(OK|Close app|Close)"[^>]*bounds="([^"]+)"/,
      ];
      for (const pat of patterns) {
        const m = xml.match(pat);
        if (m) {
          const bounds = parseBounds(m[2]);
          if (bounds) {
            adb.tap(bounds.cx, bounds.cy);
            return `Dismissed crash dialog: tapped "${m[1]}"`;
          }
        }
      }
      adb.tap(540, 1400);
      return 'Dismissed crash dialog (fallback tap)';
    },
  },
  {
    name: 'google_signin_prompt',
    detect: (xml) => /text="(Choose an account|Sign in with Google|Google Sign-in)"/.test(xml) ||
                     /resource-id="com\.google\.android\.gms/.test(xml),
    resolve: (xml) => {
      adb.pressBack();
      return 'Dismissed Google sign-in prompt with BACK';
    },
  },
  {
    name: 'system_alert_dialog',
    detect: (xml) => /resource-id="android:id\/alertTitle"/.test(xml) &&
                     /text="(OK|CANCEL|Cancel|Dismiss|GOT IT|Got it)"/.test(xml),
    resolve: (xml) => {
      const m = xml.match(/text="(OK|GOT IT|Got it|Dismiss)"[^>]*bounds="([^"]+)"/);
      if (m) {
        const bounds = parseBounds(m[2]);
        if (bounds) {
          adb.tap(bounds.cx, bounds.cy);
          return `Dismissed alert: tapped "${m[1]}"`;
        }
      }
      adb.pressBack();
      return 'Dismissed alert with BACK';
    },
  },
];

/**
 * Check the current screen XML for known system dialogs and handle them.
 * @param {string} xml - Current UI XML dump
 * @returns {{ handled: boolean, action: string | null, handler: string | null }}
 */
function check(xml) {
  if (!xml) return { handled: false, action: null, handler: null };

  for (const handler of HANDLERS) {
    if (handler.detect(xml)) {
      console.log(`  [system] Detected system dialog: ${handler.name}`);
      const action = handler.resolve(xml);
      console.log(`  [system] ${action}`);
      return { handled: true, action, handler: handler.name };
    }
  }

  return { handled: false, action: null, handler: null };
}

module.exports = { check, HANDLERS };
