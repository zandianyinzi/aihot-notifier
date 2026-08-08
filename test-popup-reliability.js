/**
 * Popup reliability helpers
 * 运行: node test-popup-reliability.js
 */

const assert = require('assert');
const {
  createMutationQueue,
  createFeedModeSwitchController,
  createLatestWinsLoadController,
  createPopupInitializationController,
  createAllFeedContinuationStatusController,
  createPopupStorageChangeHandler,
  createSessionWatchPinTracker,
  captureScrollAnchor,
  restoreScrollAnchor,
  applyOptimisticReadState,
  runMarkAllReadMutation,
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

  const scrollAnchor = { scrollTop: 80, anchorUrl: 'first-visible', offsetTop: 18 };
  await controller.loadProjection('selected', { immediate: true, forceRender: true, scrollAnchor, switchRequestId: 0 });
  assert.strictEqual(commits.at(-1).context.forceRender, true, 'forced reload preserves the explicit forceRender intent for rollback commits');
  assert.deepStrictEqual(commits.at(-1).context.scrollAnchor, scrollAnchor, 'load commits preserve the scroll anchor for rerender restoration');
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

async function testOrdinaryLoadCapturesLatestScrollAnchor() {
  const deferred = createDeferred();
  const commits = [];
  let currentAnchor = { scrollTop: 80, anchorUrl: 'before-read', offsetTop: 18 };
  const controller = createLatestWinsLoadController({
    read: () => deferred.promise,
    commit: (data, context) => commits.push({ data, context }),
    projectHistory: history => history,
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    getSwitchRequestId: () => 0,
    captureScrollAnchor: () => currentAnchor
  });

  const loading = controller.loadProjection('selected', { switchRequestId: 0 });
  currentAnchor = { scrollTop: 120, anchorUrl: 'latest-visible', offsetTop: 7 };
  deferred.resolve({ history: [{ id: 'authoritative' }] });
  await loading;

  assert.deepStrictEqual(
    commits[0].context.scrollAnchor,
    currentAnchor,
    'ordinary commits capture the latest visible scroll anchor immediately before rendering'
  );
}

async function testOrdinaryLoadWithoutAnchorAppliesInitialPosition() {
  const commits = [];
  const controller = createLatestWinsLoadController({
    read: async () => ({ history: [{ id: 'authoritative' }] }),
    commit: (data, context) => commits.push({ data, context }),
    projectHistory: history => history,
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    getSwitchRequestId: () => 0,
    captureScrollAnchor: () => null
  });

  await controller.loadProjection('selected', { switchRequestId: 0 });

  assert.strictEqual(commits[0].context.scrollAnchor, null, 'cold skeleton does not create an empty scroll anchor');
  assert.strictEqual(commits[0].context.applyInitialPosition, true, 'first real render applies the configured initial position when no item anchor exists');
}

async function testForcedRenderSurvivesCoalescedStorageLoad() {
  const fakeTimers = createFakeTimers();
  const reads = [];
  const commits = [];
  const scrollAnchor = { scrollTop: 80, anchorUrl: 'first-visible', offsetTop: 18 };
  const controller = createLatestWinsLoadController({
    read: () => {
      const deferred = createDeferred();
      reads.push(deferred);
      return deferred.promise;
    },
    commit: (data, context) => commits.push({ data, context }),
    projectHistory: history => history,
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    getSwitchRequestId: () => 0,
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    debounceMs: 25
  });

  const forcedLoad = controller.loadProjection('selected', {
    forceRender: true,
    scrollAnchor,
    switchRequestId: 0
  });
  await waitFor(() => reads.length === 1);
  controller.scheduleLoad({ readAllBefore: {} }, 'selected', 0);
  reads[0].resolve({ history: [{ id: 'same-authoritative-state' }] });
  assert.deepStrictEqual(await forcedLoad, { stale: true }, 'storage scheduling supersedes the in-flight forced read');
  assert.strictEqual(commits.length, 0, 'superseded forced reads do not commit stale data');

  fakeTimers.runOnly();
  await waitFor(() => reads.length === 2);
  reads[1].resolve({ history: [{ id: 'same-authoritative-state' }] });
  await waitFor(() => commits.length === 1);
  assert.strictEqual(commits[0].context.forceRender, true, 'the latest coalesced storage load retains the pending forced render');
  assert.deepStrictEqual(commits[0].context.scrollAnchor, scrollAnchor, 'the latest coalesced storage load retains the pending scroll anchor');
}

async function testForcedRenderIntentClearsAfterReadFailure() {
  const commits = [];
  let reads = 0;
  const controller = createLatestWinsLoadController({
    read: async () => {
      reads++;
      if (reads === 1) throw new Error('storage unavailable');
      return { history: [{ id: 'authoritative' }] };
    },
    commit: (data, context) => commits.push({ data, context }),
    projectHistory: history => history,
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    getSwitchRequestId: () => 0
  });

  await assert.rejects(
    controller.loadProjection('selected', {
      forceRender: true,
      scrollAnchor: { scrollTop: 80, anchorUrl: 'old', offsetTop: 18 },
      switchRequestId: 0
    }),
    /storage unavailable/
  );
  await controller.loadProjection('selected', { switchRequestId: 0 });
  assert.strictEqual(commits[0].context.forceRender, false, 'a failed forced read does not poison the next ordinary load');
  assert.strictEqual(commits[0].context.scrollAnchor, null, 'a failed forced read does not reuse an expired scroll anchor');
}

async function testStaleInitializationCannotOverwriteCommittedMode() {
  let loadVersion = 0;
  const fullStorage = createDeferred();
  const scheduledModes = [];
  const feedController = createFeedModeSwitchController({
    initialMode: 'selected',
    setDisabled: () => {},
    sendChange: async () => ({ ok: true }),
    loadProjection: async () => {},
    readCommittedMode: async () => 'selected',
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    rollback: async () => {},
    onSuccess: () => {},
    onFailure: () => {}
  });
  const initializer = createPopupInitializationController({
    getLoadVersion: () => loadVersion,
    getSwitchState: feedController.getState,
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    readCommittedMode: async () => 'selected',
    readWarmCache: async () => null,
    readFullStorage: () => fullStorage.promise,
    prepareStorage: data => data,
    applyCache: () => assert.fail('stale init must not apply cache state'),
    renderCache: () => assert.fail('stale init must not render cache state'),
    applyStorage: data => feedController.observeCommittedMode(data.feedMode),
    renderStorage: () => assert.fail('stale init must not render storage state'),
    waitForPaint: async () => {}
  });

  const initializing = initializer.initialize();
  loadVersion++;
  feedController.observeCommittedMode('all');
  fullStorage.resolve({ feedMode: 'selected', history: [{ id: 'stale-selected' }] });
  const result = await initializing;
  const handleStorageChange = createPopupStorageChangeHandler({
    getFeedMode: feedController.getDisplayMode,
    getSwitchRequestId: () => feedController.getState().switchRequestId,
    scheduleLoad: (_changes, mode) => scheduledModes.push(mode)
  });
  handleStorageChange({ history: { newValue: [] } }, 'local');

  assert.strictEqual(result.stale, true, 'older initialization exits stale after a newer load version commits');
  assert.strictEqual(feedController.getState().committedMode, 'all', 'stale full snapshot cannot overwrite the newer committed mode');
  assert.deepStrictEqual(scheduledModes, ['all'], 'later history-only storage changes continue projecting the newer committed mode');
}

async function testWarmCacheRendersBeforeFullStorage() {
  const fullStorage = createDeferred();
  const calls = [];
  let initializeSettled = false;
  const initializer = createPopupInitializationController({
    getLoadVersion: () => 0,
    getSwitchState: () => ({ switchRequestId: 0, pendingMode: null }),
    normalizeFeedMode: mode => mode === 'all' ? 'all' : 'selected',
    readCommittedMode: () => {
      calls.push('read-mode');
      return Promise.resolve('all');
    },
    readWarmCache: () => {
      calls.push('read-cache');
      return Promise.resolve({ feedMode: 'all', history: [{ id: 'cached-all' }] });
    },
    readFullStorage: () => {
      calls.push('read-full');
      return fullStorage.promise;
    },
    prepareStorage: data => data,
    applyCache: data => calls.push(`apply-cache:${data.history[0].id}`),
    renderCache: data => calls.push(`render-cache:${data.history[0].id}`),
    applyStorage: data => calls.push(`apply-storage:${data.history[0].id}`),
    renderStorage: data => calls.push(`render-storage:${data.history[0].id}`),
    waitForPaint: async () => calls.push('paint')
  });

  const initializing = initializer.initialize().then(result => {
    initializeSettled = true;
    return result;
  });
  assert.deepStrictEqual(calls.slice(0, 3), ['read-mode', 'read-cache', 'read-full'], 'mode, warm cache, and full storage reads start concurrently');
  await waitFor(() => calls.includes('render-cache:cached-all'));
  assert.strictEqual(initializeSettled, false, 'matching warm cache renders while full history read remains pending');
  fullStorage.resolve({ feedMode: 'all', history: [{ id: 'stored-all' }] });
  const result = await initializing;
  assert.strictEqual(result.stale, false, 'current initialization completes after full storage arrives');
  assert(calls.indexOf('render-cache:cached-all') < calls.indexOf('apply-storage:stored-all'), 'warm cache render precedes full storage application');
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
    allFeedContinuation: { newValue: { active: false } }
  }, 'local');
  assert.strictEqual(scheduled.length, 1, '同一 storage 事件中的 relevant keys schedule one coalesced load');
  assert.strictEqual(scheduled[0].mode, 'all', 'storage load uses the controller display mode');
  handleStorageChange({ theme: { newValue: 'dark' } }, 'local');
  assert.strictEqual(scheduled.length, 1, 'irrelevant storage changes do not rebuild history');
}

