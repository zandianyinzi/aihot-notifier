/**
 * 直接加载 background.js，验证 API v1 runtime 契约。
 * 运行: node test-background.js
 */

let passed = 0;
let failed = 0;
let onMessageHandler = null;
let onAlarmHandler = null;
let onClickedHandler = null;
let onClosedHandler = null;
let onStorageChangedHandler = null;
let onStartupHandler = null;
let storageData = {};
let fetchImpl = null;
let requestedUrls = [];
let openedTabs = [];
let notificationCreateIds = [];
let alarmCreateCalls = [];
let alarmClearCalls = [];
let badgeTexts = [];
let failSetWhen = null;
let alarmCreateImpl = null;
let alarmClearImpl = null;
globalThis.__AIHOT_TEST_PAGE_DELAY_MS = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

async function waitFor(check, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return false;
}

function resetState(overrides = {}) {
  storageData = {
    enabled: true,
    interval: 5,
    lastCheck: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    feedMode: 'selected',
    history: [],
    historyDays: 7,
    readIds: [],
    readAllBefore: '',
    readAllBeforeByMode: {},
    failCount: 0,
    ...overrides
  };
  requestedUrls = [];
  openedTabs = [];
  notificationCreateIds = [];
  alarmCreateCalls = [];
  alarmClearCalls = [];
  badgeTexts = [];
  failSetWhen = null;
  alarmCreateImpl = null;
  alarmClearImpl = null;
}

function v1Item(overrides = {}) {
  const { source = {}, links = {}, ...item } = overrides;
  return {
    id: 'v1-item',
    title: 'v1 条目',
    source: { name: 'v1 来源', ...source },
    links: {
      original: 'https://example.com/v1-original',
      aihot: 'https://aihot.virxact.com/items/v1-item',
      ...links
    },
    category: 'industry',
    summary: 'v1 摘要',
    publishedAt: new Date().toISOString(),
    ...item
  };
}

function v1Page(items, { hasMore = false, nextCursor = null } = {}) {
  return { items, page: { hasMore, nextCursor } };
}

function isV1ItemsUrl(url, mode, cursor) {
  const parsed = new URL(url);
  const isBaseUrl = parsed.pathname === '/api/v1/items' &&
    parsed.searchParams.get('mode') === mode &&
    parsed.searchParams.get('window') === '7d' &&
    parsed.searchParams.get('limit') === '100';
  if (!isBaseUrl) return false;
  return cursor === undefined
    ? !parsed.searchParams.has('cursor')
    : parsed.searchParams.get('cursor') === cursor;
}

function legacyFingerprintResponse(selected = 'fp-new', all = 'fp-all') {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'W/"fingerprint"' },
    json: () => Promise.resolve({ selected, all })
  });
}

globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach(key => { if (key in storageData) result[key] = storageData[key]; });
          return Promise.resolve(result);
        }
        if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
        return Promise.resolve(storageData);
      },
      set: (values) => {
        if (failSetWhen && failSetWhen(values)) return Promise.reject(new Error('mock storage set failed'));
        Object.assign(storageData, values);
        return Promise.resolve();
      }
    },
    onChanged: { addListener: (handler) => { onStorageChangedHandler = handler; } }
  },
  notifications: {
    create: (id) => {
      notificationCreateIds.push(id);
      return Promise.resolve(id);
    },
    onClicked: { addListener: (handler) => { onClickedHandler = handler; } },
    onClosed: { addListener: (handler) => { onClosedHandler = handler; } }
  },
  action: {
    setBadgeText: ({ text }) => { badgeTexts.push(text); },
    setBadgeBackgroundColor: () => {}
  },
  tabs: { create: (options) => { openedTabs.push(options.url); } },
  alarms: {
    create: (name, info) => {
      alarmCreateCalls.push({ name, info });
      if (alarmCreateImpl) return alarmCreateImpl(name, info);
    },
    clear: (name) => {
      alarmClearCalls.push(name);
      return alarmClearImpl ? alarmClearImpl() : Promise.resolve();
    },
    onAlarm: { addListener: (handler) => { onAlarmHandler = handler; } }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: (handler) => { onStartupHandler = handler; } },
    onMessage: { addListener: (handler) => { onMessageHandler = handler; } }
  }
};

globalThis.fetch = (...args) => fetchImpl(...args);

require('./background.js');

function sendMessage(message) {
  return new Promise(resolve => onMessageHandler(message, {}, resolve));
}

function sendMessageWithTimeout(message, timeoutMs = 50) {
  return Promise.race([
    sendMessage(message),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, timeout: true }), timeoutMs))
  ]);
}

