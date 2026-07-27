const assert = require('assert');
const { normalizeFeedMode, isVisibleInFeedMode, projectHistory } = require('./feed-state.js');

const history = [
  { id: 'selected', selected: true },
  { id: 'all-only', selected: false },
  { id: 'truthy-non-boolean', selected: 1 },
  { id: 'legacy' }
];

assert.strictEqual(normalizeFeedMode('all'), 'all');
assert.strictEqual(normalizeFeedMode('unexpected'), 'selected');
assert.strictEqual(isVisibleInFeedMode(history[0], 'selected'), true);
assert.strictEqual(isVisibleInFeedMode(history[1], 'selected'), false);
assert.strictEqual(isVisibleInFeedMode(history[2], 'selected'), false);
assert.deepStrictEqual(projectHistory(history, 'selected').map(item => item.id), ['selected']);
assert.deepStrictEqual(projectHistory(history, 'all').map(item => item.id), ['selected', 'all-only', 'truthy-non-boolean', 'legacy']);
console.log('结果: 7 passed, 0 failed');
