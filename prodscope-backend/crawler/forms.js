/**
 * forms.js — Form detection and credential filling
 * Detects login/signup screens and fills fields using provided credentials.
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');

/**
 * Heuristic keywords for field type detection.
 */
const FIELD_PATTERNS = {
  username: ['username', 'user name', 'user_name', 'email', 'e-mail', 'phone', 'mobile', 'login', 'account', 'userid'],
  password: ['password', 'passwd', 'pass_word', 'passcode'],
};

/**
 * Detect if the current screen is a login/signup form.
 * @param {string} xml - UI XML dump
 * @returns {{ isForm: boolean, fields: Array<{ type: string, bounds: object, resourceId: string }> }}
 */
function detectForm(xml) {
  if (!xml) return { isForm: false, fields: [] };

  const fields = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const cls = get('class').toLowerCase();
    const isEdit = cls.includes('edittext') || get('editable') === 'true';
    if (!isEdit) continue;

    const rid = get('resource-id').toLowerCase();
    const text = get('text').toLowerCase();
    const hint = get('content-desc').toLowerCase();
    const combined = `${rid} ${text} ${hint}`;
    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    // Classify field
    let fieldType = 'unknown';
    if (FIELD_PATTERNS.password.some(k => combined.includes(k))) {
      fieldType = 'password';
    } else if (FIELD_PATTERNS.username.some(k => combined.includes(k))) {
      fieldType = 'username';
    }

    if (fieldType !== 'unknown') {
      fields.push({ type: fieldType, bounds, resourceId: get('resource-id'), hint: combined.trim() });
    }
  }

  return { isForm: fields.length > 0, fields };
}

/**
 * Fill a detected form with credentials.
 * @param {Array} fields - From detectForm()
 * @param {object} credentials - { username, password } from job opts
 * @param {Function} sleepFn - async sleep function
 * @returns {Array<object>} Actions taken
 */
async function fillForm(fields, credentials, sleepFn) {
  if (!credentials) return [];

  const actionsTaken = [];
  const username = credentials.username || credentials.email || '';
  const password = credentials.password || '';

  // Sort fields by Y position (top to bottom)
  const sorted = [...fields].sort((a, b) => a.bounds.cy - b.bounds.cy);

  for (const field of sorted) {
    const value = field.type === 'password' ? password : username;
    if (!value) continue;

    // Tap the field to focus
    adb.tap(field.bounds.cx, field.bounds.cy);
    await sleepFn(500);

    // Clear existing text and type new value
    adb.run('adb shell input keyevent KEYCODE_MOVE_END', { ignoreError: true });
    adb.run('adb shell input keyevent --longpress $(printf "KEYCODE_DEL %.0s" {1..50})', { ignoreError: true });
    adb.inputText(value);
    await sleepFn(300);

    actionsTaken.push({ type: 'fill', field: field.type, resourceId: field.resourceId });
    console.log(`  [forms] Filled ${field.type} field (${field.resourceId})`);
  }

  return actionsTaken;
}

module.exports = { detectForm, fillForm };
