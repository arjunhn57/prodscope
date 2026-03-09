/**
 * Tests for fingerprint.js — deterministic screen fingerprinting
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { compute, normalize } = require('../fingerprint');

const SAMPLE_XML_1 = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" focused="false" selected="false" />
    <node index="1" text="" resource-id="com.example:id/email" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" focused="true" />
    <node index="2" text="Login" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;

// Same structure, different bounds and focus state
const SAMPLE_XML_1_DIFFERENT_BOUNDS = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,2400]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[50,100][1030,250]" clickable="false" focused="true" selected="true" />
    <node index="1" text="" resource-id="com.example:id/email" class="android.widget.EditText" package="com.example" bounds="[50,300][1030,430]" clickable="true" focused="false" />
    <node index="2" text="Login" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[250,500][830,630]" clickable="true" />
  </node>
</hierarchy>`;

// Different text content
const SAMPLE_XML_2 = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Dashboard" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" />
    <node index="1" text="Settings" resource-id="com.example:id/settings_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;

// Same structural text, but different volatile numbers (like time or unread counts)
const SAMPLE_XML_1_DIFFERENT_NUMBERS = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" focused="false" selected="false">
      <node text="11:45 AM" class="SysTime" />
    </node>
    <node index="1" text="" resource-id="com.example:id/email1" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" focused="true" />
    <node index="2" text="Login 2" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;

// Alternative volatile numbers (time changed, text changed slightly but only the numbers)
const SAMPLE_XML_1_DIFFERENT_NUMBERS_2 = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" focused="false" selected="false">
      <node text="12:00 PM" class="SysTime" />
    </node>
    <node index="1" text="" resource-id="com.example:id/email9" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" focused="true" />
    <node index="2" text="Login 9" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,600][780,700]" clickable="true" />
  </node>
</hierarchy>`;

describe('fingerprint.compute', () => {
  it('should return a non-empty hash for valid XML', () => {
    const hash = compute(SAMPLE_XML_1);
    assert.ok(hash, 'Hash should be non-empty');
    assert.ok(hash.length > 0, 'Hash should have length > 0');
    assert.notStrictEqual(hash, 'empty_screen');
  });

  it('should return "empty_screen" for empty/null input', () => {
    assert.strictEqual(compute(''), 'empty_screen');
    assert.strictEqual(compute(null), 'empty_screen');
    assert.strictEqual(compute(undefined), 'empty_screen');
  });

  it('should produce the same hash for the same XML', () => {
    const h1 = compute(SAMPLE_XML_1);
    const h2 = compute(SAMPLE_XML_1);
    assert.strictEqual(h1, h2, 'Same XML should produce same hash');
  });

  it('should produce the same hash when only bounds/focus/selected differ', () => {
    const h1 = compute(SAMPLE_XML_1);
    const h2 = compute(SAMPLE_XML_1_DIFFERENT_BOUNDS);
    assert.strictEqual(h1, h2, 'Different bounds/focus should produce same hash');
  });

  it('should produce different hashes for structurally different screens', () => {
    const h1 = compute(SAMPLE_XML_1);
    const h2 = compute(SAMPLE_XML_2);
    assert.notStrictEqual(h1, h2, 'Different screens should produce different hashes');
  });

  it('should mask numbers and produce identical hashes for screens that only differ by numbers', () => {
    const h1 = compute(SAMPLE_XML_1_DIFFERENT_NUMBERS);
    const h2 = compute(SAMPLE_XML_1_DIFFERENT_NUMBERS_2);
    assert.strictEqual(h1, h2, 'Different numbers should be masked and produce same hash');
  });
});

describe('fingerprint.normalize', () => {
  it('should strip bounds from the normalized output', () => {
    const normalized = normalize(SAMPLE_XML_1);
    assert.ok(!normalized.includes('bounds='), 'Normalized should not contain bounds');
  });

  it('should preserve text and resource-id but lowercase them', () => {
    const normalized = normalize(SAMPLE_XML_1);
    assert.ok(normalized.includes('text="welcome"'), 'Should preserve and lowercase text');
    assert.ok(normalized.includes('resource-id="com.example:id/title"'), 'Should preserve resource-id');
  });

  it('should mask numbers in text and resource-id', () => {
    const normalized = normalize(SAMPLE_XML_1_DIFFERENT_NUMBERS);
    assert.ok(normalized.includes('text="##:##"'), 'Should mask time numbers and strip am/pm');
    assert.ok(normalized.includes('resource-id="com.example:id/email#"'), 'Should mask ID numbers');
    assert.ok(normalized.includes('text="login #"'), 'Should mask other text numbers');
  });

  it('should return empty string for empty input', () => {
    assert.strictEqual(normalize(''), '');
    assert.strictEqual(normalize(null), '');
  });
});
