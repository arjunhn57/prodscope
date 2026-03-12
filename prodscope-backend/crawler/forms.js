/**
 * forms.js - Form detection and credential filling
 * Detects login/signup screens and fills fields using provided credentials.
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');

/**
 * Heuristic keywords for field type detection.
 */
const FIELD_PATTERNS = {
  email: [
    'email',
    'e-mail',
    'mail',
  ],
  phone: [
    'phone',
    'mobile',
    'mobile number',
    'phone number',
    'enter phone',
    'enter mobile',
    'contact number',
  ],
  username: [
    'username',
    'user name',
    'user_name',
    'login',
    'account',
    'userid',
    'user id',
  ],
  password: [
    'password',
    'passwd',
    'pass_word',
    'passcode',
    'pin',
  ],
  otp: [
    'otp',
    'verification code',
    'code',
    'enter code',
    'one time password',
  ],
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

    let fieldType = 'unknown';

    if (FIELD_PATTERNS.password.some(k => combined.includes(k))) {
      fieldType = 'password';
    } else if (FIELD_PATTERNS.otp.some(k => combined.includes(k))) {
      fieldType = 'otp';
    } else if (FIELD_PATTERNS.email.some(k => combined.includes(k))) {
      fieldType = 'email';
    } else if (FIELD_PATTERNS.phone.some(k => combined.includes(k))) {
      fieldType = 'phone';
    } else if (FIELD_PATTERNS.username.some(k => combined.includes(k))) {
      fieldType = 'username';
    }

    if (fieldType !== 'unknown') {
      fields.push({
        type: fieldType,
        bounds,
        resourceId: get('resource-id'),
        hint: combined.trim(),
      });
    }
  }

  return { isForm: fields.length > 0, fields };
}

/**
 * Fill a detected form with credentials.
 * @param {Array} fields - From detectForm()
 * @param {object} credentials - { username, email, phone, password, otp } from job opts
 * @param {Function} sleepFn - async sleep function
 * @returns {Array<object>} Actions taken
 */
async function fillForm(fields, credentials, sleepFn) {
  if (!credentials) return [];

  const actionsTaken = [];
  const username = credentials.username || '';
  const email = credentials.email || credentials.username || '';
  const phone = credentials.phone || credentials.username || '';
  const password = credentials.password || '';
  const otp = credentials.otp || '';

  const sorted = [...fields].sort((a, b) => a.bounds.cy - b.bounds.cy);

  for (const field of sorted) {
    let value = '';

    if (field.type === 'password') {
      value = password;
    } else if (field.type === 'email') {
      value = email;
    } else if (field.type === 'phone') {
      value = phone;
    } else if (field.type === 'otp') {
      value = otp;
    } else if (field.type === 'username') {
      value = username || email || phone;
    }

    if (!value) continue;

    adb.tap(field.bounds.cx, field.bounds.cy);
    await sleepFn(500);

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
