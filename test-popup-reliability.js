/**
 * Popup reliability helpers
 * 运行: node test-popup-reliability.js
 */

const assert = require('assert');
const {
  createMutationQueue,
  createFeedModeSwitchController,
  createLatestWinsLoadController,
  createAllFeedContinuationStatusController,
  createPopupStorageChangeHandler,
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runOnly() {
      assert.strictEqual(timers.size, 1, 'exactly one trailing timer is pending');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    }
  };
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

async function testFeedModeOptimisticProjectionAndLatestWins() {
  const requests = [];
  const projections = [];
  const successes = [];
  const rollbacks = [];
  const disabledStates = [];
  const controller = createFeedModeSwitchController({
    initialMode: 'selected',
    setDisabled: value => disabledStates.push(value),
    sendChange: mode => new Promise(resolve => requests.push({ mode, resolve })),
    loadProjection: (mode, options) => {
      projections.push({ mode, ...options });
      return Promise.resolve();
    },
    readCommittedMode: async () => 'selected',
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    rollback: async mode => rollbacks.push(mode),
    onSuccess: (_failCount, _context, mode) => successes.push(mode),
    onFailure: () => {}
  });

  const first = controller.switchFeedMode('all');
  assert.deepStrictEqual(projections[0], { mode: 'all', immediate: true, switchRequestId: 1 }, 'pending mode projects immediately before network completion');
  assert.strictEqual(requests[0].mode, 'all', 'source change starts without waiting for projection completion');
  assert.deepStrictEqual(controller.getState(), { committedMode: 'selected', pendingMode: 'all', switchRequestId: 1 }, 'controller owns committed and pending mode state');

  const second = controller.switchFeedMode('selected');
  assert.strictEqual(requests.length, 2, 'newer switch does not wait behind older network request');
  requests[0].resolve({ ok: true });
  await Promise.resolve();
  assert.deepStrictEqual(successes, [], 'stale completion cannot update controls, cache, or status');
  requests[1].resolve({ ok: true });
  await Promise.all([first, second]);
  assert.deepStrictEqual(successes, ['selected'], 'only the latest source selection reports success');
  assert.deepStrictEqual(rollbacks, [], 'successful latest selection does not roll back');
  assert.strictEqual(disabledStates.at(-1), false, 'latest request restores the selector');
  assert.deepStrictEqual(controller.getState(), { committedMode: 'selected', pendingMode: null, switchRequestId: 2 }, 'latest success becomes the committed mode');

  const failedRollbacks = [];
  const failedProjections = [];
  const failingController = createFeedModeSwitchController({
    initialMode: 'selected',
    setDisabled: () => {},
    sendChange: async () => ({ ok: false, error: 'network failed' }),
    loadProjection: async (mode, options) => failedProjections.push({ mode, ...options }),
    readCommittedMode: async () => 'selected',
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    rollback: async mode => failedRollbacks.push(mode),
    onSuccess: () => assert.fail('failed switch must not report success'),
    onFailure: () => {}
  });
  await failingController.switchFeedMode('all');
  assert.deepStrictEqual(failedRollbacks, ['selected'], 'failed switch rereads authoritative mode and rolls back UI/cache only');
  assert.deepStrictEqual(failedProjections.map(entry => entry.mode), ['all', 'selected'], 'failure replaces optimistic projection with authoritative projection');
}

async function testStaleSwitchCannotInvalidateNewOptimisticLoad() {
  const requests = [];
  const projections = [];
  const controller = createFeedModeSwitchController({
    initialMode: 'selected',
    setDisabled: () => {},
    sendChange: mode => new Promise(resolve => requests.push({ mode, resolve })),
    loadProjection: mode => {
      const deferred = createDeferred();
      projections.push({ mode, deferred });
      return deferred.promise;
    },
    readCommittedMode: async () => 'selected',
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    rollback: async () => {},
    onSuccess: () => {},
    onFailure: () => {}
  });

  const first = controller.switchFeedMode('all');
  requests[0].resolve({ ok: true });
  await Promise.resolve();
  const second = controller.switchFeedMode('selected');
  projections[0].deferred.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(
    projections.map(entry => entry.mode),
    ['all', 'selected'],
    'stale switch must stop after its deferred optimistic projection and must not start another load'
  );

  requests[1].resolve({ ok: true });
  projections[1].deferred.resolve();
  await waitFor(() => projections.length === 3);
  projections[2].deferred.resolve();
  await Promise.all([first, second]);
}

async function testPendingModeStorageChanges() {
  const requests = [];
  const scheduled = [];
  const controller = createFeedModeSwitchController({
    initialMode: 'selected',
    setDisabled: () => {},
    sendChange: mode => new Promise(resolve => requests.push({ mode, resolve })),
    loadProjection: async () => {},
    readCommittedMode: async () => 'selected',
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    rollback: async () => {},
    onSuccess: () => {},
    onFailure: () => {}
  });
  const handleStorageChange = createPopupStorageChangeHandler({
    getFeedMode: controller.getDisplayMode,
    getSwitchRequestId: () => controller.getState().switchRequestId,
    scheduleLoad: (changes, mode, switchRequestId) => scheduled.push({ changes, mode, switchRequestId })
  });

  const switching = controller.switchFeedMode('all');
  handleStorageChange({ history: { newValue: [] }, feedMode: { newValue: 'selected' } }, 'local');
  assert.strictEqual(scheduled[0].mode, 'all', 'storage changes keep rendering the pending mode during a switch');
  assert.strictEqual(scheduled[0].switchRequestId, 1, 'storage load is fenced by the active switch request');
  requests[0].resolve({ ok: true });
  await switching;
}

