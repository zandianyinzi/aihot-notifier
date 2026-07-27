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
let onInstalledHandler = null;
let storageData = {
  feedMode: 'selected',
  history: [{
    id: 'legacy-selected-before-migration',
    url: 'https://example.com/legacy-selected-before-migration',
    time: new Date().toISOString(),
    discoveredAt: new Date().toISOString()
  }]
};
let fetchImpl = null;
let requestedUrls = [];
let openedTabs = [];
let notificationCreateIds = [];
let alarmCreateCalls = [];
let alarmClearCalls = [];
let badgeTexts = [];
let canonicalMigrationFailuresRemaining = 1;
let failSetWhen = values => Object.prototype.hasOwnProperty.call(values, 'canonicalHistoryVersion') && canonicalMigrationFailuresRemaining-- > 0;
let storageSetImpl = null;
let alarmCreateImpl = null;
let alarmClearImpl = null;
let badgeTextImpl = null;
let badgeBackgroundImpl = null;
let canonicalMigrationCommitCount = 0;
let activeAlarmNames = new Set();
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
  storageSetImpl = null;
  alarmCreateImpl = null;
  alarmClearImpl = null;
  badgeTextImpl = null;
  badgeBackgroundImpl = null;
  activeAlarmNames = new Set();
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
        if (storageSetImpl) return storageSetImpl(values);
        if (Object.prototype.hasOwnProperty.call(values, 'canonicalHistoryVersion')) canonicalMigrationCommitCount++;
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
    setBadgeText: ({ text }) => {
      badgeTexts.push(text);
      if (badgeTextImpl) return badgeTextImpl(text);
    },
    setBadgeBackgroundColor: ({ color }) => {
      if (badgeBackgroundImpl) return badgeBackgroundImpl(color);
    }
  },
  tabs: { create: (options) => { openedTabs.push(options.url); } },
  alarms: {
    create: (name, info) => {
      alarmCreateCalls.push({ name, info });
      activeAlarmNames.add(name);
      if (alarmCreateImpl) return alarmCreateImpl(name, info);
    },
    clear: (name) => {
      alarmClearCalls.push(name);
      const result = alarmClearImpl ? alarmClearImpl(name) : Promise.resolve();
      return Promise.resolve(result).then(value => {
        activeAlarmNames.delete(name);
        return value;
      });
    },
    onAlarm: { addListener: (handler) => { onAlarmHandler = handler; } }
  },
  runtime: {
    onInstalled: { addListener: (handler) => { onInstalledHandler = handler; } },
    onStartup: { addListener: (handler) => { onStartupHandler = handler; } },
    onMessage: { addListener: (handler) => { onMessageHandler = handler; } }
  }
};

globalThis.fetch = (...args) => fetchImpl(...args);