async function runTests() {
  console.log('\n[API v1 请求、分页与字段映射]');
  resetState({ apiFingerprints: { selected: 'fp-old' } });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'v1-next') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(v1Page([
          v1Item({
            id: 'v1-second',
            title: 'v1 第二页条目',
            publishedAt: '2026-07-26T00:00:00.000Z',
            source: { name: 'v1 第二来源' },
            links: {
              original: 'https://example.com/v1-second-original',
              aihot: 'https://aihot.virxact.com/items/v1-second'
            }
          })
        ]))
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ publishedAt: '2026-07-26T01:00:00.000Z' })], { hasMore: true, nextCursor: 'v1-next' }))
    });
  };

  const v1Response = await sendMessage({ type: 'pollNow' });
  const v1ItemUrls = requestedUrls.filter(url => new URL(url).pathname === '/api/v1/items');

  assert(v1Response.ok === true, 'v1 响应可完成手动刷新');
  assert(requestedUrls.filter(url => url.includes('/api/public/fingerprint')).length === 1, 'manual v1 刷新先探测一次 legacy fingerprint');
  assert(v1ItemUrls.length === 2 && isV1ItemsUrl(v1ItemUrls[0], 'selected') && isV1ItemsUrl(v1ItemUrls[1], 'selected', 'v1-next'), '首个 v1 URL 不含 cursor，page.nextCursor 只驱动续页');
  assert(v1ItemUrls.every(url => !new URL(url).searchParams.has('since')), 'v1 items URL 不携带 legacy since 参数');
  assert(storageData.history.length === 2, 'page.hasMore 驱动第二页拉取');
  assert(storageData.history[0]?.url === 'https://example.com/v1-original' && storageData.history[0]?.permalink === 'https://aihot.virxact.com/items/v1-item', 'links.original 和 links.aihot 映射为历史链接');
  assert(storageData.history[0]?.source === 'v1 来源', 'source.name 映射为历史来源');

  console.log('\n[API v1 aihot 链接回退]');
  resetState();
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([
      v1Item({
        id: 'v1-aihot-only',
        links: {
          original: '',
          aihot: 'https://aihot.virxact.com/items/v1-aihot-only'
        }
      })
    ]))
  });

  await sendMessage({ type: 'pollNow' });
  assert(storageData.history[0]?.url === 'https://aihot.virxact.com/items/v1-aihot-only', '缺少 original 时回退到 links.aihot');

  console.log('\n[API v1 条目映射与无效条目]');
  resetState();
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        {},
        v1Item({
          id: 'v1-mapped',
          originalTitle: 'Original English title',
          attribution: { name: '原作者', url: 'https://example.com/author' },
          links: {
            original: 'http://example.com/insecure-original',
            aihot: 'https://aihot.virxact.com/items/v1-mapped'
          }
        })
      ]))
    });
  };

  const mappingResponse = await sendMessage({ type: 'pollNow' });
  assert(mappingResponse.ok === true && storageData.history.length === 1, '无效 v1 item 被跳过且有效 item 继续入库');
  assert(storageData.history[0]?.titleEn === 'Original English title' && storageData.history[0]?.attribution?.name === '原作者' && storageData.history[0]?.attribution?.url === 'https://example.com/author', 'originalTitle 和 attribution 映射并持久化到 history');
  assert(storageData.history[0]?.url === 'https://aihot.virxact.com/items/v1-mapped' && storageData.history[0]?.permalink === 'https://aihot.virxact.com/items/v1-mapped', '非 HTTPS original 回退到 HTTPS aihot');

  console.log('\n[API v1 非法分页安全失败]');
  const invalidPages = [
    { name: 'page 类型', value: { items: [], page: null } },
    { name: 'cursor 类型', value: { items: [], page: { hasMore: true, nextCursor: 123 } } },
    { name: 'null cursor', value: { items: [], page: { hasMore: true, nextCursor: null } } },
    { name: '空 cursor', value: { items: [], page: { hasMore: true, nextCursor: '' } } },
    { name: '过长 cursor', value: { items: [], page: { hasMore: true, nextCursor: 'x'.repeat(1025) } } }
  ];
  for (const invalidPage of invalidPages) {
    resetState();
    fetchImpl = (url) => {
      if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
      return Promise.resolve({ ok: true, json: () => Promise.resolve(invalidPage.value) });
    };
    const invalidResponse = await sendMessage({ type: 'pollNow' });
    assert(invalidResponse.ok === false && storageData.failCount === 1 && storageData.history.length === 0, `非法 ${invalidPage.name} 会安全失败而不写入 history`);
  }

  resetState();
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: `v1-loop-${requestedUrls.length}` })], { hasMore: true, nextCursor: 'same-cursor' }))
    });
  };
  const repeatedCursorResponse = await sendMessage({ type: 'pollNow' });
  assert(repeatedCursorResponse.ok === false && storageData.failCount === 1 && requestedUrls.filter(url => new URL(url).pathname === '/api/v1/items').length === 2, '重复 cursor 在下一页前安全终止');

  console.log('\n[feedModeChanged v1 reset]');
  resetState();
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'v1-reset', title: '重建内容' })])) });
  };
  const resetResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const resetItemUrl = requestedUrls.find(url => new URL(url).pathname === '/api/v1/items');
  assert(resetResponse.ok === true && storageData.feedMode === 'all' && storageData.history[0]?.id === 'v1-reset', 'feedModeChanged 通过真实 background 消息路径重建 v1 history');
  assert(resetItemUrl && isV1ItemsUrl(resetItemUrl, 'all') && !new URL(resetItemUrl).searchParams.has('since'), 'resetAndPoll 使用无 since 的 all v1 URL');

  console.log('\n[全部内容源首屏优先与后台续拉]');
  const previousProgressiveHistory = Array.from({ length: 2005 }, (_, index) => ({
    id: `previous-progressive-${index}`,
    url: `https://example.com/previous-progressive-${index}`,
    permalink: `https://aihot.virxact.com/items/previous-progressive-${index}`,
    time: new Date(Date.now() - index * 1000).toISOString(),
    discoveredAt: new Date(Date.now() - index * 1000).toISOString()
  }));
  resetState({ history: previousProgressiveHistory });
  let releaseAllSecondPage;
  let allSecondPageRequested = false;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-progressive');
    const parsed = new URL(url);
    const mode = parsed.searchParams.get('mode');
    const cursor = parsed.searchParams.get('cursor');
    if (mode === 'selected') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'selected-after-all', title: '最新精选' })])) });
    }
    if (cursor === 'all-page-2') {
      allSecondPageRequested = true;
      return new Promise(resolve => {
        releaseAllSecondPage = () => resolve({
          ok: true,
          json: () => Promise.resolve(v1Page([v1Item({ id: 'all-page-2', title: '全部第二页' })]))
        });
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        v1Item({ id: 'all-page-1', title: '全部第一页' })
      ], { hasMore: true, nextCursor: 'all-page-2' }))
    });
  };

  let progressiveResponse;
  const progressiveReset = sendMessage({ type: 'feedModeChanged', feedMode: 'all' }).then(response => { progressiveResponse = response; return response; });
  const firstPageResponded = await waitFor(() => Boolean(progressiveResponse));
  assert(firstPageResponded && progressiveResponse.ok === true, 'all 首屏成功后在后台续拉前立即响应消息');
  assert(storageData.feedMode === 'all' && storageData.history.length === 1 && storageData.history[0]?.id === 'all-page-1', 'all 首屏成功后立即提交 feedMode 与首屏 history');
  assert(Object.keys(storageData.allFeedContinuation?.discoveredAtByAlias || {}).length === 2000, '续拉发现时间索引使用强身份且受最大分页条目数约束');
  const secondPageStarted = await waitFor(() => allSecondPageRequested);
  assert(secondPageStarted && requestedUrls.some(url => isV1ItemsUrl(url, 'all', 'all-page-2')), '后台续拉沿用首屏返回的 cursor 参数');

  const selectedReset = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  releaseAllSecondPage();
  await Promise.all([progressiveReset, selectedReset]);
  assert(storageData.feedMode === 'selected' && storageData.history.length === 1 && storageData.history[0]?.id === 'selected-after-all', '新 generation 或内容源变化后丢弃旧 all 续拉结果');
  assert(notificationCreateIds.length === 0, 'all 后台续拉不会发送通知');

  console.log('\n[全部内容源限流续拉]');
  resetState();
  let throttledCursorRequests = 0;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-rate-limit');
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'retry-page-2') {
      throttledCursorRequests++;
      if (throttledCursorRequests === 1) return Promise.resolve({ ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '0' : '' } });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
        id: 'retry-page-2',
        links: { original: 'https://example.com/retry-page-2', aihot: 'https://aihot.virxact.com/items/retry-page-2' }
      })])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
      id: 'retry-page-1',
      links: { original: 'https://example.com/retry-page-1', aihot: 'https://aihot.virxact.com/items/retry-page-1' }
    })], { hasMore: true, nextCursor: 'retry-page-2' })) });
  };
  const rateLimitedResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(rateLimitedResponse.ok === true && storageData.history[0]?.id === 'retry-page-1', '429 续拉不会阻塞 all 首屏响应');
  await waitFor(() => storageData.allFeedContinuation?.retryAt);
  storageData.allFeedContinuation.retryAt = new Date(Date.now() - 1).toISOString();
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const retryCompleted = await waitFor(() => storageData.history.some(item => item.id === 'retry-page-2'));
  assert(retryCompleted && throttledCursorRequests === 2, '后台续拉只在 429 Retry-After 后重试同一 cursor 页面');

  console.log('\n[全部内容源续拉失败收敛]');
  resetState({
    history: [{ id: 'schedule-known', url: 'https://example.com/schedule-known', time: new Date().toISOString(), discoveredAt: new Date().toISOString() }]
  });
  let continuationTerminalFailureLogged = false;
  let unhandledContinuationFailure = null;
  const originalContinuationError = console.error;
  const onUnhandledContinuationFailure = error => { unhandledContinuationFailure = error; };
  console.error = (...args) => {
    if (String(args[0]).includes('all feed continuation failed')) continuationTerminalFailureLogged = true;
    originalContinuationError(...args);
  };
  process.on('unhandledRejection', onUnhandledContinuationFailure);
  alarmCreateImpl = name => {
    if (name === 'aihot-all-continuation') return Promise.reject(new Error('mock continuation alarm create failed'));
  };
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-schedule-failure');
    if (new URL(url).searchParams.get('cursor') === 'schedule-failure-cursor') {
      return Promise.resolve({ ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '60' : '' } });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'schedule-failure-first' })], { hasMore: true, nextCursor: 'schedule-failure-cursor' })) });
  };
  const scheduleFailureResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => continuationTerminalFailureLogged || Boolean(unhandledContinuationFailure));
  process.removeListener('unhandledRejection', onUnhandledContinuationFailure);
  console.error = originalContinuationError;
  assert(scheduleFailureResponse.ok === true && continuationTerminalFailureLogged && !unhandledContinuationFailure && storageData.allFeedContinuation?.active === false && storageData.allFeedContinuation?.retryAt === '' && Object.keys(storageData.allFeedContinuation?.discoveredAtByAlias || {}).length === 0, '续拉调度 alarm Promise 拒绝被记录、收敛且清理发现时间索引');

  console.log('\n[全部内容源长 Retry-After 不受 UI TTL 影响]');
  const longRetryKnownDiscoveredAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  resetState({
    history: [{
      id: 'long-retry-page-2',
      url: 'https://example.com/long-retry-page-2',
      permalink: 'https://aihot.virxact.com/items/long-retry-page-2',
      time: longRetryKnownDiscoveredAt,
      discoveredAt: longRetryKnownDiscoveredAt
    }]
  });
  let longRetryRequests = 0;
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => originalTimeout(callback, 0);
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-long-retry');
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'long-retry') {
      longRetryRequests++;
      if (longRetryRequests === 1) return Promise.resolve({ ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '901' : '' } });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
        id: 'long-retry-page-2',
        links: { original: 'https://example.com/long-retry-page-2', aihot: 'https://aihot.virxact.com/items/long-retry-page-2' }
      })])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
      id: 'long-retry-page-1',
      links: { original: 'https://example.com/long-retry-page-1', aihot: 'https://aihot.virxact.com/items/long-retry-page-1' }
    })], { hasMore: true, nextCursor: 'long-retry' })) });
  };
  const longRetryResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const longRetryScheduled = await waitFor(() => storageData.allFeedContinuation?.retryAt && alarmCreateCalls.some(call => call.name === 'aihot-all-continuation'));
  globalThis.setTimeout = originalTimeout;
  assert(longRetryResponse.ok === true && longRetryScheduled && longRetryRequests === 1 && storageData.allFeedContinuation?.cursor === 'long-retry', '长 Retry-After 持久化同一 cursor 与 due time，而不依赖内存 sleep');
  storageData.allFeedContinuation.retryAt = new Date(Date.now() - 1).toISOString();
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const longRetryCompleted = await waitFor(() => storageData.history.some(item => item.id === 'long-retry-page-2'));
  assert(longRetryCompleted && longRetryRequests === 2, 'continuation alarm 在 worker 后续事件中从持久化 cursor 恢复同页重试');
  assert(storageData.history.find(item => item.id === 'long-retry-page-2')?.discoveredAt === longRetryKnownDiscoveredAt, 'worker 恢复 continuation 后沿用持久化强身份索引保留发现时间');

  console.log('\n[内容源切换与延迟续拉原子性]');
  resetState();
  let failedSwitchCursorRequests = 0;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-switch-atomic');
    const parsed = new URL(url);
    if (parsed.searchParams.get('mode') === 'selected') return Promise.resolve({ ok: false, status: 500 });
    if (parsed.searchParams.get('cursor') === 'preserve-cursor') {
      failedSwitchCursorRequests++;
      if (failedSwitchCursorRequests === 1) return Promise.resolve({ ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '60' : '' } });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
        id: 'preserved-after-failed-switch',
        links: { original: 'https://example.com/preserved-after-failed-switch', aihot: 'https://aihot.virxact.com/items/preserved-after-failed-switch' }
      })])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'preserve-first' })], { hasMore: true, nextCursor: 'preserve-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => storageData.allFeedContinuation?.cursor === 'preserve-cursor' && storageData.allFeedContinuation?.retryAt);
  const preservedContinuationId = storageData.allFeedContinuation.id;
  alarmClearCalls = [];
  const failedSelectedSwitch = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(failedSelectedSwitch.ok === false && storageData.feedMode === 'all' && storageData.allFeedContinuation?.active === true && storageData.allFeedContinuation?.id === preservedContinuationId && !alarmClearCalls.includes('aihot-all-continuation'), 'selected 首屏失败时保留 all mode、同一 continuation 与既有 alarm');
  storageData.allFeedContinuation.retryAt = new Date(Date.now() - 1).toISOString();
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const preservedContinuationResumed = await waitFor(() => storageData.history.some(item => item.id === 'preserved-after-failed-switch'));
  assert(preservedContinuationResumed && failedSwitchCursorRequests === 2, '失败切源后原 all cursor 可由 alarm 继续恢复');

  resetState();
  let successfulSwitchCursorRequests = 0;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-switch-success');
    const parsed = new URL(url);
    if (parsed.searchParams.get('mode') === 'selected') return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'selected-after-successful-switch' })])) });
    if (parsed.searchParams.get('cursor') === 'clear-cursor') {
      successfulSwitchCursorRequests++;
      return Promise.resolve({ ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '60' : '' } });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'clear-first' })], { hasMore: true, nextCursor: 'clear-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => storageData.allFeedContinuation?.cursor === 'clear-cursor' && storageData.allFeedContinuation?.retryAt);
  alarmClearCalls = [];
  const successfulSelectedSwitch = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(successfulSelectedSwitch.ok === true && storageData.feedMode === 'selected' && storageData.allFeedContinuation?.active === false && alarmClearCalls.includes('aihot-all-continuation'), 'selected 首屏成功提交后才清理旧 all continuation alarm');
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  assert(successfulSwitchCursorRequests === 1, '成功切源后旧 alarm 不会重新拉取旧 cursor');

  resetState();
  let releaseLiveCursor;
  let liveCursorStarted = false;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-switch-live-cursor');
    const parsed = new URL(url);
    if (parsed.searchParams.get('mode') === 'selected') return Promise.resolve({ ok: false, status: 500 });
    if (parsed.searchParams.get('cursor') === 'live-cursor') {
      liveCursorStarted = true;
      return new Promise(resolve => {
        releaseLiveCursor = () => resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
          id: 'live-cursor-after-failed-switch',
          links: { original: 'https://example.com/live-cursor-after-failed-switch', aihot: 'https://aihot.virxact.com/items/live-cursor-after-failed-switch' }
        })])) });
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'live-cursor-first' })], { hasMore: true, nextCursor: 'live-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(await waitFor(() => liveCursorStarted), 'all continuation 已开始普通 cursor 请求');
  const failedSwitchWithLiveCursor = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  releaseLiveCursor();
  const liveCursorPersisted = await waitFor(() => storageData.history.some(item => item.id === 'live-cursor-after-failed-switch'));
  assert(failedSwitchWithLiveCursor.ok === false && storageData.feedMode === 'all' && liveCursorPersisted, 'failed selected 切换不使进行中的 all cursor 请求失效');

  resetState();
  let raceCursorRequests = 0;
  let releaseStaleRaceCursor;
  let advancedCursorStarted = false;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-continuation-race');
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'race-cursor') {
      raceCursorRequests++;
      if (raceCursorRequests === 1) {
        return new Promise(resolve => {
          releaseStaleRaceCursor = () => resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
            id: 'stale-race-page',
            links: { original: 'https://example.com/stale-race-page', aihot: 'https://aihot.virxact.com/items/stale-race-page' }
          })], { hasMore: true, nextCursor: 'stale-cursor' })) });
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
        id: 'advanced-race-page',
        links: { original: 'https://example.com/advanced-race-page', aihot: 'https://aihot.virxact.com/items/advanced-race-page' }
      })], { hasMore: true, nextCursor: 'advanced-cursor' })) });
    }
    if (cursor === 'advanced-cursor') {
      advancedCursorStarted = true;
      return new Promise(() => {});
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'race-first' })], { hasMore: true, nextCursor: 'race-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(await waitFor(() => raceCursorRequests === 1), '首个 race cursor 请求已悬挂');
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const cursorAdvanced = await waitFor(() => storageData.allFeedContinuation?.cursor === 'advanced-cursor' && advancedCursorStarted);
  releaseStaleRaceCursor();
  await waitFor(() => storageData.history.some(item => item.id === 'stale-race-page') || storageData.allFeedContinuation?.cursor === 'stale-cursor');
  assert(cursorAdvanced && storageData.allFeedContinuation?.cursor === 'advanced-cursor' && !storageData.history.some(item => item.id === 'stale-race-page'), '重复 alarm 的旧 cursor 响应不能回退 continuation 或重复入库');

  console.log('\n[全部内容源续拉终止与非阻塞]');
  resetState();
  let zeroRetryRequests = 0;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-zero-retry');
    if (new URL(url).searchParams.get('cursor') === 'zero-retry') {
      zeroRetryRequests++;
      if (zeroRetryRequests > 5) throw new Error('retry loop did not terminate');
      return Promise.resolve({ ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '0' : '' } });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'zero-retry-first' })], { hasMore: true, nextCursor: 'zero-retry' })) });
  };
  const zeroRetryResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => storageData.allFeedContinuation?.retryAt);
  storageData.allFeedContinuation.retryAt = new Date(Date.now() - 1).toISOString();
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => Number(storageData.allFeedContinuation?.retryAttempts) === 2);
  storageData.allFeedContinuation.retryAt = new Date(Date.now() - 1).toISOString();
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const zeroRetryStopped = await waitFor(() => storageData.allFeedContinuation?.active === false);
  assert(zeroRetryResponse.ok === true && zeroRetryStopped && zeroRetryRequests === 3, '连续 Retry-After: 0 使用有限重试预算并停止续拉');

  resetState();
  let missingHeaderRequests = 0;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => originalSetTimeout(callback, 0);
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-missing-header');
    if (new URL(url).searchParams.get('cursor') === 'missing-header') {
      missingHeaderRequests++;
      if (missingHeaderRequests > 5) throw new Error('missing Retry-After loop did not terminate');
      return Promise.resolve({ ok: false, status: 429, headers: { get: () => '' } });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'missing-header-first' })], { hasMore: true, nextCursor: 'missing-header' })) });
  };
  const missingHeaderResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const missingHeaderStopped = await waitFor(() => storageData.allFeedContinuation?.active === false);
  globalThis.setTimeout = originalSetTimeout;
  assert(missingHeaderResponse.ok === true && missingHeaderStopped && missingHeaderRequests === 1, '缺少 Retry-After 的 429 立即终止续拉，不进入回退忙等');

  resetState();
  let releaseFingerprint;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return new Promise(resolve => { releaseFingerprint = () => resolve({ ok: true, status: 200, headers: { get: () => 'W/"fingerprint"' }, json: () => Promise.resolve({ selected: 'fp-selected', all: 'fp-all-deferred' }) }); });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'fingerprint-deferred-first' })])) });
  };
  let deferredFingerprintResponse;
  const deferredFingerprintReset = sendMessage({ type: 'feedModeChanged', feedMode: 'all' }).then(response => { deferredFingerprintResponse = response; return response; });
  const firstPageBeforeFingerprint = await waitFor(() => Boolean(deferredFingerprintResponse));
  assert(firstPageBeforeFingerprint && storageData.feedMode === 'all' && storageData.history[0]?.id === 'fingerprint-deferred-first', 'all 首屏提交与消息响应不等待 fingerprint probe');
  releaseFingerprint();
  await deferredFingerprintReset;

  resetState();
  let releaseFinalPageFingerprint;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return new Promise(resolve => { releaseFinalPageFingerprint = () => resolve({ ok: true, status: 200, headers: { get: () => 'W/"final-page"' }, json: () => Promise.resolve({ selected: 'fp-selected', all: 'fp-final-page' }) }); });
    if (new URL(url).searchParams.get('cursor') === 'final-page-2') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
        id: 'final-page-2',
        links: { original: 'https://example.com/final-page-2', aihot: 'https://aihot.virxact.com/items/final-page-2' }
      })])) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
      id: 'final-page-1',
      links: { original: 'https://example.com/final-page-1', aihot: 'https://aihot.virxact.com/items/final-page-1' }
    })], { hasMore: true, nextCursor: 'final-page-2' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const finalPageCommitted = await waitFor(() => storageData.history.some(item => item.id === 'final-page-2'));
  assert(finalPageCommitted && storageData.allFeedContinuation?.active === false && Boolean(storageData.lastItemsPollAt), '最终续拉页提交后立即完成状态，不等待 fingerprint probe');
  releaseFinalPageFingerprint();

  resetState();
  let releaseFailingFingerprint;
  let deferredFingerprintWarning = false;
  let unhandledDeferredFingerprintError = null;
  const originalWarn = console.warn;
  const onUnhandledRejection = error => { unhandledDeferredFingerprintError = error; };
  console.warn = (...args) => {
    if (String(args[0]).includes('deferred fingerprint')) deferredFingerprintWarning = true;
    originalWarn(...args);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  failSetWhen = values => Object.prototype.hasOwnProperty.call(values, 'apiFingerprints');
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return new Promise(resolve => { releaseFailingFingerprint = () => resolve({ ok: true, status: 200, headers: { get: () => 'W/"failing"' }, json: () => Promise.resolve({ selected: 'fp-failing-selected', all: 'fp-failing-all' }) }); });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'failing-fingerprint-item' })])) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  releaseFailingFingerprint();
  await waitFor(() => deferredFingerprintWarning || Boolean(unhandledDeferredFingerprintError));
  process.removeListener('unhandledRejection', onUnhandledRejection);
  console.warn = originalWarn;
  assert(deferredFingerprintWarning && !unhandledDeferredFingerprintError, 'deferred fingerprint 存储失败被显式捕获并记录，不产生未处理 rejection');

  resetState();
  let releaseStalledCursor;
  let stalledCursorRequested = false;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-all-stalled');
    const parsed = new URL(url);
    if (parsed.searchParams.get('mode') === 'selected') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'selected-during-stalled-all' })])) });
    }
    if (parsed.searchParams.get('cursor') === 'stalled-cursor') {
      stalledCursorRequested = true;
      return new Promise(resolve => { releaseStalledCursor = () => resolve({ ok: true, json: () => Promise.resolve(v1Page([])) }); });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'stalled-all-first' })], { hasMore: true, nextCursor: 'stalled-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => stalledCursorRequested);
  let selectedDuringStall;
  const selectedDuringStallRequest = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' }).then(response => { selectedDuringStall = response; return response; });
  const selectedFinishedDuringStall = await waitFor(() => Boolean(selectedDuringStall));
  assert(selectedFinishedDuringStall && selectedDuringStall.ok === true && storageData.feedMode === 'selected', '旧 all cursor 网络未完成时，新的 selected 切换仍可完成');
  releaseStalledCursor();
  await selectedDuringStallRequest;

  console.log('\n[全部续拉生命周期与可选失败隔离]');
  resetState({
    feedMode: 'all',
    allFeedContinuation: {
      active: true,
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      discoveredAtByAlias: { stale: new Date().toISOString() }
    }
  });
  assert(typeof onStartupHandler === 'function', '注册 startup 恢复处理器');
  await onStartupHandler();
  assert(storageData.allFeedContinuation?.active === false && Object.keys(storageData.allFeedContinuation?.discoveredAtByAlias || {}).length === 0, 'worker 启动时清除不可能继续执行的旧 all 续拉状态与发现时间索引');

  resetState({
    feedMode: 'all',
    allFeedContinuation: {
      active: true,
      id: 'recover-alarm-failure',
      cursor: 'recover-cursor',
      discoveredAtByAlias: { recoverKnown: new Date().toISOString() }
    }
  });
  let unhandledRecoveryAlarmFailure = null;
  const onUnhandledRecoveryAlarmFailure = error => { unhandledRecoveryAlarmFailure = error; };
  process.on('unhandledRejection', onUnhandledRecoveryAlarmFailure);
  alarmCreateImpl = name => name === 'aihot-all-continuation'
    ? Promise.reject(new Error('mock recovery alarm create failed'))
    : undefined;
  await onStartupHandler();
  await waitFor(() => Boolean(unhandledRecoveryAlarmFailure) || storageData.allFeedContinuation?.active === false);
  process.removeListener('unhandledRejection', onUnhandledRecoveryAlarmFailure);
  assert(!unhandledRecoveryAlarmFailure && storageData.allFeedContinuation?.active === false && Object.keys(storageData.allFeedContinuation?.discoveredAtByAlias || {}).length === 0, 'worker 恢复 alarm Promise 拒绝时收敛续拉并清理发现时间索引');

  resetState({
    feedMode: 'all',
    allFeedContinuation: {
      active: true,
      id: 'resume-alarm-failure',
      cursor: 'resume-cursor',
      retryAt: new Date(Date.now() + 60 * 1000).toISOString(),
      discoveredAtByAlias: { resumeKnown: new Date().toISOString() }
    }
  });
  let unhandledResumeAlarmFailure = null;
  const onUnhandledResumeAlarmFailure = error => { unhandledResumeAlarmFailure = error; };
  process.on('unhandledRejection', onUnhandledResumeAlarmFailure);
  alarmCreateImpl = name => name === 'aihot-all-continuation'
    ? Promise.reject(new Error('mock resume alarm create failed'))
    : undefined;
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => Boolean(unhandledResumeAlarmFailure) || storageData.allFeedContinuation?.active === false);
  process.removeListener('unhandledRejection', onUnhandledResumeAlarmFailure);
  assert(!unhandledResumeAlarmFailure && storageData.allFeedContinuation?.active === false && Object.keys(storageData.allFeedContinuation?.discoveredAtByAlias || {}).length === 0, 'alarm 恢复未来续拉 Promise 拒绝时收敛状态并清理发现时间索引');

  console.log('\n[全部已读水位全局迁移]');
  const latestReadAt = new Date().toISOString();
  const selectedReadAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const legacyGlobalReadAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const readItemTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    history: [{ id: 'globally-read', url: 'https://example.com/globally-read', time: readItemTime }],
    readAllBefore: legacyGlobalReadAt,
    readAllBeforeByMode: { selected: selectedReadAt, all: latestReadAt }
  });
  await onStartupHandler();
  assert(storageData.readAllBefore === latestReadAt && Object.keys(storageData.readAllBeforeByMode || {}).length === 0, '启动时取旧全局与分源水位的最新值合并为全局水位');
  onStorageChangedHandler({ readAllBeforeByMode: {} });
  await waitFor(() => badgeTexts.length > 0);
  assert(badgeTexts.at(-1) === '', '切换到 all 后仍按全局全部已读水位计算 badge');

  const rollbackResponse = await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: legacyGlobalReadAt });
  assert(rollbackResponse.ok === true && storageData.readAllBefore === latestReadAt, '系统时间回拨时全部已读水位不倒退');

  const atomicReadAt = new Date(Date.now() + 30 * 1000).toISOString();
  resetState({
    watchNotifyState: {
      'atomic-watch': { firstMatchedAt: selectedReadAt, notifyCount: 1, viewedAt: '' },
      'future-watch': { firstMatchedAt: new Date(new Date(atomicReadAt).getTime() + 60 * 1000).toISOString(), notifyCount: 0, viewedAt: '' }
    }
  });
  const atomicReadResponse = await sendMessageWithTimeout({
    type: 'markAllRead',
    readAllBefore: atomicReadAt
  });
  assert(atomicReadResponse.ok === true && storageData.readAllBefore === atomicReadAt && Boolean(storageData.watchNotifyState['atomic-watch']?.viewedAt), '全部已读在同一后台提交中同步推进水位与特关已查看状态');
  assert(storageData.watchNotifyState['future-watch']?.viewedAt === '', '全部已读不抑制水位生成后才匹配的新特关状态');

  const concurrentReadAt = new Date(Date.now() + 60 * 1000).toISOString();
  resetState({ readAllBeforeByMode: { selected: selectedReadAt } });
  const migratePromise = onStartupHandler();
  const markAllPromise = sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: concurrentReadAt });
  const [, concurrentResponse] = await Promise.all([migratePromise, markAllPromise]);
  assert(concurrentResponse.ok === true && storageData.readAllBefore === concurrentReadAt && Object.keys(storageData.readAllBeforeByMode || {}).length === 0, '旧水位迁移与全部已读并发时保留最新全局水位');

  console.log('\n[全部已读后切源保持已读]');
  const originalDiscoveredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const originalPublishedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const globalReadAt = new Date(Date.now() - 1000).toISOString();
  resetState({
    feedMode: 'selected',
    history: [{
      id: 'shared-after-switch',
      title: '切源共享条目',
      url: 'https://example.com/shared-after-switch',
      permalink: 'https://aihot.virxact.com/items/shared-after-switch',
      time: originalPublishedAt,
      discoveredAt: originalDiscoveredAt,
      selected: true
    }]
  });
  const markBeforeSwitch = await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: globalReadAt });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected', 'fp-all-after-read');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        v1Item({
          id: 'shared-after-switch',
          title: '切源共享条目',
          publishedAt: originalPublishedAt,
          selected: true,
          links: {
            original: 'https://example.com/shared-after-switch',
            aihot: 'https://aihot.virxact.com/items/shared-after-switch'
          }
        }),
        v1Item({
          id: 'new-after-switch',
          title: '切源后新发现条目',
          publishedAt: originalPublishedAt,
          links: {
            original: 'https://example.com/new-after-switch',
            aihot: 'https://aihot.virxact.com/items/new-after-switch'
          }
        })
      ]))
    });
  };
  const switchedAfterRead = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const sharedAfterSwitch = storageData.history.find(item => item.id === 'shared-after-switch');
  const newAfterSwitch = storageData.history.find(item => item.id === 'new-after-switch');
  onStorageChangedHandler({ history: {} });
  await waitFor(() => badgeTexts.length > 0);
  assert(markBeforeSwitch.ok === true && switchedAfterRead.ok === true && sharedAfterSwitch?.discoveredAt === originalDiscoveredAt, '切源重建同一条目时保留原发现时间');
  assert(new Date(newAfterSwitch?.discoveredAt || 0) > new Date(globalReadAt) && badgeTexts.at(-1) === '1', '切源后首次发现的条目仍计为未读');

  const deepSelectedDiscoveredAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const deepSelectedItem = {
    id: 'deep-selected-item',
    title: '全量历史深层精选',
    url: 'https://example.com/deep-selected-item',
    permalink: 'https://aihot.virxact.com/items/deep-selected-item',
    time: originalPublishedAt,
    discoveredAt: deepSelectedDiscoveredAt,
    selected: true
  };
  const denseAllHistory = [
    ...Array.from({ length: 2000 }, (_, index) => ({
      id: `dense-all-${index}`,
      url: `https://example.com/dense-all-${index}`,
      time: new Date(Date.now() - index * 1000).toISOString(),
      discoveredAt: new Date(Date.now() - index * 1000).toISOString()
    })),
    deepSelectedItem
  ];
  resetState({ feedMode: 'all', history: denseAllHistory });
  await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: globalReadAt });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected-deep', 'fp-all');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({
        id: 'deep-selected-item',
        title: '全量历史深层精选',
        selected: true,
        publishedAt: originalPublishedAt,
        links: {
          original: 'https://example.com/deep-selected-item',
          aihot: 'https://aihot.virxact.com/items/deep-selected-item'
        }
      })]))
    });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(storageData.history[0]?.discoveredAt === deepSelectedDiscoveredAt, 'all 切回 selected 时深层精选条目仍继承原发现时间');

  const exactIdDiscoveredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const collidingUrlDiscoveredAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const collidingUrl = 'https://example.com/shared-source-url';
  resetState({
    feedMode: 'selected',
    history: [
      { id: 'exact-id-item', url: collidingUrl, time: originalPublishedAt, discoveredAt: exactIdDiscoveredAt },
      { id: 'other-id-item', url: collidingUrl, time: originalPublishedAt, discoveredAt: collidingUrlDiscoveredAt }
    ]
  });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected', 'fp-all-alias-priority');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({
        id: 'exact-id-item',
        title: '精确 ID 条目',
        publishedAt: originalPublishedAt,
        links: {
          original: collidingUrl,
          aihot: 'https://aihot.virxact.com/items/exact-id-item'
        }
      })]))
    });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(storageData.history[0]?.discoveredAt === exactIdDiscoveredAt, '发现时间优先按精确 ID 继承，不被碰撞 URL 的更早时间覆盖');

  const viewedBeforeSwitchAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const matchedBeforeSwitchAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'selected',
    history: [{
      id: 'viewed-on-continuation',
      title: '已查看续拉特关',
      source: '关注来源',
      url: 'https://example.com/viewed-on-continuation',
      permalink: 'https://aihot.virxact.com/items/viewed-on-continuation',
      time: originalPublishedAt,
      discoveredAt: originalDiscoveredAt,
      watchMatched: true,
      watchRuleIds: ['wr_existing']
    }, {
      id: 'hidden-unviewed-on-continuation',
      title: '隐藏未查看续拉特关',
      source: '关注来源',
      url: 'https://example.com/hidden-unviewed-on-continuation',
      permalink: 'https://aihot.virxact.com/items/hidden-unviewed-on-continuation',
      time: originalPublishedAt,
      discoveredAt: originalDiscoveredAt,
      watchMatched: true,
      watchRuleIds: ['wr_existing']
    }],
    watchRules: [{ id: 'wr_existing', source: '关注来源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      'viewed-on-continuation': {
        ruleIds: ['wr_existing'],
        firstMatchedAt: matchedBeforeSwitchAt,
        lastNotifiedAt: matchedBeforeSwitchAt,
        notifyCount: 2,
        nextNotifyAt: '',
        viewedAt: viewedBeforeSwitchAt
      },
      'hidden-unviewed-on-continuation': {
        ruleIds: ['wr_existing'],
        firstMatchedAt: matchedBeforeSwitchAt,
        lastNotifiedAt: matchedBeforeSwitchAt,
        notifyCount: 1,
        nextNotifyAt: '',
        viewedAt: ''
      }
    }
  });
  let viewedFingerprintRequests = 0;
  let viewedFirstPageRequests = 0;
  let viewedContinuationRequested = false;
  let releaseViewedContinuation;
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) {
      viewedFingerprintRequests++;
      return legacyFingerprintResponse('fp-selected', `fp-all-viewed-continuation-${viewedFingerprintRequests}`);
    }
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'viewed-continuation') {
      viewedContinuationRequested = true;
      return new Promise(resolve => {
        releaseViewedContinuation = () => resolve({
          ok: true,
          json: () => Promise.resolve(v1Page([v1Item({
            id: 'viewed-on-continuation',
            title: '已查看续拉特关',
            source: { name: '关注来源' },
            publishedAt: originalPublishedAt,
            links: {
              original: 'https://example.com/viewed-on-continuation',
              aihot: 'https://aihot.virxact.com/items/viewed-on-continuation'
            }
          }), v1Item({
            id: 'hidden-unviewed-on-continuation',
            title: '隐藏未查看续拉特关',
            source: { name: '关注来源' },
            publishedAt: originalPublishedAt,
            links: {
              original: 'https://example.com/hidden-unviewed-on-continuation',
              aihot: 'https://aihot.virxact.com/items/hidden-unviewed-on-continuation'
            }
          })]))
        });
      });
    }
    viewedFirstPageRequests++;
    if (viewedFirstPageRequests > 1) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(v1Page([v1Item({ id: 'manual-during-continuation', source: { name: '其它来源' } })]))
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'unrelated-first-page', source: { name: '其它来源' } })], { hasMore: true, nextCursor: 'viewed-continuation' }))
    });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => viewedContinuationRequested);
  const manualDuringContinuation = await sendMessage({ type: 'pollNow' });
  const retainedDuringManualPoll = storageData.watchNotifyState['viewed-on-continuation'];
  assert(manualDuringContinuation.ok === true && retainedDuringManualPoll?.viewedAt === viewedBeforeSwitchAt, 'active all 续拉期间手动刷新不提前清理后续页特关状态');
  const markAllDuringContinuation = await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: new Date().toISOString() });
  assert(markAllDuringContinuation.ok === true && Boolean(storageData.watchNotifyState['hidden-unviewed-on-continuation']?.viewedAt), 'active all 续拉期间全部已读覆盖尚未回到 history 的特关状态');
  releaseViewedContinuation();
  await waitFor(() => storageData.history.some(item => item.id === 'viewed-on-continuation'));
  const viewedContinuationState = storageData.watchNotifyState['viewed-on-continuation'];
  assert(viewedContinuationState?.viewedAt === viewedBeforeSwitchAt && viewedContinuationState?.firstMatchedAt === matchedBeforeSwitchAt && viewedContinuationState?.notifyCount === 2, 'all 首屏后续拉保留已查看特关的原提醒状态');
  assert(Boolean(storageData.watchNotifyState['hidden-unviewed-on-continuation']?.viewedAt), '后续页回归 history 后仍保持全部已读设置的特关已查看状态');

  const continuedOriginalDiscoveredAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'selected',
    history: [{
      id: 'shared-on-continuation',
      title: '续拉共享条目',
      url: 'https://example.com/shared-on-continuation',
      permalink: 'https://aihot.virxact.com/items/shared-on-continuation',
      time: originalPublishedAt,
      discoveredAt: continuedOriginalDiscoveredAt,
      selected: true
    }],
    watchRules: [{ id: 'wr_added_later', source: 'v1 来源', author: '', keywords: [], enabled: true }]
  });
  await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: globalReadAt });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected', 'fp-all-continuation-read');
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'read-continuation') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(v1Page([v1Item({
          id: 'shared-on-continuation',
          title: '续拉共享条目',
          publishedAt: originalPublishedAt,
          selected: true,
          links: {
            original: 'https://example.com/shared-on-continuation',
            aihot: 'https://aihot.virxact.com/items/shared-on-continuation'
          }
        })]))
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'new-first-page-after-read' })], { hasMore: true, nextCursor: 'read-continuation' }))
    });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const continuedKnownPersisted = await waitFor(() => storageData.history.some(item => item.id === 'shared-on-continuation'));
  const sharedOnContinuation = storageData.history.find(item => item.id === 'shared-on-continuation');
  assert(continuedKnownPersisted && sharedOnContinuation?.discoveredAt === continuedOriginalDiscoveredAt, 'all 后台续拉再次遇到同一条目时也保留原发现时间');
  assert(new Date(sharedOnContinuation?.watchMatchedAt || 0) > new Date(globalReadAt) && new Date(storageData.watchNotifyState['shared-on-continuation']?.firstMatchedAt || 0) > new Date(globalReadAt), '后来新增的特关规则使用本次匹配时间，不回填旧发现时间');

  let releaseRecoveredCursor;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-recovery');
    const parsed = new URL(url);
    if (parsed.searchParams.get('mode') === 'selected') return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'recovery-selected' })])) });
    if (parsed.searchParams.get('cursor') === 'recovery-cursor') return new Promise(resolve => { releaseRecoveredCursor = () => resolve({ ok: true, json: () => Promise.resolve(v1Page([])) }); });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'recovery-all-first' })], { hasMore: true, nextCursor: 'recovery-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const freshContinuationStarted = await waitFor(() => storageData.allFeedContinuation?.active === true && Boolean(releaseRecoveredCursor));
  assert(freshContinuationStarted, '启动恢复后新发起的 all 续拉仍可正常标记为 active');
  const recoverySelected = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  releaseRecoveredCursor();
  await recoverySelected;

  resetState();
  let optional429Requests = 0;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-optional-429');
    const parsed = new URL(url);
    if (parsed.searchParams.get('mode') === 'selected') return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'selected-after-optional-429' })])) });
    if (parsed.searchParams.get('cursor') === 'optional-429') {
      optional429Requests++;
      return Promise.resolve({ ok: false, status: 429, headers: { get: () => '' } });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'optional-429-first' })], { hasMore: true, nextCursor: 'optional-429' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => storageData.allFeedContinuation?.active === false);
  const selectedAfterOptional429 = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(optional429Requests === 1 && selectedAfterOptional429.ok === true && storageData.feedMode === 'selected', '可选 all 续拉失败不设置全局 backoff，显式 selected 切换仍立即成功');

  resetState();
  let releaseOldAllFingerprint;
  let fingerprintRequestCount = 0;
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      fingerprintRequestCount++;
      if (fingerprintRequestCount === 1) {
        return new Promise(resolve => { releaseOldAllFingerprint = () => resolve({ ok: true, status: 200, headers: { get: () => 'W/"old-all"' }, json: () => Promise.resolve({ selected: 'old-selected', all: 'old-all' }) }); });
      }
      return legacyFingerprintResponse('new-selected', 'new-all');
    }
    if (new URL(url).searchParams.get('mode') === 'selected') return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'new-selected-item' })])) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'old-all-item' })])) });
  };
  const oldAllResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const newSelectedResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  releaseOldAllFingerprint();
  await waitFor(() => storageData.apiFingerprints?.selected === 'new-selected');
  assert(oldAllResponse.ok === true && newSelectedResponse.ok === true && storageData.apiFingerprints?.selected === 'new-selected' && storageData.apiFingerprints?.all === 'new-all', '旧 one-page all 的延迟 fingerprint 不覆盖后续内容源切换的 fingerprint');

  console.log('\n[自动轮询-fingerprint 未变化时跳过 items]');
  resetState({
    apiFingerprints: { selected: 'fp-selected' },
    lastItemsPollAt: new Date().toISOString(),
    history: [{ title: '旧内容', url: 'https://example.com/old', time: new Date().toISOString() }]
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ title: '不应拉取' })])) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  assert(requestedUrls.length === 1 && requestedUrls[0].includes('/api/public/fingerprint'), 'fingerprint 未变化时只请求 legacy fingerprint');
  assert(storageData.history[0].url === 'https://example.com/old', 'fingerprint 未变化时不覆盖 history');

  console.log('\n[自动轮询-fingerprint 304 缺 mode 时拉取 v1 items]');
  resetState({
    feedMode: 'all',
    apiFingerprints: { selected: 'fp-selected' },
    apiFingerprintEtags: { current: 'W/"fingerprint"' },
    lastItemsPollAt: new Date().toISOString()
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return Promise.resolve({ ok: true, status: 304, headers: { get: () => 'W/"fingerprint"' } });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'v1-304' })])) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  assert(requestedUrls.some(url => isV1ItemsUrl(url, 'all')), '304 缺 mode 时请求 v1 items');

  console.log('\n[自动轮询-safety poll]');
  resetState({
    apiFingerprints: { selected: 'fp-selected' },
    lastItemsPollAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'v1-safety' })])) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  assert(requestedUrls.some(url => isV1ItemsUrl(url, 'selected')), 'safety poll 到期时请求 v1 items');

  console.log('\n[自动轮询-v1 分页截断]');
  const oldLastItemsPollAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  resetState({
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: oldLastItemsPollAt
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    const cursor = new URL(url).searchParams.get('cursor');
    const page = cursor ? Number(cursor.replace('v1-page-', '')) : 1;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        v1Item({ id: `v1-page-${page}`, title: `v1 第 ${page} 页` })
      ], { hasMore: true, nextCursor: `v1-page-${page + 1}` }))
    });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  assert(requestedUrls.filter(url => isV1ItemsUrl(url, 'selected') || new URL(url).pathname === '/api/v1/items').length === 3, '达到上限时保留 v1 分页截断语义');
  assert(storageData.lastItemsPollAt === oldLastItemsPollAt, '分页截断时不推进 lastItemsPollAt');

  console.log('\n[自动轮询-storage 失败不提交 fingerprint]');
  resetState({
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: new Date().toISOString()
  });
  failSetWhen = values => Object.prototype.hasOwnProperty.call(values, 'history');
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'v1-storage-failure' })])) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  assert(storageData.apiFingerprints.selected === 'fp-old', 'history 写入失败时不提交 fingerprint');

  console.log('\n[通知点击-v1 item]');
  resetState({
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: new Date().toISOString(),
    watchRules: [{ id: 'wr_v1', source: 'X', author: '目标作者', keywords: [], enabled: true }],
    watchNotifyState: {},
    notificationUrlMap: {}
  });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        v1Item({
          id: 'v1-watch',
          source: { name: 'X：目标作者' },
          links: {
            original: 'https://example.com/v1-watch',
            aihot: 'https://aihot.virxact.com/items/v1-watch'
          }
        })
      ]))
    });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  const notificationId = notificationCreateIds[0];
  if (notificationId) await onClickedHandler(notificationId);
  assert(notificationId && openedTabs[0] === 'https://example.com/v1-watch', '点击 v1 特关通知打开 original 链接');

  console.log('\n[并发轮询与特关状态清理]');
  resetState({
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: new Date().toISOString(),
    watchRules: [{ id: 'wr_concurrent', source: 'X', author: '目标作者', keywords: [], enabled: true }],
    watchNotifyState: {}
  });
  let releaseConcurrentItems;
  const concurrentItemsReady = new Promise(resolve => { releaseConcurrentItems = resolve; });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return concurrentItemsReady.then(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        v1Item({
          id: 'v1-concurrent-watch',
          source: { name: 'X：目标作者' },
          links: {
            original: 'https://example.com/v1-concurrent-watch',
            aihot: 'https://aihot.virxact.com/items/v1-concurrent-watch'
          }
        })
      ]))
    }));
  };

  const concurrentFirst = onAlarmHandler({ name: 'aihot-poll' });
  const concurrentSecond = onAlarmHandler({ name: 'aihot-poll' });
  for (let index = 0; index < 20 && requestedUrls.filter(url => new URL(url).pathname === '/api/v1/items').length === 0; index++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  releaseConcurrentItems();
  await Promise.all([concurrentFirst, concurrentSecond]);

  assert(storageData.history.length === 1, '并发 alarm 轮询不会丢失或重复 history 条目');
  assert(notificationCreateIds.filter(id => id.startsWith('aihot-watch-')).length === 1, '并发 alarm 轮询不会重复发送特关通知');
  assert(storageData.watchNotifyState['v1-concurrent-watch']?.notifyCount === 1, '并发 alarm 轮询只推进一次特关提醒状态');

  resetState({
    notificationUrlMap: {
      'aihot-close-first': 'https://example.com/first',
      'aihot-close-second': 'https://example.com/second'
    },
    notificationStateKeyMap: {
      'aihot-close-first': 'first-key',
      'aihot-close-second': 'second-key'
    }
  });
  assert(typeof onClosedHandler === 'function', '注册关闭通知的清理处理器');
  if (onClosedHandler) {
    await Promise.all([
      onClosedHandler('aihot-close-first'),
      onClosedHandler('aihot-close-second')
    ]);
  }
  assert(Object.keys(storageData.notificationUrlMap || {}).length === 0 && Object.keys(storageData.notificationStateKeyMap || {}).length === 0, '并发关闭通知不会丢失其它通知映射的清理');

  resetState();
  let releaseAlarmClear;
  alarmClearImpl = () => new Promise(resolve => { releaseAlarmClear = resolve; });
  let configResponded = false;
  const configChanged = sendMessage({ type: 'configChanged' }).then(response => {
    configResponded = response.ok === true;
  });
  await Promise.resolve();
  assert(!configResponded, 'configChanged 在 alarm 配置完成前不提前响应');
  for (let index = 0; index < 20 && !releaseAlarmClear; index++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  releaseAlarmClear();
  await configChanged;
  assert(configResponded, 'configChanged 在串行 alarm 配置完成后响应成功');
  assert(typeof onStorageChangedHandler === 'function', '注册 storage badge 更新处理器');

  resetState({
    apiFingerprints: { selected: 'fp-old' },
    history: [{
      id: 'v1-retained',
      title: '保留条目',
      url: 'https://example.com/v1-retained',
      permalink: 'https://aihot.virxact.com/items/v1-retained',
      source: 'X：目标作者',
      time: new Date().toISOString()
    }],
    watchNotifyState: {
      'v1-retained': { notifyCount: 1 },
      'https://example.com/v1-retained': { notifyCount: 1 },
      'https://aihot.virxact.com/items/v1-retained': { notifyCount: 1 },
      'orphan-watch-state': { notifyCount: 1 }
    }
  });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([
        v1Item({
          id: 'v1-retained',
          links: {
            original: 'https://example.com/v1-retained',
            aihot: 'https://aihot.virxact.com/items/v1-retained'
          },
          source: { name: 'X：目标作者' }
        })
      ]))
    });
  };

  const cleanupResponse = await sendMessage({ type: 'pollNow' });
  assert(cleanupResponse.ok === true, '合并已有条目时清理特关状态仍可成功');
  assert(storageData.watchNotifyState['v1-retained'] && storageData.watchNotifyState['https://example.com/v1-retained'] && storageData.watchNotifyState['https://aihot.virxact.com/items/v1-retained'], '清理 orphan 特关状态时保留 history 关联的所有 aliases');
  assert(!storageData.watchNotifyState['orphan-watch-state'], '合并 history 时移除 orphan 特关状态');

  console.log('\n[API 失败语义]');
  resetState({ apiFingerprints: { selected: 'fp-old' } });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-new');
    return Promise.resolve({ ok: false, status: 500 });
  };

  const failureResponse = await sendMessage({ type: 'pollNow' });

  assert(failureResponse.ok === false, 'API 500 时手动刷新返回失败');
  assert(storageData.failCount === 1, 'API 500 时递增失败计数');

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
