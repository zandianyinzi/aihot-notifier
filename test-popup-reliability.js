/**
 * Popup reliability helpers
 * 运行: node test-popup-reliability.js
 */

const assert = require('assert');
const {
  createMutationQueue,
  createFeedModeSwitchController,
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

async function testPopupHistoryRenderOwnership() {
  let controllerRenders = 0;
  const controller = createFeedModeSwitchController({
    enqueue: createMutationQueue(),
    setDisabled: () => {},
    sendChange: async () => ({ ok: true }),
    getFailCount: async () => 0,
    clearScrollPosition: () => {},
    loadHistory: async () => { controllerRenders++; },
    persist: () => {},
    rollback: async () => {},
    onSuccess: () => {},
    onFailure: () => {}
  });
  await controller.switchFeedMode('all', 'selected');
  assert.strictEqual(controllerRenders, 0, '内容源 controller 不重复渲染；history storage change 是唯一列表刷新来源');

  let renders = 0;
  const statuses = [];
  const handleStorageChange = createPopupStorageChangeHandler({
    refreshHistory: () => {
      renders++;
      statuses.push('正在补充更多内容…');
    },
    showStatus: value => statuses.push(value)
  });
  handleStorageChange({
    history: { newValue: [] },
    allFeedContinuation: { newValue: { active: true, expiresAt: new Date(Date.now() + 60 * 1000).toISOString() } }
  }, 'local');
  assert.strictEqual(renders, 1, '同一 storage 事件中的 history 仅触发一次列表刷新');
  assert.deepStrictEqual(statuses, ['正在补充更多内容…'], 'history 与续拉状态同变时只由列表加载路径发布一次状态');
  handleStorageChange({ allFeedContinuation: { newValue: { active: false } } }, 'local');
  assert.strictEqual(renders, 1, '仅状态变更不重渲染列表');
  assert.deepStrictEqual(statuses, ['正在补充更多内容…', ''], '续拉完成清除状态提示');
  handleStorageChange({ allFeedContinuation: { newValue: { active: true, expiresAt: new Date(Date.now() - 60 * 1000).toISOString() } } }, 'local');
  assert.deepStrictEqual(statuses, ['正在补充更多内容…', '', ''], '过期的续拉状态不会让 popup 持续显示补充提示');
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
  await testFeedModeStaleResponseAndRollback();
  await testSafeOpenReadOrdering();
  await testPopupHistoryRenderOwnership();
  await testContinuationStatusExpiryTimer();
  console.log('结果: 5 passed, 0 failed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
