"use strict";

/**
 * screen-classifier.js — Heuristic screen type classification
 *
 * Classifies screens into semantic types using XML structure and activity name.
 * Results are cached by exact fingerprint so each unique screen is classified once.
 * Zero LLM calls — pure heuristics.
 */

// -------------------------------------------------------------------------
// Cache: fingerprint → { type, confidence }
// -------------------------------------------------------------------------
const cache = new Map();

// -------------------------------------------------------------------------
// XML helpers
// -------------------------------------------------------------------------

function hasPasswordField(xml) {
  return /password="true"/i.test(xml);
}

function hasRecyclerView(xml) {
  return /class="android\.support\.v7\.widget\.RecyclerView"/i.test(xml) ||
    /class="androidx\.recyclerview\.widget\.RecyclerView"/i.test(xml) ||
    /class="android\.widget\.ListView"/i.test(xml) ||
    /class="androidx\.viewpager/i.test(xml);
}

function getListItemCount(xml) {
  const matches = xml.match(/<node[^>]+class="[^"]*\.(ViewHolder|ItemView|CardView|LinearLayout)[^"]*"/gi);
  return matches ? matches.length : 0;
}

function getEditTextCount(xml) {
  const matches = xml.match(/class="android\.widget\.EditText"/gi);
  return matches ? matches.length : 0;
}

function hasFilePickerOrCamera(xml) {
  return /camera|gallery|pick.*photo|choose.*image|attach.*file|upload/i.test(xml);
}

function isOverlayDialog(xml) {
  return /android:id\/alertTitle/i.test(xml) ||
    /android:id\/parentPanel/i.test(xml) ||
    /class="android\.app\.Dialog"/i.test(xml) ||
    /class="androidx\.appcompat\.app\.AlertDialog/i.test(xml);
}

function hasLargeImage(xml) {
  return /class="android\.widget\.ImageView"/i.test(xml);
}

function hasTextContent(xml) {
  const textNodes = xml.match(/class="android\.widget\.TextView"[^>]*text="([^"]+)"/gi);
  if (!textNodes) return false;
  const longText = textNodes.filter((n) => {
    const m = n.match(/text="([^"]+)"/);
    return m && m[1].length > 20;
  });
  return longText.length >= 2;
}

function hasErrorIndicators(xml) {
  return /(error|failed|unable|something went wrong|oops|no internet|offline|retry|could not)/i.test(xml);
}

function hasBottomNavigation(xml) {
  return /BottomNavigationView/i.test(xml) ||
    /BottomNavigation/i.test(xml) ||
    /BottomBar/i.test(xml) ||
    /bottom_navigation/i.test(xml) ||
    /bottomnavigation/i.test(xml);
}

function hasTabLayout(xml) {
  return /TabLayout/i.test(xml) ||
    /class="android\.widget\.TabWidget"/i.test(xml) ||
    /tab_layout/i.test(xml);
}

function hasSearchField(xml) {
  return /search/i.test(xml) &&
    (getEditTextCount(xml) >= 1 || /SearchView/i.test(xml) || /search_src_text/i.test(xml));
}

function hasSignupIndicators(xml) {
  return /(sign up|signup|create account|register|join)/i.test(xml);
}

// -------------------------------------------------------------------------
// Content creation sub-type detection (CLAUDE.md Section 4.6)
// -------------------------------------------------------------------------

/**
 * Extract the content creation sub-type from a screen's XML.
 * Only meaningful when screenType is 'media_upload' or feature is 'content_creation'.
 * @param {string} xml - Raw uiautomator XML
 * @returns {string} Sub-type: image_post, video_post, story, carousel, text_post, live, generic_post
 */
