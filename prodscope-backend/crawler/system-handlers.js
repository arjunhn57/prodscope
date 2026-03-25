/**
 * system-handlers.js - Generic system dialog and overlay handler
 *
 * Detects and auto-dismisses Android system dialogs, permission prompts,
 * onboarding overlays, and other interrupts using XML pattern matching.
 *
 * Strategy:
 *  1. Specific handlers match known dialog types (highest priority).
 *  2. Generic structural detection catches ANY dialog/overlay by XML patterns.
 *  3. Resolution: find dismiss/accept buttons by label patterns, fall back to BACK.
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');

// -------------------------------------------------------------------------
// Button label patterns for dialog resolution (case-insensitive)
// -------------------------------------------------------------------------

/** Labels that dismiss/decline a dialog */
const DISMISS_LABELS = [
  'skip', 'later', 'not now', 'maybe later', 'remind me later',
  'no thanks', 'no, thanks', 'dismiss', 'cancel', 'close',
  'deny', 'don\'t allow', 'reject', 'never', 'not interested',
  'got it', 'ok', 'okay',
];

/** Labels that accept/allow a dialog (used when we want to proceed) */
const ACCEPT_LABELS = [
  'allow', 'while using the app', 'only this time',
  'accept', 'agree', 'continue', 'yes', 'confirm',
  'enable', 'turn on', 'ok', 'okay', 'got it',
  'open', 'proceed',
];

/** Labels that indicate crash/ANR dialogs */
const CRASH_LABELS = [
  'close app', 'close', 'wait', 'open app again',
  'send feedback', 'app info',
];

// -------------------------------------------------------------------------
// Structural dialog detectors
// -------------------------------------------------------------------------

/**
 * Detect if the current XML contains a system permission dialog.
 */
function isPermissionDialog(xml) {
  return /resource-id="com\.android\.permissioncontroller/i.test(xml) ||
    (/text="(Allow|While using the app|Only this time|Don't allow|Deny)"/i.test(xml) &&
     /resource-id="com\.android\./i.test(xml));
}

/**
 * Detect if the current XML contains a crash/ANR/not-responding dialog.
 */
function isCrashOrAnrDialog(xml) {
  return (
    /android:id\/aerr_/.test(xml) ||
    (/(isn&apos;t responding|isn't responding|keeps stopping|has stopped|unfortunately.*stopped)/i.test(xml) &&
     /alertTitle|android:id\/message/i.test(xml))
  );
}

/**
 * Detect ANY overlay dialog by structural XML patterns.
 * Matches alert dialogs, bottom sheets, popups, and modal overlays.
 */
function isGenericDialog(xml) {
  if (!xml) return false;

  // Known Android dialog structural markers
  const dialogMarkers = [
    /android:id\/alertTitle/i,
    /android:id\/parentPanel/i,
    /android:id\/contentPanel/i,
    /android:id\/buttonPanel/i,
    /class="android\.app\.Dialog/i,
    /class="androidx\.appcompat\.app\.AlertDialog/i,
    /class="android\.widget\.PopupWindow/i,
    /class="com\.google\.android\.material\.bottomsheet/i,
    /resource-id="[^"]*(?:dialog|popup|overlay|modal|banner|snackbar|toast|bottomsheet)/i,
  ];

  return dialogMarkers.some((pattern) => pattern.test(xml));
}

/**
 * Detect onboarding/interstitial/promo overlays.
 * These are full-screen or near-full-screen overlays with dismiss actions.
 */
function isOnboardingOverlay(xml) {
  const hasSkipAction = /text="(Skip|SKIP|Later|LATER|Not now|NOT NOW|Maybe later|Remind me later|Got it|GOT IT|No thanks)"/i.test(xml);
  const hasPageIndicator = /class="[^"]*PageIndicator|ViewPager/i.test(xml);
  return hasSkipAction || hasPageIndicator;
}

/**
 * Detect third-party auth/sign-in prompts (Google, Facebook, etc.).
 */