async function testLatestWinsLoadCoalescing() {
  const fakeTimers = createFakeTimers();
  const commits = [];
  let reads = 0;
  let switchRequestId = 0;
  const controller = createLatestWinsLoadController({
    read: async () => {
      reads++;
      return { history: [{ id: 'selected', selected: true }, { id: 'all-only', selected: false }] };
    },
    commit: (data, context) => commits.push({ data, context }),
    projectHistory: (history, mode) => mode === 'all' ? history : history.filter(item => item.selected === true),
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    getSwitchRequestId: () => switchRequestId,
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    debounceMs: 25
  });

  controller.scheduleLoad({ history: {} }, 'selected', 0);
  controller.scheduleLoad({ readIds: {} }, 'selected', 0);
  controller.scheduleLoad({ allFeedContinuation: {} }, 'selected', 0);
  assert.strictEqual(fakeTimers.timers.size, 1, 'relevant storage burst coalesces to one trailing load');
  fakeTimers.runOnly();
  await waitFor(() => commits.length === 1);
  assert.strictEqual(reads, 1, 'coalesced storage burst performs one durable read');
  assert.deepStrictEqual(commits[0].data.history.map(item => item.id), ['selected'], 'load projects canonical history before commit callbacks');
  assert.strictEqual(commits[0].data.feedMode, 'selected', 'committed cache data carries its matching normalized mode');

  controller.scheduleLoad({ historyDays: {} }, 'selected', 0);
  assert.strictEqual(fakeTimers.timers.size, 1, 'ordinary change schedules a timer');
  await controller.loadProjection('all', { immediate: true, switchRequestId: 0 });
  assert.strictEqual(fakeTimers.timers.size, 0, 'immediate source projection cancels the pending debounce');
}

async function testLatestWinsLoadDropsStaleReads() {
  const reads = [];
  const commits = [];
  let switchRequestId = 4;
  const controller = createLatestWinsLoadController({
    read: () => {
      const deferred = createDeferred();
      reads.push(deferred);
      return deferred.promise;
    },
    commit: (data, context) => commits.push({ data, context }),
    projectHistory: history => history,
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    getSwitchRequestId: () => switchRequestId
  });

  const first = controller.loadProjection('selected', { immediate: true, switchRequestId: 4 });
  const second = controller.loadProjection('all', { immediate: true, switchRequestId: 4 });
  reads[1].resolve({ history: [{ id: 'newer' }] });
  await second;
  reads[0].resolve({ history: [{ id: 'older' }] });
  await first;
  assert.deepStrictEqual(commits.map(entry => entry.data.history[0].id), ['newer'], 'older load completion performs zero observable callbacks');

  const fenced = controller.loadProjection('all', { immediate: true, switchRequestId: 4 });
  switchRequestId = 5;
  reads[2].resolve({ history: [{ id: 'wrong-switch' }] });
  await fenced;
  assert.deepStrictEqual(commits.map(entry => entry.data.history[0].id), ['newer'], 'load captured by a stale switch request performs zero callbacks');
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

async function testPopupHistoryRenderOwnership() {
  const scheduled = [];
  const handleStorageChange = createPopupStorageChangeHandler({
    getFeedMode: () => 'all',
    getSwitchRequestId: () => 7,
    scheduleLoad: (changes, mode, requestId) => scheduled.push({ changes, mode, requestId })
  });
  handleStorageChange({
    history: { newValue: [] },
    allFeedContinuation: { newValue: { active: true, expiresAt: new Date(Date.now() + 60 * 1000).toISOString() } }
  }, 'local');
  assert.strictEqual(scheduled.length, 1, '同一 storage 事件中的 relevant keys schedule one coalesced load');
  assert.strictEqual(scheduled[0].mode, 'all', 'storage load uses the controller display mode');
  handleStorageChange({ theme: { newValue: 'dark' } }, 'local');
  assert.strictEqual(scheduled.length, 1, 'irrelevant storage changes do not rebuild history');
}

async function testContinuationStatusExpiryTimer() {
  let now = 1_000;
  let nextTimerId = 0;
  const timers = new Map();
  const statuses = [];
  const controller = createAllFeedContinuationStatusController({
    now: () => now,
    setTimer: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    showStatus: value => statuses.push(value)
  });

  controller.update({ active: true, expiresAt: new Date(1_500).toISOString() });
  const firstTimer = timers.get(1);
  assert.deepStrictEqual(statuses, ['正在补充更多内容…'], 'active 状态立即显示提示');
  assert.strictEqual(firstTimer.delay, 500, '提示计时器精确等待至 expiresAt');

  now = 1_200;
  controller.update({ active: true, expiresAt: new Date(2_000).toISOString() });
  const secondTimer = timers.get(2);
  assert(!timers.has(1) && secondTimer, '新状态会取消旧到期计时器');
  firstTimer.callback();
  assert.deepStrictEqual(statuses, ['正在补充更多内容…', '正在补充更多内容…'], '已取消的旧计时器不会清除较新的提示');

  now = 2_000;
  secondTimer.callback();
  assert.deepStrictEqual(statuses, ['正在补充更多内容…', '正在补充更多内容…', ''], 'expiresAt 到期时无需 storage 事件即可清除提示');
}

(async () => {
  await testMutationQueue();
  await testFeedModeOptimisticProjectionAndLatestWins();
  await testStaleSwitchCannotInvalidateNewOptimisticLoad();
  await testPendingModeStorageChanges();
  await testLatestWinsLoadCoalescing();
  await testLatestWinsLoadDropsStaleReads();
  await testSafeOpenReadOrdering();
  await testPopupHistoryRenderOwnership();
  await testContinuationStatusExpiryTimer();
  console.log('结果: 8 passed, 0 failed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