function extractCreationSubType(xml) {
  if (!xml) return "generic_post";

  const lower = xml.toLowerCase();

  // Extract all text labels for pattern matching
  const labels = [];
  const labelMatches = lower.match(/text="([^"]+)"/gi);
  if (labelMatches) {
    for (const m of labelMatches) {
      const val = m.match(/text="([^"]+)"/i);
      if (val) labels.push(val[1]);
    }
  }

  const allText = labels.join(' ');

  if (/\b(reel|reels|short video|shorts)\b/.test(allText)) return "video_post";
  if (/\b(story|stories|your story|add to story)\b/.test(allText)) return "story";
  if (/\b(live|go live|live video|broadcast)\b/.test(allText)) return "live";
  if (/\b(carousel|multiple|select multiple)\b/.test(allText)) return "carousel";
  if (/\b(video|record|recording|clip)\b/.test(allText)) return "video_post";
  if (/\b(photo|image|camera|take photo|take picture)\b/.test(allText)) return "image_post";
  if (/\b(text|status|what's on your mind|write something|compose)\b/.test(allText)) return "text_post";

  // Check for media-related UI elements
  if (/VideoView|ExoPlayer|MediaPlayer|video_preview/i.test(xml)) return "video_post";
  if (/CameraView|camera_preview|SurfaceView/i.test(xml)) return "image_post";

  return "generic_post";
}

// -------------------------------------------------------------------------
// Screen-to-feature mapping
// -------------------------------------------------------------------------

const SCREEN_TO_FEATURE = {
  login: "auth_flow",
  signup: "auth_flow",
  feed: "browsing",
  detail_view: "content_viewing",
  settings: "settings",
  media_upload: "content_creation",
  form: "data_entry",
  search: "search",
  profile: "profile_management",
  dialog: "interaction",
  error: "error_handling",
  navigation_hub: "navigation",
  unknown: "other",
};

function featureForScreenType(screenType) {
  return SCREEN_TO_FEATURE[screenType] || "other";
}

function inferFeatureFromActivity(activity) {
  if (!activity) return "other";
  const a = activity.toLowerCase();
  if (a.includes("search")) return "search";
  if (a.includes("profile")) return "profile_management";
  if (a.includes("chat") || a.includes("message")) return "messaging";
  if (a.includes("cart") || a.includes("checkout")) return "commerce";
  if (a.includes("camera") || a.includes("gallery")) return "content_creation";
  if (a.includes("setting") || a.includes("preference")) return "settings";
  return null;
}

// -------------------------------------------------------------------------
// Main classifier
// -------------------------------------------------------------------------

/**
 * Classify a screen by heuristic rules.
 * @param {string} xml - Raw uiautomator XML
 * @param {string} activity - Current activity name
 * @param {string} exactFp - Exact fingerprint (for caching)
 * @returns {{ type: string, confidence: number, feature: string, classifiedBy: string, subType: string|null }}
 */
function classify(xml, activity, exactFp) {
  if (exactFp && cache.has(exactFp)) {
    return cache.get(exactFp);
  }

  const result = classifyHeuristic(xml, activity);
  result.classifiedBy = "heuristic";

  // Enrich with feature category
  result.feature = featureForScreenType(result.type);
  if (result.feature === "other") {
    const activityFeature = inferFeatureFromActivity(activity);
    if (activityFeature) result.feature = activityFeature;
  }

  // Content creation sub-type detection
  if (result.feature === "content_creation" || result.type === "media_upload") {
    result.subType = extractCreationSubType(xml);
  } else {
    result.subType = null;
  }

  if (exactFp) {
    cache.set(exactFp, result);
  }

  return result;
}

function classifyHeuristic(xml, activity) {
  if (!xml) return { type: "unknown", confidence: 0.0 };

  const act = (activity || "").toLowerCase();

  // Order matters — more specific rules first

  if (hasPasswordField(xml) || act.includes("login") || act.includes("auth")) {
    if (hasSignupIndicators(xml)) {
      return { type: "signup", confidence: 0.9 };
    }
    return { type: "login", confidence: 0.9 };
  }

  if (isOverlayDialog(xml) || xml.includes("android:id/alertTitle")) {
    return { type: "dialog", confidence: 0.9 };
  }

  if (act.includes("settings") || act.includes("preference")) {
    return { type: "settings", confidence: 0.9 };
  }

  if (hasSearchField(xml) || act.includes("search")) {
    return { type: "search", confidence: 0.8 };
  }

  if (hasErrorIndicators(xml)) {
    return { type: "error", confidence: 0.7 };
  }

  if (hasFilePickerOrCamera(xml)) {
    return { type: "media_upload", confidence: 0.7 };
  }

  if (hasBottomNavigation(xml) || hasTabLayout(xml)) {
    return { type: "navigation_hub", confidence: 0.8 };
  }

  if (hasRecyclerView(xml) && getListItemCount(xml) > 3) {
    return { type: "feed", confidence: 0.8 };
  }

  if (getEditTextCount(xml) >= 2) {
    return { type: "form", confidence: 0.6 };
  }

  if (!hasRecyclerView(xml) && hasLargeImage(xml) && hasTextContent(xml)) {
    return { type: "detail_view", confidence: 0.6 };
  }

  if (act.includes("profile")) {
    return { type: "profile", confidence: 0.7 };
  }

  return { type: "unknown", confidence: 0.0 };
}

/**
 * Clear the classification cache (e.g. between crawl sessions).
 */
function clearCache() {
  cache.clear();
}

function cacheSize() {
  return cache.size;
}

module.exports = {
  classify,
  classifyHeuristic,
  featureForScreenType,
  extractCreationSubType,
  clearCache,
  cacheSize,
  SCREEN_TO_FEATURE,
};
