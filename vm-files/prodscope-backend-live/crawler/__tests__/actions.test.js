/**
 * Tests for actions.js — action extraction and ranking
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extract, scorePriority, parseBounds, ACTION_TYPES } = require('../actions');

const LOGIN_SCREEN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false" scrollable="false">
    <node index="0" text="Welcome" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" bounds="[100,200][980,300]" clickable="false" scrollable="false" />
    <node index="1" text="" resource-id="com.example:id/email" class="android.widget.EditText" package="com.example" bounds="[100,400][980,500]" clickable="true" scrollable="false" />
    <node index="2" text="" resource-id="com.example:id/password" class="android.widget.EditText" package="com.example" bounds="[100,550][980,650]" clickable="true" scrollable="false" />
    <node index="3" text="Sign In" resource-id="com.example:id/login_btn" class="android.widget.Button" package="com.example" bounds="[300,700][780,800]" clickable="true" scrollable="false" />
    <node index="4" text="Forgot Password?" resource-id="com.example:id/forgot" class="android.widget.TextView" package="com.example" bounds="[350,850][730,900]" clickable="true" scrollable="false" />
  </node>
</hierarchy>`;

const SCROLLABLE_LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false" scrollable="false">
    <node index="0" text="" resource-id="com.example:id/list" class="android.widget.RecyclerView" package="com.example" bounds="[0,200][1080,1800]" clickable="false" scrollable="true">
      <node index="0" text="Item 1" resource-id="com.example:id/item" class="android.widget.TextView" package="com.example" bounds="[20,220][1060,320]" clickable="true" scrollable="false" />
      <node index="1" text="Item 2" resource-id="com.example:id/item" class="android.widget.TextView" package="com.example" bounds="[20,340][1060,440]" clickable="true" scrollable="false" />
    </node>
  </node>
</hierarchy>`;

describe('parseBounds', () => {
  it('should parse valid bounds string', () => {
    const b = parseBounds('[100,200][300,400]');
    assert.deepStrictEqual(b, { x1: 100, y1: 200, x2: 300, y2: 400, cx: 200, cy: 300 });
  });

  it('should return null for invalid bounds', () => {
    assert.strictEqual(parseBounds('invalid'), null);
    assert.strictEqual(parseBounds(''), null);
  });
});

describe('actions.extract', () => {
  it('should extract editable fields as TYPE actions from login screen', () => {
    const result = extract(LOGIN_SCREEN_XML);
    const typeActions = result.filter(a => a.type === ACTION_TYPES.TYPE);
    assert.strictEqual(typeActions.length, 2, 'Should find 2 editable fields');
  });

  it('should extract tappable buttons as TAP actions', () => {
    const result = extract(LOGIN_SCREEN_XML);
    const tapActions = result.filter(a => a.type === ACTION_TYPES.TAP);
    assert.ok(tapActions.length >= 2, 'Should find at least Sign In and Forgot Password');
  });

  it('should extract scroll actions from scrollable containers', () => {
    const result = extract(SCROLLABLE_LIST_XML);
    const scrollActions = result.filter(a => a.type === ACTION_TYPES.SCROLL_DOWN || a.type === ACTION_TYPES.SCROLL_UP);
    assert.ok(scrollActions.length >= 1, 'Should find scroll actions');
  });

  it('should always include a BACK action', () => {
    const result = extract(LOGIN_SCREEN_XML);
    const backActions = result.filter(a => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(backActions.length, 1, 'Should have exactly one BACK action');
  });

  it('should filter out already-tried actions', () => {
    const tried = new Set(['back']);
    const result = extract(LOGIN_SCREEN_XML, tried);
    const backActions = result.filter(a => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(backActions.length, 0, 'BACK should be filtered out');
  });

  it('should return empty array for empty XML', () => {
    const result = extract('');
    assert.strictEqual(result.length, 0);
  });
});

describe('action ranking', () => {
  it('should rank TYPE (form fields) higher than TAP (buttons)', () => {
    const result = extract(LOGIN_SCREEN_XML);
    const typeAction = result.find(a => a.type === ACTION_TYPES.TYPE);
    const tapAction = result.find(a => a.type === ACTION_TYPES.TAP && a.text !== 'Sign In');
    assert.ok(typeAction, 'Should have a TYPE action');
    assert.ok(tapAction, 'Should have a TAP action');
    assert.ok(typeAction.priority > tapAction.priority,
      `TYPE priority (${typeAction.priority}) should be > TAP priority (${tapAction.priority})`);
  });

  it('should rank login buttons above generic clickables', () => {
    const result = extract(LOGIN_SCREEN_XML);
    const signIn = result.find(a => a.text === 'Sign In');
    const forgot = result.find(a => a.text === 'Forgot Password?');
    assert.ok(signIn, 'Should find Sign In');
    assert.ok(forgot, 'Should find Forgot Password');
    assert.ok(signIn.priority > forgot.priority,
      `Sign In priority (${signIn.priority}) should be > Forgot Password (${forgot.priority})`);
  });

  it('should rank BACK lowest among actions', () => {
    const result = extract(LOGIN_SCREEN_XML);
    const back = result.find(a => a.type === ACTION_TYPES.BACK);
    const others = result.filter(a => a.type !== ACTION_TYPES.BACK);
    for (const a of others) {
      assert.ok(a.priority >= back.priority,
        `${a.type} (${a.priority}) should be >= BACK (${back.priority})`);
    }
  });

  it('should return results sorted by priority descending', () => {
    const result = extract(LOGIN_SCREEN_XML);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].priority >= result[i].priority,
        `Actions should be sorted descending: [${i-1}]=${result[i-1].priority} >= [${i}]=${result[i].priority}`);
    }
  });
});
