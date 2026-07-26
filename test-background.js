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
let storageData = {};
let fetchImpl = null;
let requestedUrls = [];
let openedTabs = [];
let notificationCreateIds = [];
let failSetWhen = null;
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
  failSetWhen = null;
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
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  tabs: { create: (options) => { openedTabs.push(options.url); } },
  alarms: {
    create: () => {},
    clear: () => alarmClearImpl ? alarmClearImpl() : Promise.resolve(),
    onAlarm: { addListener: (handler) => { onAlarmHandler = handler; } }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (handler) => { onMessageHandler = handler; } }
  }
};

globalThis.fetch = (...args) => fetchImpl(...args);

require('./background.js');

function sendMessage(message) {
  return new Promise(resolve => onMessageHandler(message, {}, resolve));
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
