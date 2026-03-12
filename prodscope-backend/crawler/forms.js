/**
 * forms.js - Form detection and credential filling
 * Detects login/signup screens and fills fields using provided credentials.
 */

const adb = require('./adb');
const { parseBounds } = require('./actions');

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
    'full name',
    'name',
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
    'verification',
  ],
};

function classifyField(combined, isPasswordAttr) {
  if (isPasswordAttr) return 'password';
  if (FIELD_PATTERNS.password.some((k) => combined.includes(k))) return 'password';
  if (FIELD_PATTERNS.otp.some((k) => combined.includes(k))) return 'otp';
  if (FIELD_PATTERNS.email.some((k) => combined.includes(k))) return 'email';
  if (FIELD_PATTERNS.phone.some((k) => combined.includes(k))) return 'phone';
  if (FIELD_PATTERNS.username.some((k) => combined.includes(k))) return 'username';
  return 'unknown';
}

/**
 * Detect if the current screen is a login/signup form.
 * @param {string} xml - UI XML dump
 * @returns {{ isForm: boolean, fields: Array<{ type: string, bounds: object, resourceId: string }> }}
 */
function detectForm(xml) {
  if (!xml) return { isForm: false, fields: [] };

  const rawFields = [];
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
    const isPasswordAttr = get('password') === 'true';
    const combined = `${rid} ${text} ${hint}`.trim();
    const boundsStr = get('bounds');
    const bounds = parseBounds(boundsStr);
    if (!bounds) continue;

    rawFields.push({
      type: classifyField(combined, isPasswordAttr),
      bounds,
      resourceId: get('resource-id'),
      hint: combined,
      isPasswordAttr,
      text,
      rid,
    });
  }

  if (!rawFields.length) return { isForm: false, fields: [] };

  const sorted = [...rawFields].sort((a, b) => {
    if (a.bounds.cy !== b.bounds.cy) return a.bounds.cy - b.bounds.cy;
    return a.bounds.cx - b.bounds.cx;
  });

  const knownCount = sorted.filter((f) => f.type !== 'unknown').length;

  if (knownCount === 0) {
    if (sorted.length === 1) {
      sorted[0].type = 'email';
    } else if (sorted.length === 2) {
      sorted[0].type = 'email';
      sorted[1].type = sorted[1].isPasswordAttr ? 'password' : 'password';
    } else if (sorted.length >= 3) {
      sorted[0].type = 'email';
      sorted[1].type = sorted[1].isPasswordAttr ? 'password' : 'password';
      sorted[2].type = sorted[2].isPasswordAttr ? 'password' : 'otp';
    }
  } else {
    const hasPassword = sorted.some((f) => f.type === 'password');
    const hasOtp = sorted.some((f) => f.type === 'otp');

    if (hasPassword) {
      for (const field of sorted) {
        if (field.type === 'unknown') {
          field.type = 'email';
          break;
        }
      }
      for (const field of sorted) {
        if (field.type === 'unknown') {
          field.type = hasOtp ? 'otp' : 'username';
        }
      }
    } else {
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].type === 'unknown') {
          if (i === 0) sorted[i].type = 'email';
          else if (i === 1) sorted[i].type = 'password';
          else sorted[i].type = hasOtp ? 'otp' : 'username';
        }
      }
    }
  }

  const fields = sorted.filter((f) => f.type !== 'unknown').map((f) => ({
    type: f.type,
    bounds: f.bounds,
    resourceId: f.resourceId,
    hint: f.hint,
  }));

  const hasAuthIntent =
    /sign in|login|log in|sign up|register|create account|continue|verify|password|email|phone|otp/i.test(xml);

  return {
    isForm: fields.length > 0 && (hasAuthIntent || fields.length >= 1),
    fields,
  };
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
    console.log(`  [forms] Filled ${field.type} field (${field.resourceId || 'no_resource_id'})`);
  }

  return actionsTaken;
}

module.exports = { detectForm, fillForm };
