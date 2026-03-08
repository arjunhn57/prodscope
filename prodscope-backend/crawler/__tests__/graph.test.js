/**
 * Tests for graph.js — visited-state graph and loop detection
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { StateGraph } = require('../graph');

describe('StateGraph', () => {
  it('should track new states and visit counts', () => {
    const g = new StateGraph();
    g.addState('abc123', { activity: 'com.example/.Main' });
    assert.ok(g.isVisited('abc123'));
    assert.strictEqual(g.visitCount('abc123'), 1);

    g.addState('abc123', { activity: 'com.example/.Main' });
    assert.strictEqual(g.visitCount('abc123'), 2);
  });

  it('should report unvisited states correctly', () => {
    const g = new StateGraph();
    assert.ok(!g.isVisited('never_seen'));
    assert.strictEqual(g.visitCount('never_seen'), 0);
  });

  it('should track transitions', () => {
    const g = new StateGraph();
    g.addState('s1', {});
    g.addState('s2', {});
    g.addTransition('s1', 'tap:btn', 's2');

    const json = g.toJSON();
    assert.strictEqual(json.transitions.length, 1);
    assert.strictEqual(json.transitions[0].from, 's1');
    assert.strictEqual(json.transitions[0].to, 's2');
    assert.strictEqual(json.transitions[0].action, 'tap:btn');
  });

  it('should track tried actions per state', () => {
    const g = new StateGraph();
    g.addState('s1', {});
    g.addTransition('s1', 'tap:a', 's2');
    g.addTransition('s1', 'tap:b', 's3');

    const tried = g.triedActionsFor('s1');
    assert.ok(tried.has('tap:a'));
    assert.ok(tried.has('tap:b'));
    assert.ok(!tried.has('tap:c'));
  });

  it('should count unique states', () => {
    const g = new StateGraph();
    g.addState('s1', {});
    g.addState('s2', {});
    g.addState('s1', {}); // revisit
    assert.strictEqual(g.uniqueStateCount(), 2);
  });
});

describe('StateGraph.detectLoop', () => {
  it('should not detect a loop with diverse history', () => {
    const g = new StateGraph();
    ['s1', 's2', 's3', 's4', 's5', 's6'].forEach(s => g.addState(s, {}));
    assert.ok(!g.detectLoop(6, 2), 'No loop with 6 unique states in window of 6');
  });

  it('should detect a loop when cycling between 2 states', () => {
    const g = new StateGraph();
    ['s1', 's2', 's1', 's2', 's1', 's2'].forEach(s => g.addState(s, {}));
    assert.ok(g.detectLoop(6, 2), 'Should detect loop: only 2 unique in window of 6');
  });

  it('should detect a loop when stuck on single state', () => {
    const g = new StateGraph();
    ['s1', 's1', 's1', 's1', 's1', 's1'].forEach(s => g.addState(s, {}));
    assert.ok(g.detectLoop(6, 2), 'Should detect loop: only 1 unique in window of 6');
  });

  it('should not detect a loop with insufficient history', () => {
    const g = new StateGraph();
    g.addState('s1', {});
    g.addState('s1', {});
    assert.ok(!g.detectLoop(6, 2), 'Not enough history to detect a loop');
  });
});

describe('StateGraph.toJSON', () => {
  it('should serialize to valid JSON structure', () => {
    const g = new StateGraph();
    g.addState('s1', { activity: 'com.example/.Main', screenshotPath: '/tmp/s1.png' });
    g.addState('s2', { activity: 'com.example/.Detail' });
    g.addTransition('s1', 'tap:btn', 's2');

    const json = g.toJSON();
    assert.strictEqual(json.uniqueStates, 2);
    assert.strictEqual(json.totalSteps, 2);
    assert.strictEqual(json.nodes.length, 2);
    assert.strictEqual(json.transitions.length, 1);

    // Verify round-trip through JSON.stringify
    const str = JSON.stringify(json);
    const parsed = JSON.parse(str);
    assert.deepStrictEqual(parsed.uniqueStates, json.uniqueStates);
  });

  it('should include tried actions in node data', () => {
    const g = new StateGraph();
    g.addState('s1', {});
    g.addTransition('s1', 'tap:x', 's2');

    const json = g.toJSON();
    const node = json.nodes.find(n => n.fingerprint === 's1');
    assert.ok(node.triedActions.includes('tap:x'));
  });
});
