/**
 * screen-intent.js
 * Classifies the current screen into a reusable semantic intent.
 */

function detectScreenIntent(xml) {
  const text = String(xml || '').toLowerCase();

  const has = (re) => re.test(text);

  const signals = {
    hasEmail: has(/\bemail\b|\be-mail\b|continue with email|login with email|enter email/),
    hasPhone: has(/\bphone\b|\bmobile\b|phone number|mobile number|enter phone|enter mobile/),
    hasPassword: has(/\bpassword\b|\bpasscode\b|\bpin\b/),
    hasOtp: has(/\botp\b|verification code|one time password|enter code|verify otp|verify code/),
    hasLogin: has(/\blogin\b|\blog in\b|\bsign in\b/),
    hasSignup: has(/\bsign up\b|\bregister\b|create account/),
    hasContinue: has(/\bcontinue\b|\bnext\b|\bproceed\b/),
    hasGoogle: has(/google/),
    hasApple: has(/apple/),
    hasPermission: has(/allow|while using the app|permission/),
    hasError: has(/invalid|required|already exists|already registered|incorrect|try again|error|failed/),
  };

  let type = 'unknown';
  let confidence = 0.4;

  if (signals.hasPermission) {
    type = 'permission_prompt';
    confidence = 0.95;
  } else if (signals.hasPhone && !signals.hasPassword) {
    type = 'phone_entry';
    confidence = signals.hasOtp ? 0.92 : 0.85;
  } else if (signals.hasEmail && signals.hasPassword && signals.hasLogin) {
    type = 'email_login';
    confidence = 0.97;
  } else if (signals.hasEmail && signals.hasPassword && signals.hasSignup) {
    type = 'email_signup';
    confidence = 0.97;
  } else if (signals.hasOtp && !signals.hasPhone && !signals.hasEmail) {
    type = 'otp_verification';
    confidence = 0.9;
  } else if (
    (signals.hasGoogle || signals.hasApple || signals.hasEmail || signals.hasPhone) &&
    (signals.hasContinue || signals.hasLogin || signals.hasSignup)
  ) {
    type = 'auth_choice';
    confidence = 0.8;
  } else if (signals.hasEmail && !signals.hasPassword) {
    type = 'email_entry';
    confidence = 0.75;
  }

  return {
    type,
    confidence,
    signals,
  };
}

module.exports = { detectScreenIntent };
