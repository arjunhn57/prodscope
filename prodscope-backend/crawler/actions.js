/**
 * actions.js — Action extraction and ranking from UI XML
 * Parses uiautomator XML to find candidate user actions and ranks them
 * deterministically so the crawler never picks randomly.
 */

/**
 * Action types the crawler understands.
 */
const ACTION_TYPES = {
  TAP: 'tap',
  TYPE: 'type',
  SCROLL_DOWN: 'scroll_down',
  SCROLL_UP: 'scroll_up',
  BACK: 'back',
};

/**
 * Parse bounds string "[x1,y1][x2,y2]" into {x1, y1, x2, y2, cx, cy}.
 */
function parseBounds(boundsStr) {
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const x1 = parseInt(m[1]), y1 = parseInt(m[2]);
  const x2 = parseInt(m[3]), y2 = parseInt(m[4]);
  return { x1, y1, x2, y2, cx: Math.floor((x1 + x2) / 2), cy: Math.floor((y1 + y2) / 2) };
}

/**
 * Build a unique key for an action (used for deduplication and tracking).
 */
function actionKey(action) {
  if (action.type === ACTION_TYPES.BACK) return 'back';
  if (action.type === ACTION_TYPES.SCROLL_DOWN) return 'scroll_down';
  if (action.type === ACTION_TYPES.SCROLL_UP) return 'scroll_up';
  const loc = action.bounds ? `${action.bounds.cx},${action.bounds.cy}` : 'unknown';
  return `${action.type}:${action.resourceId || ''}:${loc}`;
}

/**
 * Compute priority score for an action. Higher = should be tried first.
 *
 * Priority tiers:
 *   100 — editable text fields (forms)
 *    80 — buttons / clickables with meaningful text/description
 *    60 — navigation elements (tabs, drawer items)
 *    40 — generic clickable elements
 *    20 — scroll actions
 *    10 — back button
 */
function scorePriority(action) {
  if (action.type === ACTION_TYPES.TYPE) return 100;

  if (action.type === ACTION_TYPES.TAP) {
    const cls = (action.className || '').toLowerCase();
    const text = (action.text || '').toLowerCase();
    const desc = (action.contentDesc || '').toLowerCase();
    const rid = (action.resourceId || '').toLowerCase();

    // Primary CTAs (highest priority among taps)
    const primaryKeywords = ['login', 'sign in', 'sign up', 'register', 'submit', 'continue', 'next', 'log in', 'get started', 'allow', 'done', 'finish'];
    if (primaryKeywords.some(k => text.includes(k) || desc.includes(k) || rid.includes(k))) return 90;

    // Buttons with text
    if ((cls.includes('button') || cls.includes('textview')) && (text || desc)) return 80;

    // Navigation items
    if (cls.includes('tab') || cls.includes('bottomnavigation') || rid.includes('nav') || rid.includes('tab')) return 60;

    // Image buttons, icons with description
    if (cls.includes('imagebutton') || cls.includes('imageview')) {
      return desc ? 55 : 30;
    }

    // Generic clickable with some identifying info
    if (text || desc || rid.length > 3) return 50;

    // Junk elements (empty div, generic frame layout with no identifier)
    if (action.bounds) {
       const height = action.bounds.y2 - action.bounds.y1;
       const width = action.bounds.x2 - action.bounds.x1;
       if (height < 20 && width < 20) return -10; // Penalize tiny junk
    }

    return 20; // Lower baseline priority for bare generic elements
  }

  if (action.type === ACTION_TYPES.SCROLL_DOWN || action.type === ACTION_TYPES.SCROLL_UP) return 20;
  if (action.type === ACTION_TYPES.BACK) return 10;

  return 0;
}

/**
 * Extract candidate actions from uiautomator XML.
 * @param {string} xml - Raw XML dump
 * @param {Set<string>} [triedActions] - Keys of actions already tried from this state
 * @returns {Array<object>} Sorted by priority (descending)
 */
function extract(xml, triedActions = new Set()) {
  if (!xml) return [];

  const actions = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const clickable = get('clickable') === 'true';
    const scrollable = get('scrollable') === 'true';
    const editable = get('class').toLowerCase().includes('edittext') || get('editable') === 'true';
    const enabled = get('enabled') !== 'false';
    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    const pkg = get('package').toLowerCase();

    if (!bounds) continue;
    if (!enabled) continue; // Skip disabled elements

    // Immediately skip system UI framework overlays to avoid random settings toggles or quick settings expansion
    if (pkg === 'com.android.systemui' || pkg === 'com.android.settings') continue;

    // Skip off-screen or invisible elements (assuming 1080x1920 device)
    if (bounds.cx < 0 || bounds.cy < 0 || bounds.cx > 1200 || bounds.cy > 2400) continue;
    // Skip tiny elements (< 10px in any dimension)
    if ((bounds.x2 - bounds.x1) < 10 || (bounds.y2 - bounds.y1) < 10) continue;

    const base = {
      className: get('class'),
      text: get('text'),
      contentDesc: get('content-desc'),
      resourceId: get('resource-id'),
      bounds,
      boundsStr,
    };

    if (editable) {
      const action = { ...base, type: ACTION_TYPES.TYPE, priority: 0 };
      action.priority = scorePriority(action);
      action.key = actionKey(action);
      if (!triedActions.has(action.key)) actions.push(action);
    }

    if (clickable && !editable) {
      const action = { ...base, type: ACTION_TYPES.TAP, priority: 0 };
      action.priority = scorePriority(action);
      action.key = actionKey(action);
      if (!triedActions.has(action.key)) actions.push(action);
    }

    if (scrollable) {
      const scrollDown = { ...base, type: ACTION_TYPES.SCROLL_DOWN, priority: 20, key: 'scroll_down' };
      const scrollUp = { ...base, type: ACTION_TYPES.SCROLL_UP, priority: 20, key: 'scroll_up' };
      if (!triedActions.has(scrollDown.key)) actions.push(scrollDown);
      if (!triedActions.has(scrollUp.key)) actions.push(scrollUp);
    }
  }

  // Always add BACK as a fallback
  const backAction = { type: ACTION_TYPES.BACK, priority: 10, key: 'back', bounds: null };
  if (!triedActions.has(backAction.key)) actions.push(backAction);

  // Sort by priority descending, stable
  actions.sort((a, b) => b.priority - a.priority);
  return actions;
}

module.exports = { extract, scorePriority, actionKey, parseBounds, ACTION_TYPES };
