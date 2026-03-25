/**
 * fingerprint.js — Deterministic screen fingerprinting
 * Computes a stable hash from UI XML structure so that the same logical
 * screen always produces the same fingerprint, regardless of volatile
 * attributes like scroll position or focus state.
 */

const crypto = require('crypto');

/**
 * Attributes to KEEP for fingerprinting (structural identity).
 * Everything else (bounds, focused, selected, checked, scrollX/Y, etc.) is stripped.
 */
const STRUCTURAL_ATTRS = [
  'class',
  'package',
  'resource-id',
  'text',
  'content-desc',
  'checkable',
  'clickable',
  'enabled',
  'focusable',
  'scrollable',
  'long-clickable',
  'password'
];

/**
 * Extract structural signature lines from raw XML.
 * Each UI node becomes a single canonical line:
 *   <class resource-id="..." text="..." clickable="...">
 * Volatile attributes are stripped so the same screen always fingerprints identically.
 */
function normalize(xml) {
  if (!xml) return '';

  const lines = [];
  // Match individual XML node tags (self-closing or opening)
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrString = m[1];
    const parts = [];

    for (const attr of STRUCTURAL_ATTRS) {
      const attrMatch = attrString.match(new RegExp(`${attr}="([^"]*)"`));
      if (attrMatch) {
        let val = attrMatch[1];
        
        // Normalize text/desc/id to lower case and mask any numbers
        // This prevents things like "10:45 AM" or "32 unread messages" from breaking the screen identity
        if (['text', 'content-desc', 'resource-id'].includes(attr)) {
          val = val.toLowerCase()
                   .replace(/\d/g, '#')
                   .replace(/\s*[ap]m\b/g, '') // strip am/pm suffixes
                   .trim();
        }
        
        parts.push(`${attr}="${val}"`);
      }
    }
    if (parts.length > 0) {
      parts.sort(); // Sort attributes alphabetically to ensure deterministic order regardless of original XML order
      lines.push(parts.join(' '));
    }
  }
  return lines.join('\n');
}

/**
 * Compute a deterministic fingerprint hash for a UI XML dump.
 * @param {string} xml - Raw uiautomator XML
 * @returns {string} Hex SHA-256 hash (first 16 chars for brevity)
 */
function compute(xml) {
  const normalized = normalize(xml);
  if (!normalized) return 'empty_screen';
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Compute a fuzzy fingerprint that groups structurally similar screens.
 * Two screens with the same element types/counts but different text/content
 * will share a fuzzy fingerprint (e.g. two product detail pages).
 *
 * @param {string} xml - Raw uiautomator XML
 * @param {string} activity - Current activity name
 * @returns {string} Hex SHA-256 hash (first 16 chars)
 */
function computeFuzzy(xml, activity) {
  if (!xml) return 'empty_screen_fuzzy';

  const classNames = new Set();
  const resourceIds = new Set();
  let interactableCount = 0;
  let scrollableCount = 0;

  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];

    const classMatch = attrs.match(/class="([^"]*)"/);
    if (classMatch) classNames.add(classMatch[1]);

    const idMatch = attrs.match(/resource-id="([^"]*)"/);
    if (idMatch && idMatch[1]) resourceIds.add(idMatch[1]);

    if (/clickable="true"/.test(attrs) || /checkable="true"/.test(attrs)) {
      interactableCount++;
    }
    if (/scrollable="true"/.test(attrs)) {
      scrollableCount++;
    }
  }

  const payload = [
    [...classNames].sort().join(','),
    [...resourceIds].sort().join(','),
    String(interactableCount),
    String(scrollableCount),
    (activity || '').toLowerCase(),
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16);
}

module.exports = { compute, computeFuzzy, normalize };
