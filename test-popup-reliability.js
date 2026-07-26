/**
 * Popup reliability helpers
 * 运行: node test-popup-reliability.js
 */

const assert = require('assert');
const {
  createMutationQueue,
  createFeedModeSwitchController,
  getSafeHttpsUrl,
  openHttpsUrl
} = require('./popup-reliability.js');

async function waitFor(check) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for test condition');
}

async function testMutationQueue() {
  const enqueue = createMutationQueue();
  const events = [];
  let releaseFirst;
  const first = enqueue(async () => {
    events.push('first:start');
    await new Promise(resolve => { releaseFirst = resolve; });
    events.push('first:end');
  });
  const second = enqueue(async () => events.push('second'));

  await waitFor(() => releaseFirst);
  assert.deepStrictEqual(events, ['first:start'], 'queue must not start the second mutation early');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepStrictEqual(events, ['first:start', 'first:end', 'second'], 'queue preserves mutation order');
}

async function testFeedModeStaleResponseAndRollback() {
  const enqueue = createMutationQueue();
  const requests = [];
  const persisted = [];
  const rollbacks = [];
  const disabledStates = [];
  const controller = createFeedModeSwitchController({
    enqueue,
    setDisabled: value => disabledStates.push(value),
    sendChange: mode => new Promise(resolve => requests.push({ mode, resolve })),
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    loadHistory: async () => {},
    persist: mode => persisted.push(mode),
    rollback: async mode => rollbacks.push(mode),
    onSuccess: () => {},
    onFailure: () => {}
  });

  const first = controller.switchFeedMode('all', 'selected');
  const second = controller.switchFeedMode('selected', 'all');
  await waitFor(() => requests.length === 1);
  assert.strictEqual(requests[0].mode, 'all', 'first request starts first');
  requests[0].resolve({ ok: true });
  await waitFor(() => requests.length === 2);
  assert.deepStrictEqual(persisted, [], 'stale response must not persist the old selection');
  assert.strictEqual(requests[1].mode, 'selected', 'latest request follows after the stale response');
  requests[1].resolve({ ok: true });
  await Promise.all([first, second]);
  assert.deepStrictEqual(persisted, ['selected'], 'only the latest source selection persists');
  assert.deepStrictEqual(rollbacks, [], 'successful latest selection does not roll back');
  assert.strictEqual(disabledStates.at(-1), false, 'latest request restores the selector');

  const failedRollbacks = [];
  const failingController = createFeedModeSwitchController({
    enqueue: createMutationQueue(),
    setDisabled: () => {},
    sendChange: async () => ({ ok: false, error: 'network failed' }),
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    loadHistory: async () => {},
    persist: () => assert.fail('failed switch must not persist the requested mode'),
    rollback: async mode => failedRollbacks.push(mode),
    onSuccess: () => assert.fail('failed switch must not report success'),
    onFailure: () => {}
  });
  await failingController.switchFeedMode('all', 'selected');
  assert.deepStrictEqual(failedRollbacks, ['selected'], 'failed source switch rolls storage back to the previous mode');
}

async function testSafeOpenReadOrdering() {
  assert.strictEqual(getSafeHttpsUrl('https://example.com/a'), 'https://example.com/a');
  assert.strictEqual(getSafeHttpsUrl('http://example.com/a'), '');
  assert.strictEqual(getSafeHttpsUrl('javascript:alert(1)'), '');

  const events = [];
  const opened = await openHttpsUrl(
    'https://example.com/a',
    async () => events.push('tab'),
    async () => events.push('read')
  );
  assert.deepStrictEqual(events, ['tab', 'read'], 'read state changes only after tab creation succeeds');
  assert.strictEqual(opened.ok, true);

  const failed = await openHttpsUrl(
    'https://example.com/a',
    async () => { throw new Error('blocked'); },
    async () => events.push('unexpected-read')
  );
  assert.strictEqual(failed.ok, false);
  assert(!events.includes('unexpected-read'), 'tab creation failure does not submit read state');
}

(async () => {
  await testMutationQueue();
  await testFeedModeStaleResponseAndRollback();
  await testSafeOpenReadOrdering();
  console.log('结果: 3 passed, 0 failed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
