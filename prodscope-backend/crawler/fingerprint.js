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
  'resource-id',
  'text',
  'content-desc',
  'clickable',
  'editable',       // custom, see normalize
  'input-type',     // custom, see normalize
  'package',
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
        parts.push(`${attr}="${attrMatch[1]}"`);
      }
    }
    if (parts.length > 0) {
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

module.exports = { compute, normalize };