async function testActiveContinuationDefersIntermediateHistoryRenders() {
  const scheduled = [];
  const continuationStatuses = [];
  const handleStorageChange = createPopupStorageChangeHandler({
    getFeedMode: () => 'all',
    getSwitchRequestId: () => 9,
    updateContinuationStatus: status => continuationStatuses.push(status),
    scheduleLoad: (changes, mode, requestId) => scheduled.push({ changes, mode, requestId })
  });

  for (let page = 1; page <= 20; page++) {
    handleStorageChange({
      history: { newValue: Array.from({ length: page * 100 }) },
      allFeedContinuation: { newValue: { active: true, cursor: `page-${page}` } }
    }, 'local');
  }
  assert.strictEqual(scheduled.length, 0, 'active continuation pages do not trigger one full popup rebuild per page');
  assert.strictEqual(continuationStatuses.length, 20, 'active continuation progress still updates without rebuilding history');

  handleStorageChange({
    history: { newValue: Array.from({ length: 2000 }) },
    readIds: { newValue: ['read-during-continuation'] },
    allFeedContinuation: { newValue: { active: true, cursor: 'page-20' } }
  }, 'local');
  assert.strictEqual(scheduled.length, 1, 'read-state changes remain immediately renderable during continuation');

  handleStorageChange({
    history: { newValue: Array.from({ length: 2363 }) },
    allFeedContinuation: { newValue: { active: false } }
  }, 'local');
  assert.strictEqual(scheduled.length, 2, 'terminal continuation commit schedules one final canonical render');
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

function createFakeScrollItem(url, top, bottom, key = url) {
  return {
    dataset: { key, url },
    getBoundingClientRect: () => ({ top, bottom })
  };
}

function testScrollAnchorCaptureAndRestore() {
  const firstHidden = createFakeScrollItem('first-hidden', 40, 90);
  const firstVisible = createFakeScrollItem('first-visible', 118, 160);
  const scroller = {
    scrollTop: 80,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => [firstHidden, firstVisible]
  };

  const anchor = captureScrollAnchor(scroller);
  assert.deepStrictEqual(anchor, {
    scrollTop: 80,
    anchorKey: 'first-visible',
    anchorUrl: 'first-visible',
    offsetTop: 18
  }, 'captures the first visible item and its relative offset before optimistic list updates');

  const movedVisible = createFakeScrollItem('first-visible', 155, 197);
  scroller.querySelectorAll = () => [movedVisible];
  assert.strictEqual(restoreScrollAnchor(scroller, anchor), true, 'restores the same item after the list is rerendered');
  assert.strictEqual(scroller.scrollTop, 117, 'restoring preserves the captured relative offset');

  scroller.scrollTop = 80;
  assert.strictEqual(restoreScrollAnchor(scroller, anchor, { maxJump: 20 }), false, 'falls back when anchor restoration would jump too far');
  assert.strictEqual(scroller.scrollTop, 80, 'large anchor jumps preserve the original scrollTop');

  const duplicateHidden = createFakeScrollItem('duplicate-url', 40, 90, 'duplicate-first');
  const duplicateVisible = createFakeScrollItem('duplicate-url', 118, 160, 'duplicate-second');
  scroller.scrollTop = 80;
  scroller.querySelectorAll = () => [duplicateHidden, duplicateVisible];
  const duplicateAnchor = captureScrollAnchor(scroller);
  const duplicateFirstAfterRender = createFakeScrollItem('duplicate-url', 110, 152, 'duplicate-first');
  const duplicateSecondAfterRender = createFakeScrollItem('duplicate-url', 155, 197, 'duplicate-second');
  scroller.querySelectorAll = () => [duplicateFirstAfterRender, duplicateSecondAfterRender];
  assert.strictEqual(restoreScrollAnchor(scroller, duplicateAnchor), true, 'stable item key disambiguates duplicate URLs');
  assert.strictEqual(scroller.scrollTop, 117, 'duplicate URL restoration follows the originally visible item');

  scroller.querySelectorAll = () => [];
  assert.strictEqual(captureScrollAnchor(scroller), null, 'a skeleton or empty state does not produce a truthy empty anchor');
}

function createFakeClassList(initialClasses) {
  const classes = new Set(initialClasses);
  return {
    add: value => classes.add(value),
    contains: value => classes.has(value),
    remove: value => classes.delete(value)
  };
}

function testOptimisticReadStateRollback() {
  const unreadItem = { classList: createFakeClassList(['item', 'unread']) };
  const alreadyReadItem = { classList: createFakeClassList(['item', 'read']) };
  const markAllButton = { classList: createFakeClassList(['visible']) };
  const rollback = applyOptimisticReadState([unreadItem, alreadyReadItem], markAllButton);

  assert(unreadItem.classList.contains('read') && !unreadItem.classList.contains('unread'), 'optimistic state immediately marks unread items as read');
  assert(alreadyReadItem.classList.contains('read'), 'optimistic state leaves already-read items unchanged');
  assert(!markAllButton.classList.contains('visible'), 'optimistic state immediately hides the mark-all button');

  rollback();
  assert(unreadItem.classList.contains('unread') && !unreadItem.classList.contains('read'), 'rollback restores only items changed by the optimistic state');
  assert(alreadyReadItem.classList.contains('read') && !alreadyReadItem.classList.contains('unread'), 'rollback does not turn previously read items unread');
  assert(markAllButton.classList.contains('visible'), 'rollback restores the mark-all button when unread items were reverted');
}

function testSessionWatchPinsStayStableAcrossReadTransitions() {
  assert.strictEqual(typeof createSessionWatchPinTracker, 'function', 'session watch pin tracker is exported');
  const history = [
    { id: 'watch-old', watchMatched: true },
    { id: 'ordinary', watchMatched: false }
  ];
  const getKey = item => item.id;
  const tracker = createSessionWatchPinTracker();

  assert.deepStrictEqual(
    tracker.getPinnedItems(history, item => item.id === 'watch-old', getKey).map(getKey),
    ['watch-old'],
    'unread watch items become pinned in the current popup session'
  );
  assert.deepStrictEqual(
    tracker.getPinnedItems(history, () => false, getKey).map(getKey),
    ['watch-old'],
    'items pinned while unread stay pinned after becoming read in the same popup session'
  );

  const freshTracker = createSessionWatchPinTracker();
  assert.deepStrictEqual(
    freshTracker.getPinnedItems(history, () => false, getKey),
    [],
    'already-read watch items are not pinned in a new popup session'
  );
  const previewTracker = createSessionWatchPinTracker();
  assert.deepStrictEqual(
    previewTracker.getPinnedItems(history, item => item.id === 'watch-old', getKey, { persistUnread: false }).map(getKey),
    ['watch-old'],
    'warm cache can preview unread watch items in the pinned group'
  );
  assert.deepStrictEqual(
    previewTracker.getPinnedItems(history, () => false, getKey),
    [],
    'warm cache preview does not persist stale unread state into the popup session'
  );
  assert.deepStrictEqual(
    tracker.getPinnedItems([{ ...history[0], watchMatched: false }], () => false, getKey),
    [],
    'items stop being pinned when they are no longer watch matches'
  );
}

async function testMarkAllReadMutationSeparatesCommitAndReloadFailure() {
  const failedEvents = [];
  await runMarkAllReadMutation({
    send: async () => ({ ok: false, error: 'rejected' }),
    reload: async () => failedEvents.push('reload'),
    rollback: () => failedEvents.push('rollback'),
    onFailure: ({ committed }) => failedEvents.push(`failure:${committed}`)
  });
  assert.deepStrictEqual(failedEvents, ['rollback', 'reload', 'failure:false'], 'mutation failure rolls back before authoritative reload');

  const refreshEvents = [];
  await runMarkAllReadMutation({
    send: async () => ({ ok: true }),
    onCommitted: () => refreshEvents.push('committed'),
    reload: async () => {
      refreshEvents.push('reload');
      throw new Error('read failed');
    },
    rollback: () => refreshEvents.push('rollback'),
    onFailure: ({ committed }) => refreshEvents.push(`failure:${committed}`)
  });
  assert.deepStrictEqual(refreshEvents, ['committed', 'reload', 'reload', 'failure:true'], 'post-commit reload failure never rolls back the durable success');
}

(async () => {
  await testMutationQueue();
  await testFeedModeOptimisticProjectionAndLatestWins();
  await testStaleSwitchCannotInvalidateNewOptimisticLoad();
  await testPendingModeStorageChanges();
  await testLatestWinsLoadCoalescing();
  await testLatestWinsLoadDropsStaleReads();
  await testOrdinaryLoadCapturesLatestScrollAnchor();
  await testOrdinaryLoadWithoutAnchorAppliesInitialPosition();
  await testForcedRenderSurvivesCoalescedStorageLoad();
  await testForcedRenderIntentClearsAfterReadFailure();
  await testStaleInitializationCannotOverwriteCommittedMode();
  await testWarmCacheRendersBeforeFullStorage();
  await testSafeOpenReadOrdering();
  await testPopupHistoryRenderOwnership();
  await testActiveContinuationDefersIntermediateHistoryRenders();
  await testContinuationStatusExpiryTimer();
  testScrollAnchorCaptureAndRestore();
  testOptimisticReadStateRollback();
  testSessionWatchPinsStayStableAcrossReadTransitions();
  await testMarkAllReadMutationSeparatesCommitAndReloadFailure();
  console.log('结果: 19 passed, 0 failed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
