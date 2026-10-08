const assert = require('assert');
const { normalizeFeedMode, normalizeHistoryDays, isVisibleInFeedMode, projectHistory } = require('./feed-state.js');

const history = [
  { id: 'selected', selected: true },
  { id: 'all-only', selected: false },
  { id: 'truthy-non-boolean', selected: 1 },
  { id: 'legacy' }
];

assert.strictEqual(normalizeFeedMode('all'), 'all');
assert.strictEqual(normalizeFeedMode(undefined), 'all');
assert.strictEqual(normalizeFeedMode('unexpected'), 'all');
assert.strictEqual(isVisibleInFeedMode(history[0], 'selected'), true);
assert.strictEqual(isVisibleInFeedMode(history[1], 'selected'), false);
assert.strictEqual(isVisibleInFeedMode(history[2], 'selected'), false);
assert.deepStrictEqual(projectHistory(history, 'selected').map(item => item.id), ['selected']);
assert.deepStrictEqual(projectHistory(history, 'all').map(item => item.id), ['selected', 'all-only', 'truthy-non-boolean', 'legacy']);
assert.strictEqual(normalizeHistoryDays('7'), 7);
assert.strictEqual(normalizeHistoryDays(8), 7);
assert.strictEqual(normalizeHistoryDays(0), 1);
assert.strictEqual(normalizeHistoryDays('invalid'), 1);
console.log('结果: 12 passed, 0 failed');