function isThirdPartyAuthPrompt(xml) {
  return (
    /resource-id="com\.google\.android\.gms/i.test(xml) ||
    /resource-id="com\.facebook\.katana/i.test(xml) ||
    /text="(Choose an account|Sign in with Google|Google Sign-in|Sign in to continue|Continue with Google|Continue with Facebook)"/i.test(xml)
  );
}

// -------------------------------------------------------------------------
// Button finder — generic XML button extraction
// -------------------------------------------------------------------------

/**
 * Find all tappable buttons in the XML and return their labels + bounds.
 */
function extractButtons(xml) {
  const buttons = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const clickable = get('clickable') === 'true';
    if (!clickable) continue;

    const text = get('text').trim();
    const contentDesc = get('content-desc').trim();
    const label = text || contentDesc;
    if (!label) continue;

    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    const cls = get('class').toLowerCase();
    const isButton = cls.includes('button') || cls.includes('textview') || cls.includes('imageview');

    buttons.push({ label, labelLower: label.toLowerCase(), bounds, isButton, cls });
  }

  return buttons;
}

/**
 * Find and tap a button matching one of the given label patterns.
 * Returns the action description or null if no match found.
 */
function tapButtonByLabels(xml, labelPatterns, fallbackAction) {
  const buttons = extractButtons(xml);

  for (const pattern of labelPatterns) {
    const match = buttons.find((b) => b.labelLower === pattern || b.labelLower.includes(pattern));
    if (match) {
      adb.tap(match.bounds.cx, match.bounds.cy);
      return `Tapped "${match.label}"`;
    }
  }

  // Fallback
  if (fallbackAction === 'back') {
    adb.pressBack();
    return 'Dismissed with BACK (no matching button)';
  }

  return null;
}

// -------------------------------------------------------------------------
// Handler registry — ordered by specificity (most specific first)
// -------------------------------------------------------------------------

const HANDLERS = [
  {
    name: 'permission_dialog',
    detect: isPermissionDialog,
    resolve: (xml) => {
      return tapButtonByLabels(xml, ACCEPT_LABELS, 'back') || 'Handled permission dialog';
    },
  },
  {
    name: 'crash_anr_dialog',
    detect: isCrashOrAnrDialog,
    resolve: (xml) => {
      return tapButtonByLabels(xml, CRASH_LABELS, 'back') || 'Dismissed crash/ANR dialog';
    },
  },
  {
    name: 'third_party_auth',
    detect: isThirdPartyAuthPrompt,
    resolve: (xml) => {
      adb.pressBack();
      return 'Dismissed third-party auth prompt with BACK';
    },
  },
  {
    name: 'onboarding_overlay',
    detect: isOnboardingOverlay,
    resolve: (xml) => {
      return tapButtonByLabels(xml, DISMISS_LABELS, 'back') || 'Dismissed onboarding overlay';
    },
  },
  {
    // Generic catch-all: any dialog/popup/overlay not matched above
    name: 'generic_dialog',
    detect: isGenericDialog,
    resolve: (xml) => {
      // Try dismiss first, then accept, then BACK
      const dismissed = tapButtonByLabels(xml, DISMISS_LABELS);
      if (dismissed) return dismissed;

      const accepted = tapButtonByLabels(xml, ACCEPT_LABELS);
      if (accepted) return accepted;

      adb.pressBack();
      return 'Dismissed generic dialog with BACK';
    },
  },
];

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Check the current screen XML for system dialogs/overlays and handle them.
 * @param {string} xml - Current UI XML dump
 * @returns {{ handled: boolean, action: string | null, handler: string | null }}
 */
function check(xml) {
  if (!xml) return { handled: false, action: null, handler: null };

  for (const handler of HANDLERS) {
    if (handler.detect(xml)) {
      console.log(`  [system] Detected dialog: ${handler.name}`);
      const action = handler.resolve(xml);
      console.log(`  [system] ${action}`);
      return { handled: true, action, handler: handler.name };
    }
  }

  return { handled: false, action: null, handler: null };
}

module.exports = {
  check,
  HANDLERS,
  // Exported for testing
  isPermissionDialog,
  isCrashOrAnrDialog,
  isGenericDialog,
  isOnboardingOverlay,
  isThirdPartyAuthPrompt,
  extractButtons,
};