const backgroundApi = require('./background.js');
const { projectHistory } = require('./feed-state.js');

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
  console.log('\n[canonical history 一次性迁移]');
  const failedMigration = await sendMessage({ type: 'configChanged' });
  failSetWhen = null;
  const retriedMigration = await sendMessage({ type: 'configChanged' });
  assert(failedMigration.ok === false && retriedMigration.ok === true && storageData.canonicalHistoryVersion === 1 && canonicalMigrationCommitCount === 1, 'canonical migration 首次写入失败后清除 rejection cache 并在下一次入口重试成功');
  if (!retriedMigration.ok) {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`结果: ${passed} passed, ${failed} failed`);
    process.exit(1);
    return;
  }
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('cold-selected', 'cold-all')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'cold-entry-item' })])) });
  const coldAlarm = onAlarmHandler({ name: 'aihot-poll' });
  const coldSourceSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const [, coldSourceResult] = await Promise.all([coldAlarm, coldSourceSwitch]);
  const initialMigrationCompleted = storageData.canonicalHistoryVersion === 1;
  const migratedLegacySelected = storageData.history.find(item => item.id === 'legacy-selected-before-migration');
  assert(initialMigrationCompleted && migratedLegacySelected?.selected === true, '冷 worker 首次进入时把 legacy selected history 提升为 canonical selected membership');
  assert(coldSourceResult.ok === true && canonicalMigrationCommitCount === 1, 'startup 初始化前到达的 alarm/source-switch 共用同一次 migration barrier');
  migratedLegacySelected.selected = false;
  await onStartupHandler();
  assert(storageData.canonicalHistoryVersion === 1 && migratedLegacySelected.selected === false && canonicalMigrationCommitCount === 1, 'canonical migration marker 存在时不会再次批量提升 membership');
  const allModeMigration = typeof backgroundApi.migrateCanonicalHistoryState === 'function'
    ? backgroundApi.migrateCanonicalHistoryState({
      feedMode: 'all',
      history: [{ id: 'all-explicit', selected: true }, { id: 'all-missing' }, { id: 'all-false', selected: false }]
    })
    : null;
  assert(allModeMigration?.history[0]?.selected === true && allModeMigration?.history[1]?.selected === false && allModeMigration?.history[2]?.selected === false && allModeMigration?.canonicalHistoryVersion === 1, 'marker 缺失的 all-mode migration 仅规范化显式 membership');
  assert(backgroundApi.isCompleteSelectedSnapshot({ termination: 'complete', skippedItems: 0, truncated: false }, 'selected', true) === true, '能力开启时仅正常完整 selected 快照允许按缺席降级');
  assert(backgroundApi.isCompleteSelectedSnapshot({ termination: 'complete', skippedItems: 1, truncated: false }, 'selected', true) === false && backgroundApi.isCompleteSelectedSnapshot({ termination: 'page-bound', skippedItems: 0, truncated: true }, 'selected', true) === false && backgroundApi.isCompleteSelectedSnapshot({ termination: 'complete', skippedItems: 0, truncated: false }, 'selected', false) === false, '无效条目、截断或生产能力关闭时禁止 selected 缺席降级');

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

  console.log('\n[首次安装发现时间]');
  const oldInstallPublishedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const installFetchStartedAt = Date.now();
  resetState();
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({
      id: 'install-old-published',
      publishedAt: oldInstallPublishedAt,
      links: {
        original: 'https://example.com/install-old-published',
        aihot: 'https://aihot.virxact.com/items/install-old-published'
      }
    })]))
  });
  await onInstalledHandler({ reason: 'install' });
  const installedItem = storageData.history.find(item => item.id === 'install-old-published');
  assert(new Date(installedItem?.discoveredAt || 0).getTime() >= installFetchStartedAt && installedItem?.discoveredAt !== oldInstallPublishedAt, '首次安装的新身份使用当前抓取时间作为 discoveredAt');

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
  assert(storageData.feedMode === 'all' && storageData.history.length === 2006 && storageData.history.some(item => item.id === 'all-page-1') && storageData.history.some(item => item.id === 'previous-progressive-2004'), 'all 首屏成功后立即提交 feedMode 并保留 canonical history');
  assert(!Object.prototype.hasOwnProperty.call(storageData.allFeedContinuation || {}, 'discoveredAtByAlias'), '新续拉状态不再生成有上限的发现时间索引');
  const secondPageStarted = await waitFor(() => allSecondPageRequested);
  assert(secondPageStarted && requestedUrls.some(url => isV1ItemsUrl(url, 'all', 'all-page-2')), '后台续拉沿用首屏返回的 cursor 参数');

  const selectedReset = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  releaseAllSecondPage();
  await Promise.all([progressiveReset, selectedReset]);
  assert(storageData.feedMode === 'selected' && storageData.history.some(item => item.id === 'selected-after-all') && storageData.history.some(item => item.id === 'previous-progressive-2004'), '新 generation 提交 selected 并保留 canonical history');
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
  const longRetryCompleted = await waitFor(() => longRetryRequests === 2 && storageData.allFeedContinuation?.active === false, 100);
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

  resetState({
    feedMode: 'all',
    allFeedContinuation: { active: true, id: 'atomic-continuation', cursor: 'atomic-cursor', retryAttempts: 0, retryAt: '' }
  });
  failSetWhen = values => values.allFeedContinuation?.cursor === 'atomic-next';
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({ id: 'atomic-page-item' })], { hasMore: true, nextCursor: 'atomic-next' }))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  assert(!storageData.history.some(item => item.id === 'atomic-page-item'), '续拉 cursor 提交失败时不单独提交页面 history');

  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    allFeedContinuation: { active: true, id: 'partial-success-continuation', cursor: 'partial-success-cursor', retryAttempts: 0, retryAt: '' }
  });
  let partialSuccessNextStarted = false;
  let redundantContinuationSetFailures = 0;
  failSetWhen = values => {
    const redundantSet = Object.keys(values).length === 1 && Object.prototype.hasOwnProperty.call(values, 'watchNotifyState');
    if (redundantSet) redundantContinuationSetFailures++;
    return redundantSet;
  };
  fetchImpl = (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'partial-success-next') {
      partialSuccessNextStarted = true;
      return new Promise(() => {});
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'partial-success-item' })], { hasMore: true, nextCursor: 'partial-success-next' }))
    });
  };
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const partialSuccessContinued = await waitFor(() => partialSuccessNextStarted, 100);
  assert(partialSuccessContinued && redundantContinuationSetFailures === 0 && storageData.history.some(item => item.id === 'partial-success-item'), '续拉原子提交后不再执行可失败的重复 storage 写，已推进 cursor 继续运行');

  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    allFeedContinuation: { active: true, id: 'badge-failure-continuation', cursor: 'badge-failure-cursor', retryAttempts: 0, retryAt: '' }
  });
  let badgeFailureNextStarted = false;
  badgeTextImpl = () => Promise.reject(new Error('mock continuation badge failed'));
  fetchImpl = (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'badge-failure-next') {
      badgeFailureNextStarted = true;
      return new Promise(() => {});
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'badge-failure-item' })], { hasMore: true, nextCursor: 'badge-failure-next' }))
    });
  };
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const badgeFailureContinued = await waitFor(() => badgeFailureNextStarted, 100);
  assert(badgeFailureContinued && storageData.allFeedContinuation?.cursor === 'badge-failure-next', '续拉页面已提交后 badge 失败不搁置已推进的 cursor');

  const expiredContinuationTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    historyDays: 2,
    history: [{ id: 'expired-continuation-item', url: 'https://example.com/expired-continuation-item', time: expiredContinuationTime, discoveredAt: expiredContinuationTime }],
    watchNotifyState: { 'expired-continuation-item': { ruleIds: ['expired-rule'], firstMatchedAt: expiredContinuationTime } },
    allFeedContinuation: { active: true, id: 'prune-continuation', cursor: 'prune-cursor', retryAttempts: 0, retryAt: '' }
  });
  fetchImpl = (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'prune-next') return new Promise(() => {});
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'prune-current-item' })], { hasMore: true, nextCursor: 'prune-next' }))
    });
  };
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => storageData.allFeedContinuation?.cursor === 'prune-next', 100);
  assert(!storageData.history.some(item => item.id === 'expired-continuation-item') && !storageData.watchNotifyState['expired-continuation-item'], '续拉中间页同步清理过期 canonical history 与 orphan 特关状态');

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
      active: false,
      discoveredAtByAlias: { settledLegacy: new Date().toISOString() }
    }
  });
  await onStartupHandler();
  assert(!Object.prototype.hasOwnProperty.call(storageData.allFeedContinuation || {}, 'discoveredAtByAlias'), 'worker 启动时清理已终止 legacy 续拉的发现索引字段');

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
  assert(!unhandledResumeAlarmFailure && storageData.allFeedContinuation?.active === false && !Object.prototype.hasOwnProperty.call(storageData.allFeedContinuation || {}, 'discoveredAtByAlias'), 'alarm 恢复未来续拉 Promise 拒绝时收敛状态并删除发现时间索引');

  const legacyFallbackDiscoveredAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    allFeedContinuation: {
      active: true,
      id: 'legacy-fallback-continuation',
      cursor: 'legacy-fallback-cursor',
      retryAttempts: 0,
      retryAt: '',
      discoveredAtByAlias: { 'id:legacy-fallback-item': legacyFallbackDiscoveredAt }
    }
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({ id: 'legacy-fallback-item' })]))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const legacyFallbackCompleted = await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  assert(legacyFallbackCompleted && storageData.history.find(item => item.id === 'legacy-fallback-item')?.discoveredAt === legacyFallbackDiscoveredAt, 'active legacy 续拉仅作为缺失 canonical 身份的一次性 discovery fallback');
  assert(!Object.prototype.hasOwnProperty.call(storageData.allFeedContinuation || {}, 'discoveredAtByAlias'), 'legacy fallback 续拉完成后删除发现索引字段');

  const canonicalDiscoveryWinsAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    history: [{
      id: 'canonical-before-legacy-fallback',
      title: '已有 canonical 身份',
      url: 'https://example.com/canonical-before-legacy-fallback',
      permalink: 'https://aihot.virxact.com/items/canonical-before-legacy-fallback',
      time: canonicalDiscoveryWinsAt,
      discoveredAt: canonicalDiscoveryWinsAt
    }],
    allFeedContinuation: {
      active: true,
      id: 'legacy-must-not-override-canonical',
      cursor: 'legacy-must-not-override-canonical-cursor',
      retryAttempts: 0,
      retryAt: '',
      discoveredAtByAlias: { 'id:canonical-before-legacy-fallback': legacyFallbackDiscoveredAt }
    }
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({
      id: 'canonical-before-legacy-fallback',
      links: {
        original: 'https://example.com/canonical-before-legacy-fallback',
        aihot: 'https://aihot.virxact.com/items/canonical-before-legacy-fallback'
      }
    })]))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  assert(storageData.history.find(item => item.id === 'canonical-before-legacy-fallback')?.discoveredAt === canonicalDiscoveryWinsAt, 'legacy discovery fallback 不覆盖已存在的 canonical discovery');

  const canonicalAliasDiscovery = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const staleLegacyAliasDiscovery = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    history: [{
      title: '无 ID canonical 记录',
      url: 'https://example.com/canonical-alias',
      permalink: 'https://aihot.virxact.com/items/original-canonical-alias',
      time: canonicalAliasDiscovery,
      discoveredAt: canonicalAliasDiscovery
    }],
    allFeedContinuation: {
      active: true,
      id: 'legacy-alias-continuation',
      cursor: 'legacy-alias-cursor',
      retryAttempts: 0,
      retryAt: '',
      discoveredAtByAlias: { 'permalink:https://aihot.virxact.com/items/incoming-alias': staleLegacyAliasDiscovery }
    }
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({
      id: 'canonical-alias-id',
      links: {
        original: 'https://example.com/canonical-alias',
        aihot: 'https://aihot.virxact.com/items/incoming-alias'
      }
    })]))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  assert(storageData.history.find(item => item.id === 'canonical-alias-id')?.discoveredAt === canonicalAliasDiscovery, '次级别名命中 canonical 记录时旧 discovery 索引不能覆盖 canonical 时间');

  const uniqueLegacyAliasDiscovery = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    allFeedContinuation: {
      active: true,
      id: 'unique-legacy-alias-continuation',
      cursor: 'unique-legacy-alias-cursor',
      retryAttempts: 0,
      retryAt: '',
      discoveredAtByAlias: { 'permalink:https://aihot.virxact.com/items/unique-legacy-alias': uniqueLegacyAliasDiscovery }
    }
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({
      id: 'unique-legacy-alias-item',
      links: {
        original: 'https://example.com/unique-legacy-alias',
        aihot: 'https://aihot.virxact.com/items/unique-legacy-alias'
      }
    })]))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  assert(storageData.history.find(item => item.id === 'unique-legacy-alias-item')?.discoveredAt === uniqueLegacyAliasDiscovery, 'canonical 缺失时唯一 permalink/url legacy alias 可作为 discovery fallback');

  const ambiguousFallbackStartedAt = Date.now();
  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    allFeedContinuation: {
      active: true,
      id: 'ambiguous-legacy-alias-continuation',
      cursor: 'ambiguous-legacy-alias-cursor',
      retryAttempts: 0,
      retryAt: '',
      discoveredAtByAlias: {
        'permalink:https://aihot.virxact.com/items/ambiguous-legacy-alias': new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
        'url:https://example.com/ambiguous-legacy-alias': new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
      }
    }
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({
      id: 'ambiguous-legacy-alias-item',
      links: {
        original: 'https://example.com/ambiguous-legacy-alias',
        aihot: 'https://aihot.virxact.com/items/ambiguous-legacy-alias'
      }
    })]))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  assert(new Date(storageData.history.find(item => item.id === 'ambiguous-legacy-alias-item')?.discoveredAt || 0).getTime() >= ambiguousFallbackStartedAt, '多个 legacy alias 候选有歧义时不回退 discovery');

  const denseContinuationHistory = Array.from({ length: 2363 }, (_, index) => ({
    id: `dense-continuation-${index + 1}`,
    title: `续拉历史 ${index + 1}`,
    source: index === 2000 || index === 2362 ? '关注来源' : '其它来源',
    url: `https://example.com/dense-continuation-${index + 1}`,
    permalink: `https://aihot.virxact.com/items/dense-continuation-${index + 1}`,
    time: new Date(Date.now() - index * 1000).toISOString(),
    discoveredAt: new Date(Date.now() - (index + 1) * 60 * 1000).toISOString(),
    selected: false,
    ...(index === 2000 || index === 2362 ? { watchMatched: true, watchRuleIds: ['wr_dense'] } : {})
  }));
  const dense2001Discovery = denseContinuationHistory[2000].discoveredAt;
  const denseLastDiscovery = denseContinuationHistory[2362].discoveredAt;
  const denseViewedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    history: denseContinuationHistory,
    readIds: ['dense-continuation-2001', 'dense-continuation-2363'],
    watchRules: [{ id: 'wr_dense', source: '关注来源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      'dense-continuation-2001': { ruleIds: ['wr_dense'], firstMatchedAt: dense2001Discovery, lastNotifiedAt: dense2001Discovery, notifyCount: 1, nextNotifyAt: '', viewedAt: denseViewedAt },
      'dense-continuation-2363': { ruleIds: ['wr_dense'], firstMatchedAt: denseLastDiscovery, lastNotifiedAt: denseLastDiscovery, notifyCount: 2, nextNotifyAt: '', viewedAt: denseViewedAt }
    },
    allFeedContinuation: {
      active: true,
      id: 'dense-continuation-id',
      cursor: 'dense-continuation-cursor',
      retryAttempts: 0,
      retryAt: '',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }
  });
  fetchImpl = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(v1Page([v1Item({
      id: 'dense-continuation-2363',
      title: '续拉历史 2363 更新',
      source: { name: '关注来源' },
      links: {
        original: 'https://example.com/dense-continuation-2363',
        aihot: 'https://aihot.virxact.com/items/dense-continuation-2363'
      }
    })]))
  });
  await onAlarmHandler({ name: 'aihot-all-continuation' });
  const denseContinuationCompleted = await waitFor(() => storageData.allFeedContinuation?.active === false, 100);
  const dense2001 = storageData.history.find(item => item.id === 'dense-continuation-2001');
  const denseLast = storageData.history.find(item => item.id === 'dense-continuation-2363');
  assert(denseContinuationCompleted && storageData.history.length === 2363 && dense2001?.discoveredAt === dense2001Discovery && denseLast?.discoveredAt === denseLastDiscovery, '无发现索引的 worker 续拉仍保留第 2001 与 2363 条 canonical discovery');
  assert(storageData.readIds.includes('dense-continuation-2001') && storageData.readIds.includes('dense-continuation-2363') && storageData.watchNotifyState['dense-continuation-2001']?.viewedAt === denseViewedAt && storageData.watchNotifyState['dense-continuation-2363']?.viewedAt === denseViewedAt, '无发现索引的 worker 续拉仍保留第 2001 与 2363 条已读和特关状态');
  assert(!Object.prototype.hasOwnProperty.call(storageData.allFeedContinuation || {}, 'discoveredAtByAlias'), '无索引续拉完成状态保持精简');

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

  console.log('\n[popup durable mutations 由 background 串行拥有]');
  resetState({
    canonicalHistoryVersion: 1,
    readIds: Array.from({ length: 99 }, (_, index) => `bounded-${index}`),
    history: [{
      id: 'race-watch',
      url: 'https://example.com/race-watch',
      permalink: 'https://aihot.virxact.com/items/race-watch',
      title: '并发特关条目',
      source: '旧来源',
      time: new Date().toISOString(),
      discoveredAt: new Date().toISOString(),
      selected: true,
      watchMatched: true,
      watchRuleIds: ['old-rule']
    }],
    watchRules: [{ id: 'old-rule', source: '旧来源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      'race-watch': { ruleIds: ['old-rule'], firstMatchedAt: selectedReadAt, notifyCount: 1, viewedAt: '' }
    }
  });
  let releaseCanonicalPopupRace;
  let canonicalPopupRaceCommitStarted = false;
  storageSetImpl = values => {
    if (values.history && !canonicalPopupRaceCommitStarted) {
      canonicalPopupRaceCommitStarted = true;
      return new Promise(resolve => {
        releaseCanonicalPopupRace = () => {
          Object.assign(storageData, values);
          resolve();
        };
      });
    }
    Object.assign(storageData, values);
    return Promise.resolve();
  };
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('popup-race-fp');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'popup-race-new-item' })])) });
  };
  const canonicalPopupRace = sendMessage({ type: 'pollNow' });
  assert(await waitFor(() => canonicalPopupRaceCommitStarted), 'canonical poll 已进入延迟提交');
  const readRace = sendMessageWithTimeout({ type: 'markItemsRead', ids: ['race-read-key', 'https://example.com/race-read'] });
  const watchRace = sendMessageWithTimeout({ type: 'markWatchViewed', urls: ['race-watch'] });
  const nextRaceRules = [{ id: 'new-rule', source: '新来源', author: '', keywords: ['模型'], enabled: true }];
  const rulesRace = sendMessageWithTimeout({ type: 'saveWatchRules', watchRules: nextRaceRules });
  releaseCanonicalPopupRace();
  const [canonicalRaceResult, readRaceResult, watchRaceResult, rulesRaceResult] = await Promise.all([canonicalPopupRace, readRace, watchRace, rulesRace]);
  assert(canonicalRaceResult.ok === true && readRaceResult.ok === true && watchRaceResult.ok === true && rulesRaceResult.ok === true, '读、特关查看与规则消息在 canonical 写入后依次成功');
  assert(storageData.history.some(item => item.id === 'popup-race-new-item'), 'popup mutation 不覆盖 concurrent canonical history');
  assert(storageData.readIds.length === 100 && storageData.readIds.includes('race-read-key') && storageData.readIds.includes('https://example.com/race-read') && !storageData.readIds.includes('bounded-0'), 'markItemsRead 合并并按现有上限保留最近 100 个 alias');
  assert(Boolean(storageData.watchNotifyState['race-watch']?.viewedAt), 'markWatchViewed 在队列内重读并保留 canonical watch state');
  assert(storageData.watchRules.length === 1 && storageData.watchRules[0].id === 'new-rule' && storageData.history.some(item => item.id === 'race-watch'), 'saveWatchRules 不覆盖 concurrent history/read/watch state');
  storageSetImpl = null;

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

  console.log('\n[生产等价内容源切换回归]');
  const regressionPublishedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const regressionHistory = Array.from({ length: 2363 }, (_, index) => ({
    id: `source-regression-${index + 1}`,
    title: `内容源回归 ${index + 1}`,
    source: index === 2000 || index === 2362 ? '回归关注源' : '回归普通源',
    url: `https://example.com/source-regression-${index + 1}`,
    permalink: `https://aihot.virxact.com/items/source-regression-${index + 1}`,
    time: regressionPublishedAt,
    discoveredAt: new Date(Date.now() - (index + 1) * 1000).toISOString(),
    selected: index < 96,
    ...(index === 2000 || index === 2362 ? { watchMatched: true, watchRuleIds: ['source-regression-rule'] } : {})
  }));
  const regressionWatchFirstMatchedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    history: regressionHistory,
    watchRules: [{ id: 'source-regression-rule', source: '回归关注源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      'source-regression-2001': {
        ruleIds: ['source-regression-rule'],
        firstMatchedAt: regressionWatchFirstMatchedAt,
        lastNotifiedAt: regressionWatchFirstMatchedAt,
        notifyCount: 1,
        nextNotifyAt: ''
      },
      'source-regression-2363': {
        ruleIds: ['source-regression-rule'],
        firstMatchedAt: regressionWatchFirstMatchedAt,
        lastNotifiedAt: regressionWatchFirstMatchedAt,
        notifyCount: 2,
        nextNotifyAt: ''
      }
    }
  });
  const firstRegressionReadAt = new Date(Date.now() - 1000).toISOString();
  const firstRegressionRead = await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: firstRegressionReadAt });
  const selectedRegressionItems = regressionHistory.slice(0, 96).map(item => v1Item({
    id: item.id,
    title: item.title,
    selected: true,
    publishedAt: regressionPublishedAt,
    source: { name: item.source },
    links: { original: item.url, aihot: item.permalink }
  }));
  fetchImpl = url => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-source-regression-selected', 'fp-source-regression-all')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page(selectedRegressionItems)) });
  const selectedRegressionSwitch = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  const selectedRegressionProjection = projectHistory(storageData.history, 'selected');
  const secondRegressionReadAt = new Date(Date.now() - 500).toISOString();
  const secondRegressionRead = await sendMessageWithTimeout({ type: 'markAllRead', readAllBefore: secondRegressionReadAt });
  const cachedAllRegressionProjection = projectHistory(storageData.history, 'all');
  assert(firstRegressionRead.ok === true && selectedRegressionSwitch.ok === true && secondRegressionRead.ok === true, '生产等价回归中两次全部已读与 selected 切换均成功');
  assert(storageData.history.length === 2363 && selectedRegressionProjection.length === 96, 'selected 切换不收缩 2363 条 canonical history，可见投影严格为 96 条');
  assert(cachedAllRegressionProjection.length === 2363, '切回 all 发起网络请求前已可从 canonical cache 投影完整历史');

  const allRegressionItems = [
    v1Item({
      id: 'source-regression-new',
      title: '切回 all 后新身份',
      selected: false,
      publishedAt: regressionPublishedAt,
      links: {
        original: 'https://example.com/source-regression-new',
        aihot: 'https://aihot.virxact.com/items/source-regression-new'
      }
    }),
    ...regressionHistory.map(item => v1Item({
      id: item.id,
      title: item.title,
      selected: item.selected,
      publishedAt: regressionPublishedAt,
      source: { name: item.source },
      links: { original: item.url, aihot: item.permalink }
    }))
  ];
  const allRegressionPages = [];
  for (let offset = 0; offset < allRegressionItems.length; offset += 100) {
    allRegressionPages.push(allRegressionItems.slice(offset, offset + 100));
  }
  let regressionAllPageRequests = 0;
  fetchImpl = url => {
    if (url.includes('/api/public/fingerprint')) {
      return legacyFingerprintResponse('fp-source-regression-selected', 'fp-source-regression-all-final');
    }
    const parsed = new URL(url);
    const cursor = parsed.searchParams.get('cursor');
    const pageIndex = cursor ? Number(cursor.replace('source-regression-page-', '')) : 0;
    regressionAllPageRequests++;
    const hasMore = pageIndex < allRegressionPages.length - 1;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page(allRegressionPages[pageIndex], {
        hasMore,
        nextCursor: hasMore ? `source-regression-page-${pageIndex + 1}` : null
      }))
    });
  };
  const allRegressionSwitch = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  const allRegressionCompleted = await waitFor(() =>
    storageData.allFeedContinuation?.active === false && storageData.history.length === 2364,
    200
  );
  const regression2001 = storageData.history.find(item => item.id === 'source-regression-2001');
  const regression2363 = storageData.history.find(item => item.id === 'source-regression-2363');
  const regressionNew = storageData.history.find(item => item.id === 'source-regression-new');
  const readWatermark = new Date(storageData.readAllBefore || 0).getTime();
  const unreadRegressionIds = storageData.history
    .filter(item => !storageData.readIds.includes(item.id) && new Date(item.discoveredAt || item.time || 0).getTime() > readWatermark)
    .map(item => item.id);
  assert(allRegressionSwitch.ok === true && allRegressionCompleted && regressionAllPageRequests === 20, 'all 首页后按 100 条续拉到页数上限，canonical history 仍完整保留 2364 条');
  assert(regression2001?.discoveredAt === regressionHistory[2000].discoveredAt && regression2363?.discoveredAt === regressionHistory[2362].discoveredAt, '续拉保留第 2001 与 2363 条原始发现时间');
  assert(storageData.watchNotifyState['source-regression-2001']?.notifyCount === 1 && storageData.watchNotifyState['source-regression-2363']?.notifyCount === 2 && Boolean(storageData.watchNotifyState['source-regression-2001']?.viewedAt) && Boolean(storageData.watchNotifyState['source-regression-2363']?.viewedAt), '第 2001 与 2363 条的特关进度与已查看状态跨切源保留');
  assert(regressionNew && unreadRegressionIds.length === 1 && unreadRegressionIds[0] === 'source-regression-new', '只有续拉期间真正新发现的身份为未读');

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
  assert(storageData.history.find(item => item.id === 'deep-selected-item')?.discoveredAt === deepSelectedDiscoveredAt, 'all 切回 selected 时深层精选条目仍继承原发现时间');

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

  console.log('\n[标准身份 upsert 与本地状态迁移]');
  const refreshedPublishedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    apiFingerprints: { all: 'fp-old' },
    history: [
      { id: 'exact-refresh', title: '旧标题', source: '旧来源', url: collidingUrl, permalink: 'https://aihot.virxact.com/items/exact-refresh', time: originalPublishedAt, discoveredAt: exactIdDiscoveredAt, selected: true },
      { id: 'different-id', title: '碰撞条目', source: '其它来源', url: collidingUrl, permalink: 'https://aihot.virxact.com/items/different-id', time: refreshedPublishedAt, discoveredAt: collidingUrlDiscoveredAt, selected: true }
    ]
  });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-selected', 'fp-refresh')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
      id: 'exact-refresh',
      title: '新标题',
      source: { name: '新来源' },
      summary: '新摘要',
      selected: false,
      publishedAt: refreshedPublishedAt,
      links: { original: collidingUrl, aihot: 'https://aihot.virxact.com/items/exact-refresh' }
    })])) });
  const exactRefreshResponse = await sendMessage({ type: 'pollNow' });
  const exactRefreshed = storageData.history.find(item => item.id === 'exact-refresh');
  const differentId = storageData.history.find(item => item.id === 'different-id');
  assert(exactRefreshResponse.ok === true && storageData.history.length === 2 && exactRefreshed?.title === '新标题' && exactRefreshed?.source === '新来源' && exactRefreshed?.summary === '新摘要', '精确 ID 刷新 API 字段且不合并 URL 碰撞的非空 ID');
  assert(exactRefreshed?.discoveredAt === exactIdDiscoveredAt && exactRefreshed?.selected === false && differentId?.title === '碰撞条目', '精确 ID 保留最早发现时间并应用 all 响应的显式 false');
  assert(storageData.history[0]?.id === 'exact-refresh' && storageData.history[1]?.id === 'different-id', '刷新后按 getItemTime 降序排序');

  const legacyUrl = 'https://example.com/legacy-canonical';
  const legacyPermalink = 'https://aihot.virxact.com/items/legacy-canonical';
  const firstMatchedEarly = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const firstMatchedLate = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
  const viewedEarly = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const viewedLate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const notifiedEarly = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const notifiedLate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'all',
    apiFingerprints: { all: 'fp-old' },
    history: [{ id: '', title: '旧身份条目', source: '目标来源', url: legacyUrl, permalink: legacyPermalink, time: originalPublishedAt, discoveredAt: originalDiscoveredAt, selected: true }],
    readIds: [legacyUrl],
    watchRules: [{ id: 'wr_canonical', source: '目标来源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      [legacyUrl]: { ruleIds: ['wr_old'], firstMatchedAt: firstMatchedLate, viewedAt: viewedLate, notifyCount: 1, lastNotifiedAt: notifiedEarly, nextNotifyAt: '' },
      [legacyPermalink]: { ruleIds: ['wr_other'], firstMatchedAt: firstMatchedEarly, viewedAt: viewedEarly, notifyCount: 2, lastNotifiedAt: notifiedLate, nextNotifyAt: '' }
    }
  });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-selected', 'fp-legacy')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
      id: 'canonical-id',
      title: '标准身份条目',
      source: { name: '目标来源' },
      selected: true,
      links: { original: legacyUrl, aihot: legacyPermalink }
    })])) });
  await sendMessage({ type: 'pollNow' });
  const mergedWatchState = storageData.watchNotifyState['canonical-id'];
  assert(storageData.history.length === 1 && storageData.history[0]?.id === 'canonical-id' && storageData.history[0]?.discoveredAt === originalDiscoveredAt, '唯一无 ID 旧记录被标准 ID 安全吸收');
  assert(storageData.readIds.includes('canonical-id'), '旧 URL 已读别名迁移到标准 ID');
  assert(mergedWatchState?.firstMatchedAt === firstMatchedEarly && mergedWatchState?.viewedAt === viewedEarly && mergedWatchState?.notifyCount === 2 && mergedWatchState?.lastNotifiedAt === notifiedLate && mergedWatchState?.nextNotifyAt === '', '多个旧特关别名确定性合并到标准 ID');
  assert(JSON.stringify(mergedWatchState?.ruleIds) === JSON.stringify(['wr_canonical']) && !storageData.watchNotifyState[legacyUrl] && !storageData.watchNotifyState[legacyPermalink], '特关规则重算且移除已吸收的旧别名状态');

  resetState({
    feedMode: 'all',
    apiFingerprints: { all: 'fp-old' },
    history: [
      { id: '', title: '歧义1', url: legacyUrl, permalink: 'https://aihot.virxact.com/items/legacy-one', time: originalPublishedAt, discoveredAt: originalDiscoveredAt },
      { id: '', title: '歧义2', url: legacyUrl, permalink: 'https://aihot.virxact.com/items/legacy-two', time: originalPublishedAt, discoveredAt: exactIdDiscoveredAt }
    ],
    readIds: [legacyUrl],
    watchRules: [],
    watchNotifyState: {
      [legacyUrl]: { ruleIds: ['wr_ambiguous'], firstMatchedAt: firstMatchedEarly, viewedAt: viewedEarly, notifyCount: 2, lastNotifiedAt: notifiedLate, nextNotifyAt: '' }
    }
  });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-selected', 'fp-ambiguous')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({
      id: 'ambiguous-api-id',
      title: '新标准条目',
      links: { original: legacyUrl, aihot: 'https://aihot.virxact.com/items/ambiguous-api-id' }
    })])) });
  await sendMessage({ type: 'pollNow' });
  assert(storageData.history.length === 3 && storageData.history.filter(item => !item.id).length === 2 && storageData.history.some(item => item.id === 'ambiguous-api-id'), '多个无 ID 别名候选有歧义时都不吸收');
  assert(!storageData.readIds.includes('ambiguous-api-id') && !storageData.watchNotifyState['ambiguous-api-id'] && storageData.watchNotifyState[legacyUrl], '歧义无 ID 别名不迁移已读或特关状态');

  resetState({ feedMode: 'all' });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-selected', 'fp-duplicate')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([
      v1Item({ id: 'duplicate-id', title: '重复旧字段', links: { original: 'https://example.com/duplicate', aihot: 'https://aihot.virxact.com/items/duplicate-id' } }),
      v1Item({ id: 'duplicate-id', title: '重复最终字段', links: { original: 'https://example.com/duplicate', aihot: 'https://aihot.virxact.com/items/duplicate-id' } })
    ])) });
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(storageData.history.length === 1 && storageData.history[0]?.title === '重复最终字段', '同一响应的重复 ID 确定性收敛到最终 API 字段');

  resetState({
    feedMode: 'all',
    apiFingerprints: { all: 'fp-old' },
    history: [{ id: 'duplicate-existing', title: '既有精选', source: 'v1 来源', url: 'https://example.com/duplicate-existing', permalink: 'https://aihot.virxact.com/items/duplicate-existing', time: originalPublishedAt, discoveredAt: originalDiscoveredAt, selected: true }]
  });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-selected', 'fp-duplicate-existing')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([
      v1Item({ id: 'duplicate-existing', title: '中间显式降级', selected: false, links: { original: 'https://example.com/duplicate-existing', aihot: 'https://aihot.virxact.com/items/duplicate-existing' } }),
      v1Item({ id: 'duplicate-existing', title: '最终字段缺失', links: { original: 'https://example.com/duplicate-existing', aihot: 'https://aihot.virxact.com/items/duplicate-existing' } })
    ])) });
  await sendMessage({ type: 'pollNow' });
  const duplicateExisting = storageData.history.find(item => item.id === 'duplicate-existing');
  assert(duplicateExisting?.title === '最终字段缺失' && duplicateExisting?.selected === true, '重复既有 ID 只用最终行相对原始 membership 计算一次');

  resetState({ feedMode: 'selected' });
  fetchImpl = () => Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([
    v1Item({ id: 'install-selected', selected: false })
  ])) });
  await onInstalledHandler({ reason: 'install' });
  assert(storageData.history.find(item => item.id === 'install-selected')?.selected === true, '安装初次 selected 抓取也强制标准成员资格');

  resetState({
    feedMode: 'all',
    apiFingerprints: { all: 'fp-old' },
    history: [{ id: 'membership-item', title: '精选条目', source: 'v1 来源', url: 'https://example.com/membership', permalink: 'https://aihot.virxact.com/items/membership-item', time: originalPublishedAt, discoveredAt: originalDiscoveredAt, selected: true }]
  });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-selected', 'fp-missing-membership')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'membership-item', links: { original: 'https://example.com/membership', aihot: 'https://aihot.virxact.com/items/membership-item' } })])) });
  await sendMessage({ type: 'pollNow' });
  assert(storageData.history.find(item => item.id === 'membership-item')?.selected === true, 'all 响应缺少 selected 字段时保留原精选成员资格');
  storageData.feedMode = 'selected';
  storageData.apiFingerprints = { selected: 'fp-old' };
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-force-selected', 'fp-all')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'membership-item', selected: false, links: { original: 'https://example.com/membership', aihot: 'https://aihot.virxact.com/items/membership-item' } })])) });
  await sendMessage({ type: 'pollNow' });
  assert(storageData.history.find(item => item.id === 'membership-item')?.selected === true && !Object.prototype.hasOwnProperty.call(storageData.history.find(item => item.id === 'membership-item'), 'selectedPresent'), 'selected 响应强制成员资格且不持久化瞬时字段');

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
  const continuedKnownPersisted = await waitFor(() => Boolean(storageData.history.find(item => item.id === 'shared-on-continuation')?.watchMatchedAt), 100);
  const sharedOnContinuation = storageData.history.find(item => item.id === 'shared-on-continuation');
  assert(continuedKnownPersisted && sharedOnContinuation?.discoveredAt === continuedOriginalDiscoveredAt, 'all 后台续拉再次遇到同一条目时也保留原发现时间');
  assert(new Date(sharedOnContinuation?.watchMatchedAt || 0) > new Date(globalReadAt) && !storageData.watchNotifyState['shared-on-continuation'], '后来新增的特关规则记录本次匹配时间，但不为已保留条目新建提醒状态');

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

  console.log('\n[内容源 latest-wins 并发提交]');
  const latestWinsHistory = Array.from({ length: 2363 }, (_, index) => ({
    id: `latest-wins-${index + 1}`,
    url: `https://example.com/latest-wins-${index + 1}`,
    permalink: `https://aihot.virxact.com/items/latest-wins-${index + 1}`,
    time: new Date(Date.now() - index * 1000).toISOString(),
    discoveredAt: new Date(Date.now() - index * 60 * 1000).toISOString(),
    selected: index < 96
  }));
  resetState({ feedMode: 'all', history: latestWinsHistory, canonicalHistoryVersion: 1 });
  let releaseOlderAll;
  let olderAllStarted = false;
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-latest-selected', 'fp-latest-all');
    const mode = new URL(url).searchParams.get('mode');
    if (mode === 'all') {
      olderAllStarted = true;
      return new Promise(resolve => {
        releaseOlderAll = () => resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'stale-older-all' })])) });
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'latest-selected-result' })])) });
  };
  let olderAllResult;
  let latestSelectedResult;
  const olderAllSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'all' }).then(result => { olderAllResult = result; return result; });
  assert(await waitFor(() => olderAllStarted), '较旧 all 内容源请求已开始且网络悬挂');
  const latestSelectedSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' }).then(result => { latestSelectedResult = result; return result; });
  const latestSelectedFinishedFirst = await waitFor(() => Boolean(latestSelectedResult), 100);
  assert(latestSelectedFinishedFirst && latestSelectedResult.ok === true && storageData.feedMode === 'selected', '后发 selected 不等待较旧 all 网络请求即可提交');
  assert(storageData.history.length === 2364 && storageData.history.some(item => item.id === 'latest-wins-2363') && storageData.history.find(item => item.id === 'latest-wins-1')?.selected === true, 'selected 切换保留 2363 条 canonical history 且不按缺席降级 membership');
  releaseOlderAll();
  await Promise.all([olderAllSwitch, latestSelectedSwitch]);
  assert(olderAllResult.ok === false && olderAllResult.stale === true && storageData.feedMode === 'selected' && !storageData.history.some(item => item.id === 'stale-older-all'), '较旧 all 响应后到时明确返回 stale，不能误报 durable success');

  resetState({ feedMode: 'selected', canonicalHistoryVersion: 1 });
  let releaseDelayedAllCommit;
  let delayedAllCommitStarted = false;
  storageSetImpl = values => {
    if (values.feedMode === 'all' && !delayedAllCommitStarted) {
      delayedAllCommitStarted = true;
      return new Promise(resolve => {
        releaseDelayedAllCommit = () => {
          Object.assign(storageData, values);
          resolve();
        };
      });
    }
    Object.assign(storageData, values);
    return Promise.resolve();
  };
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-delayed-selected', 'fp-delayed-all');
    const mode = new URL(url).searchParams.get('mode');
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: `${mode}-delayed-commit-item` })])) });
  };
  let delayedAllResult;
  let delayedSelectedResult;
  const delayedAllSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'all' }).then(result => { delayedAllResult = result; return result; });
  assert(await waitFor(() => delayedAllCommitStarted), '较旧 all 已进入延迟的最终 storage 提交');
  const delayedSelectedSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' }).then(result => { delayedSelectedResult = result; return result; });
  releaseDelayedAllCommit();
  await Promise.all([delayedAllSwitch, delayedSelectedSwitch]);
  assert(delayedAllResult.ok === false && delayedAllResult.stale === true && delayedSelectedResult.ok === true && storageData.feedMode === 'selected' && storageData.history.some(item => item.id === 'selected-delayed-commit-item'), '最终 storage await 期间出现更新切源意图时旧提交返回 stale，最终 durable 状态属于最新意图');

  const authoritativeBeforeStaleCommit = {
    feedMode: 'selected',
    history: [{
      id: 'authoritative-before-stale-commit',
      url: 'https://example.com/authoritative-before-stale-commit',
      time: new Date().toISOString(),
      discoveredAt: new Date().toISOString(),
      selected: true
    }],
    allFeedContinuation: { active: false }
  };
  resetState({ canonicalHistoryVersion: 1, ...authoritativeBeforeStaleCommit });
  let releaseStaleAllCommit;
  let staleAllCommitStarted = false;
  let failingSelectedFetchStarted = false;
  storageSetImpl = values => {
    if (values.feedMode === 'all' && !staleAllCommitStarted) {
      staleAllCommitStarted = true;
      return new Promise(resolve => {
        releaseStaleAllCommit = () => {
          Object.assign(storageData, values);
          resolve();
        };
      });
    }
    Object.assign(storageData, values);
    return Promise.resolve();
  };
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-failing-selected', 'fp-stale-all');
    const mode = new URL(url).searchParams.get('mode');
    if (mode === 'selected') {
      failingSelectedFetchStarted = true;
      return Promise.resolve({ ok: false, status: 503, headers: { get: () => '' } });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'must-rollback-stale-all' })], { hasMore: true, nextCursor: 'must-not-survive-stale-cursor' }))
    });
  };
  const staleAllSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(await waitFor(() => staleAllCommitStarted), '旧 all 已进入延迟的最终 storage 提交');
  const failingSelectedSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(await waitFor(() => failingSelectedFetchStarted), '新 selected 意图在旧 all storage await 期间到达且网络失败');
  releaseStaleAllCommit();
  const [staleAllResponse, failingSelectedResponse] = await Promise.all([staleAllSwitch, failingSelectedSwitch]);
  assert(
    staleAllResponse.ok === false && staleAllResponse.stale === true &&
      failingSelectedResponse.ok === false && !failingSelectedResponse.stale &&
      storageData.feedMode === authoritativeBeforeStaleCommit.feedMode &&
      JSON.stringify(storageData.history) === JSON.stringify(authoritativeBeforeStaleCommit.history) &&
      JSON.stringify(storageData.allFeedContinuation) === JSON.stringify(authoritativeBeforeStaleCommit.allFeedContinuation) &&
      !activeAlarmNames.has('aihot-all-continuation'),
    '旧 all 写入变 stale 且新 selected 拉取失败时补偿恢复写入前权威快照，不遗留 continuation 或 alarm'
  );

  const authoritativeBeforeCompensationRetry = {
    feedMode: 'selected',
    history: [{
      id: 'authoritative-before-compensation-retry',
      url: 'https://example.com/authoritative-before-compensation-retry',
      time: new Date().toISOString(),
      discoveredAt: new Date().toISOString(),
      selected: true
    }],
    allFeedContinuation: { active: false }
  };
  resetState({ canonicalHistoryVersion: 1, ...authoritativeBeforeCompensationRetry });
  let releaseRetryingStaleCommit;
  let retryingStaleCommitStarted = false;
  let compensationAttempts = 0;
  storageSetImpl = values => {
    if (values.feedMode === 'all' && !retryingStaleCommitStarted) {
      retryingStaleCommitStarted = true;
      return new Promise(resolve => {
        releaseRetryingStaleCommit = () => {
          Object.assign(storageData, values);
          resolve();
        };
      });
    }
    if (values.feedMode === 'selected' && values.history?.[0]?.id === 'authoritative-before-compensation-retry') {
      compensationAttempts++;
      if (compensationAttempts === 1) return Promise.reject(new Error('mock transient compensation failure'));
    }
    Object.assign(storageData, values);
    return Promise.resolve();
  };
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-retry-failing-selected', 'fp-retrying-stale-all');
    const mode = new URL(url).searchParams.get('mode');
    if (mode === 'selected') return Promise.resolve({ ok: false, status: 503, headers: { get: () => '' } });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: 'must-rollback-after-compensation-retry' })], { hasMore: true, nextCursor: 'retrying-stale-cursor' }))
    });
  };
  const retryingStaleSwitch = sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(await waitFor(() => retryingStaleCommitStarted), '旧 all 已进入需要补偿重试的延迟提交');
  const failingSelectedDuringRetry = sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  releaseRetryingStaleCommit();
  const [retryingStaleResponse, failingSelectedDuringRetryResponse] = await Promise.all([retryingStaleSwitch, failingSelectedDuringRetry]);
  assert(
    retryingStaleResponse.ok === false && retryingStaleResponse.stale === true &&
      failingSelectedDuringRetryResponse.ok === false && compensationAttempts === 2 &&
      storageData.feedMode === authoritativeBeforeCompensationRetry.feedMode &&
      JSON.stringify(storageData.history) === JSON.stringify(authoritativeBeforeCompensationRetry.history) &&
      JSON.stringify(storageData.allFeedContinuation) === JSON.stringify(authoritativeBeforeCompensationRetry.allFeedContinuation) &&
      !activeAlarmNames.has('aihot-all-continuation'),
    'stale source-switch 补偿写瞬时失败时在串行边界内重试并恢复权威快照'
  );

  for (const postCommitFailure of ['alarm-clear', 'badge']) {
    resetState({ feedMode: 'selected', canonicalHistoryVersion: 1 });
    let postCommitCursorStarted = false;
    if (postCommitFailure === 'alarm-clear') {
      alarmClearImpl = name => name === 'aihot-all-continuation'
        ? Promise.reject(new Error('mock post-commit alarm clear failed'))
        : Promise.resolve();
    } else {
      badgeTextImpl = () => Promise.reject(new Error('mock post-commit badge failed'));
    }
    fetchImpl = (url) => {
      if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-post-commit-selected', `fp-post-commit-${postCommitFailure}`);
      const cursor = new URL(url).searchParams.get('cursor');
      if (cursor === `post-commit-${postCommitFailure}-cursor`) {
        postCommitCursorStarted = true;
        return new Promise(() => {});
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(v1Page([v1Item({ id: `post-commit-${postCommitFailure}-first` })], {
          hasMore: true,
          nextCursor: `post-commit-${postCommitFailure}-cursor`
        }))
      });
    };
    const postCommitResult = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
    const postCommitContinuationStarted = await waitFor(() => postCommitCursorStarted, 100);
    assert(postCommitResult.ok === true && storageData.feedMode === 'all' && storageData.allFeedContinuation?.active === true && postCommitContinuationStarted && alarmCreateCalls.some(call => call.name === 'aihot-all-continuation'), `切源 durable 提交后 ${postCommitFailure} 失败仍报告成功并启动 alarm-backed continuation`);
  }

  console.log('\n[selected authoritative snapshot membership]');
  const selectedSnapshotHistory = () => [{
    id: 'snapshot-present',
    url: 'https://example.com/snapshot-present',
    permalink: 'https://aihot.virxact.com/items/snapshot-present',
    time: new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    selected: true
  }, {
    id: 'snapshot-absent',
    url: 'https://example.com/snapshot-absent',
    permalink: 'https://aihot.virxact.com/items/snapshot-absent',
    time: new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    selected: true
  }];
  resetState({ feedMode: 'all', canonicalHistoryVersion: 1, history: selectedSnapshotHistory() });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-authoritative-selected', 'fp-all')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'snapshot-present' })])) });
  const authoritativeSelectedResult = await backgroundApi.resetAndPollForTest('selected', { supportsConsistentSelectedSnapshot: true });
  assert(authoritativeSelectedResult?.stale === false && storageData.history.find(item => item.id === 'snapshot-absent')?.selected === false, 'Node-only capability 注入时 authoritative complete selected 快照通过真实 upsert 路径按缺席降级');

  resetState({ feedMode: 'all', canonicalHistoryVersion: 1, history: selectedSnapshotHistory() });
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-skipped-selected', 'fp-all')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'snapshot-present' }), {}])) });
  const skippedSelectedResult = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(skippedSelectedResult.ok === true && storageData.history.find(item => item.id === 'snapshot-absent')?.selected === true, '包含跳过无效项的 selected 快照不按缺席降级');

  const invalidSelectedCases = [{
    name: 'missing cursor',
    fetch: (url) => url.includes('/api/public/fingerprint')
      ? legacyFingerprintResponse('fp-missing-cursor', 'fp-all')
      : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'snapshot-present' })], { hasMore: true, nextCursor: null })) })
  }, {
    name: 'invalid cursor',
    fetch: (url) => url.includes('/api/public/fingerprint')
      ? legacyFingerprintResponse('fp-invalid-cursor', 'fp-all')
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [v1Item({ id: 'snapshot-present' })], page: { hasMore: true, nextCursor: 42 } }) })
  }, {
    name: 'repeated cursor',
    fetch: (url) => url.includes('/api/public/fingerprint')
      ? legacyFingerprintResponse('fp-repeated-cursor', 'fp-all')
      : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'snapshot-present' })], { hasMore: true, nextCursor: 'same-selected-cursor' })) })
  }, {
    name: 'malformed container',
    fetch: (url) => url.includes('/api/public/fingerprint')
      ? legacyFingerprintResponse('fp-malformed-selected', 'fp-all')
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ items: null, page: { hasMore: false, nextCursor: null } }) })
  }, {
    name: 'rejected page',
    fetch: (url) => url.includes('/api/public/fingerprint')
      ? legacyFingerprintResponse('fp-rejected-selected', 'fp-all')
      : Promise.resolve({ ok: false, status: 500, headers: { get: () => '' } })
  }];
  for (const invalidSelectedCase of invalidSelectedCases) {
    resetState({ feedMode: 'all', canonicalHistoryVersion: 1, history: selectedSnapshotHistory() });
    fetchImpl = invalidSelectedCase.fetch;
    const invalidSelectedResult = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
    assert(invalidSelectedResult.ok === false && storageData.feedMode === 'all' && storageData.history.find(item => item.id === 'snapshot-absent')?.selected === true, `${invalidSelectedCase.name} selected source-switch 失败且不按缺席降级`);
  }

  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    history: [{ id: 'selected-before-truncation', url: 'https://example.com/selected-before-truncation', time: new Date().toISOString(), discoveredAt: new Date().toISOString(), selected: true }]
  });
  let selectedTruncatedPage = 0;
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return legacyFingerprintResponse('fp-selected-truncated', 'fp-all');
    selectedTruncatedPage++;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(v1Page([v1Item({ id: `selected-truncated-${selectedTruncatedPage}` })], { hasMore: true, nextCursor: `selected-truncated-cursor-${selectedTruncatedPage}` }))
    });
  };
  const selectedTruncatedResult = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(selectedTruncatedResult.ok === true && selectedTruncatedPage === 3 && storageData.feedMode === 'selected', 'selected 达到页数上限时仍成功提交返回项');
  assert(storageData.history.find(item => item.id === 'selected-before-truncation')?.selected === true && !storageData.lastItemsPollAt, 'selected 截断快照不按缺席降级且不标记完整 items poll');
  const preservedSwitchHistory = [{ id: 'preserved-storage-failure', url: 'https://example.com/preserved-storage-failure', time: new Date().toISOString(), discoveredAt: new Date().toISOString() }];
  resetState({
    feedMode: 'all',
    canonicalHistoryVersion: 1,
    history: preservedSwitchHistory,
    allFeedContinuation: { active: true, id: 'preserved-storage-continuation', cursor: 'preserved-storage-cursor', retryAttempts: 0, retryAt: '' }
  });
  await chrome.alarms.create('aihot-all-continuation', { when: Date.now() + 60 * 1000 });
  alarmClearCalls = [];
  failSetWhen = values => values.feedMode === 'selected';
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? legacyFingerprintResponse('fp-storage-failure', 'fp-all')
    : Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([v1Item({ id: 'must-not-commit-storage-failure' })])) });
  const storageFailureSwitch = await sendMessage({ type: 'feedModeChanged', feedMode: 'selected' });
  assert(storageFailureSwitch.ok === false && storageData.feedMode === 'all' && storageData.history === preservedSwitchHistory, '切源最终 storage 提交失败时保留原 mode 与 canonical history');
  assert(storageData.allFeedContinuation?.id === 'preserved-storage-continuation' && storageData.allFeedContinuation?.active === true && activeAlarmNames.has('aihot-all-continuation') && !alarmClearCalls.includes('aihot-all-continuation'), '切源 storage 失败时已建立的 continuation alarm 继续有效');

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
  assert(storageData.watchNotifyState['v1-retained'] && !storageData.watchNotifyState['https://example.com/v1-retained'] && !storageData.watchNotifyState['https://aihot.virxact.com/items/v1-retained'], '合并已有条目后特关状态收敛到标准 ID');
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
