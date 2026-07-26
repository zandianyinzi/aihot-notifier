/**
 * 直接加载 background.js，验证 runtime message 到真实后台逻辑的关键路径。
 * 运行: node test-background.js
 */

let passed = 0;
let failed = 0;
let onMessageHandler = null;
let onClickedHandler = null;
let onAlarmHandler = null;
let storageData = {};
let badgeText = null;
let openedTabs = [];
let fetchImpl = null;
let requestedUrls = [];
let notificationCreateIds = [];
let failSetWhen = null;
globalThis.__AIHOT_TEST_PAGE_DELAY_MS = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function resetState(overrides = {}) {
  storageData = {
    enabled: true,
    interval: 5,
    lastCheck: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    feedMode: 'selected',
    history: [{ title: '旧内容', url: 'https://example.com/old', time: new Date().toISOString() }],
    historyDays: 1,
    readIds: [],
    readAllBefore: '',
    readAllBeforeByMode: {},
    failCount: 0,
    ...overrides
  };
  badgeText = null;
  openedTabs = [];
  requestedUrls = [];
  notificationCreateIds = [];
  failSetWhen = null;
}

globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach(k => { if (k in storageData) result[k] = storageData[k]; });
          return Promise.resolve(result);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: storageData[keys] });
        }
        return Promise.resolve(storageData);
      },
      set: (obj) => {
        if (failSetWhen && failSetWhen(obj)) {
          return Promise.reject(new Error('mock storage set failed'));
        }
        Object.assign(storageData, obj);
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  notifications: {
    create: (id) => {
      notificationCreateIds.push(id);
      return Promise.resolve(id);
    },
    onClicked: { addListener: (fn) => { onClickedHandler = fn; } },
    onClosed: { addListener: () => {} }
  },
  action: {
    setBadgeText: (opts) => { badgeText = opts.text; },
    setBadgeBackgroundColor: () => {}
  },
  tabs: {
    create: (opts) => { openedTabs.push(opts.url); }
  },
  alarms: {
    create: () => {},
    clear: () => Promise.resolve(),
    onAlarm: { addListener: (fn) => { onAlarmHandler = fn; } }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (fn) => { onMessageHandler = fn; } }
  }
};

globalThis.fetch = (...args) => fetchImpl(...args);

require('./background.js');

function sendMessage(msg) {
  return new Promise((resolve) => {
    onMessageHandler(msg, {}, resolve);
  });
}

async function runTests() {
  console.log('\n[默认内容源]');
  resetState({ feedMode: undefined });
  let requestedUrl = '';
  fetchImpl = (url) => {
    requestedUrl = url;
    requestedUrls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  const defaultPollResponse = await sendMessage({ type: 'pollNow' });

  assert(defaultPollResponse.ok === true, '未设置内容源时手动刷新成功');
  assert(requestedUrl.includes('mode=selected'), '未设置内容源时默认请求精选');

  console.log('\n[pollNow-fingerprint未变化跳过items]');
  resetState({
    feedMode: 'all',
    apiFingerprints: { all: 'fp-all-old' },
    apiFingerprintEtags: { current: 'W/"fp-etag"' },
    lastItemsPollAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fp-etag"' },
        json: () => Promise.resolve({ selected: 'fp-selected', all: 'fp-all-old' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ title: '不应手动拉取', url: 'https://example.com/manual-skip', publishedAt: new Date().toISOString() }], hasNext: false }) });
  };

  const manualSkipResponse = await sendMessage({ type: 'pollNow' });

  assert(manualSkipResponse.ok === true, '手动刷新指纹未变化返回成功');
  assert(requestedUrls.length === 1 && requestedUrls[0].includes('/api/public/fingerprint'), '手动刷新指纹未变化时只请求fingerprint');
  assert(storageData.history.length === 1 && storageData.history[0].url === 'https://example.com/old', '手动刷新指纹未变化时不改写history');

  console.log('\n[pollNow-fingerprint变化后统一最多3页并用6h回退]');
  const manualLastItemsPollAt = '2026-07-07T12:00:00.000Z';
  resetState({
    feedMode: 'all',
    lastCheck: '2026-07-07T17:50:00.000Z',
    apiFingerprints: { all: 'fp-all-old' },
    lastItemsPollAt: manualLastItemsPollAt,
    history: []
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fp-manual-new"' },
        json: () => Promise.resolve({ selected: 'fp-selected', all: 'fp-all-new' })
      });
    }
    const cursor = new URL(url).searchParams.get('cursor');
    const page = cursor ? Number(cursor.replace('page-', '')) : 1;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [{ id: `manual-page-${page}`, title: `手动第${page}页`, url: `https://example.com/manual-page-${page}`, publishedAt: new Date(Date.now() - page * 1000).toISOString() }],
        hasNext: true,
        nextCursor: `page-${page + 1}`
      })
    });
  };

  const manualPagedResponse = await sendMessage({ type: 'pollNow' });
  const manualItemsUrls = requestedUrls.filter(url => url.includes('/api/public/items'));
  const manualSince = new URL(manualItemsUrls[0]).searchParams.get('since');

  assert(manualPagedResponse.ok === true, '手动刷新指纹变化后返回成功');
  assert(manualItemsUrls.length === 3, '手动刷新 selected/all 统一最多拉3页');
  assert(manualSince === '2026-07-07T06:00:00.000Z', '手动刷新since基于lastItemsPollAt回退6小时');
  assert(storageData.history.length === 3, '手动刷新截断时已拉到内容仍写入history');
  assert(storageData.apiFingerprints.all === 'fp-all-old', '手动刷新截断时不提交新fingerprint');
  assert(storageData.lastItemsPollAt === manualLastItemsPollAt, '手动刷新截断时不推进lastItemsPollAt');

  console.log('\n[自动轮询回退窗口]');
  const lastCheck = '2026-07-07T12:00:00.000Z';
  resetState({ interval: 5, lastCheck });
  requestedUrl = '';
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrl = url;
    requestedUrls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  const since = new URL(requestedUrl).searchParams.get('since');
  assert(since === '2026-07-07T06:00:00.000Z', '自动轮询至少回退6小时，覆盖公开API延迟');

  console.log('\n[自动轮询-fingerprint未变化跳过items]');
  const recentItemsPollAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'selected',
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: recentItemsPollAt
  });
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-test"' },
        json: () => Promise.resolve({ selected: 'fp-old', all: 'fp-all' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ title: '不应拉取', url: 'https://example.com/skip', publishedAt: new Date().toISOString() }], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(requestedUrls.length === 1 && requestedUrls[0].includes('/api/public/fingerprint'), '自动轮询指纹未变化时只请求fingerprint');
  assert(storageData.history.length === 1 && storageData.history[0].url === 'https://example.com/old', '指纹未变化时不改写history');
  assert(storageData.lastItemsPollAt === recentItemsPollAt, '跳过items时不更新lastItemsPollAt');

  console.log('\n[自动轮询-fingerprint变化后拉items]');
  resetState({
    feedMode: 'selected',
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: new Date().toISOString(),
    history: []
  });
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-new"' },
        json: () => Promise.resolve({ selected: 'fp-new', all: 'fp-all' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ title: '新指纹内容', url: 'https://example.com/fp-new', publishedAt: new Date().toISOString() }], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(requestedUrls.some(url => url.includes('/api/public/fingerprint')), '自动轮询先请求fingerprint');
  assert(requestedUrls.some(url => url.includes('/api/public/items')), '指纹变化后请求items');
  assert(storageData.apiFingerprints.selected === 'fp-new', '保存新的selected fingerprint');
  assert(storageData.history.some(i => i.url === 'https://example.com/fp-new'), '指纹变化后新条目进入history');

  console.log('\n[自动轮询-fingerprint变化后since仍基于lastItemsPollAt]');
  const previousItemsPollAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const advancedLastCheck = new Date().toISOString();
  resetState({
    feedMode: 'selected',
    lastCheck: advancedLastCheck,
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: previousItemsPollAt,
    history: []
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-newer"' },
        json: () => Promise.resolve({ selected: 'fp-newer', all: 'fp-all' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  const changedItemsUrl = requestedUrls.find(url => url.includes('/api/public/items'));
  const changedSince = new URL(changedItemsUrl).searchParams.get('since');
  const expectedChangedSince = new Date(new Date(previousItemsPollAt).getTime() - 6 * 60 * 60 * 1000).toISOString();
  assert(changedSince === expectedChangedSince, '指纹变化后的items since基于lastItemsPollAt而不是lastCheck');

  console.log('\n[自动轮询-fingerprint未变化但兜底到期拉items]');
  resetState({
    feedMode: 'selected',
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    history: []
  });
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-test"' },
        json: () => Promise.resolve({ selected: 'fp-old', all: 'fp-all' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ title: '兜底内容', url: 'https://example.com/safety', publishedAt: new Date().toISOString() }], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(requestedUrls.some(url => url.includes('/api/public/fingerprint')), '兜底轮询仍先请求fingerprint');
  assert(requestedUrls.some(url => url.includes('/api/public/items')), '兜底到期时即使指纹未变也请求items');
  assert(storageData.lastItemsPollAt, '兜底拉取后记录lastItemsPollAt');

  console.log('\n[自动轮询-兜底since基于上次items拉取]');
  const oldItemsPollAt = '2026-07-07T12:00:00.000Z';
  resetState({
    feedMode: 'selected',
    lastCheck: '2026-07-07T17:50:00.000Z',
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: oldItemsPollAt,
    history: []
  });
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-test"' },
        json: () => Promise.resolve({ selected: 'fp-old', all: 'fp-all' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  const safetyItemsUrl = requestedUrls.find(url => url.includes('/api/public/items'));
  const safetySince = new URL(safetyItemsUrl).searchParams.get('since');
  assert(safetySince === '2026-07-07T06:00:00.000Z', '兜底拉取since基于lastItemsPollAt回退6小时');

  console.log('\n[自动轮询-fingerprint 304但缺当前mode指纹时拉items]');
  resetState({
    feedMode: 'all',
    apiFingerprints: { selected: 'fp-selected' },
    apiFingerprintEtags: { current: 'W/"fingerprint-old"' },
    lastItemsPollAt: new Date().toISOString(),
    history: []
  });
  requestedUrls = [];
  fetchImpl = (url, options) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({ ok: true, status: 304, headers: { get: () => 'W/"fingerprint-old"' } });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ title: '304兜底', url: 'https://example.com/304', publishedAt: new Date().toISOString() }], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(requestedUrls.some(url => url.includes('/api/public/items')), '304但缺all指纹时保守请求items');
  assert(storageData.history.some(i => i.url === 'https://example.com/304'), '304缺mode指纹后拉取内容进入history');

  console.log('\n[自动轮询-缺当前mode指纹不发送条件ETag]');
  resetState({
    feedMode: 'all',
    apiFingerprints: { selected: 'fp-selected' },
    apiFingerprintEtags: { current: 'W/"fingerprint-old"' },
    lastItemsPollAt: new Date().toISOString(),
    history: []
  });
  let fingerprintOptions = null;
  fetchImpl = (url, options) => {
    if (url.includes('/api/public/fingerprint')) {
      fingerprintOptions = options || {};
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-new"' },
        json: () => Promise.resolve({ selected: 'fp-selected', all: 'fp-all' })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(!fingerprintOptions.headers || !fingerprintOptions.headers['If-None-Match'], '缺当前mode指纹时fingerprint请求不带If-None-Match');

  console.log('\n[自动轮询-分页截断不提交fingerprint和lastItemsPollAt]');
  const oldLastItemsPollAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'selected',
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: oldLastItemsPollAt,
    history: []
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-truncated"' },
        json: () => Promise.resolve({ selected: 'fp-truncated', all: 'fp-all' })
      });
    }
    const cursor = new URL(url).searchParams.get('cursor');
    const page = cursor ? Number(cursor.replace('page-', '')) : 1;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [{ id: `trunc-${page}`, title: `截断${page}`, url: `https://example.com/trunc-${page}`, publishedAt: new Date().toISOString() }],
        hasNext: true,
        nextCursor: `page-${page + 1}`
      })
    });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(requestedUrls.filter(url => url.includes('/api/public/items')).length === 3, 'selected模式达到3页上限后停止');
  assert(storageData.history.length === 3, '截断时已拉到的内容仍写入history');
  assert(storageData.apiFingerprints.selected === 'fp-old', '截断时不提交新fingerprint');
  assert(storageData.lastItemsPollAt === oldLastItemsPollAt, '截断时不提交lastItemsPollAt');

  console.log('\n[自动轮询-history写入失败不提交fingerprint]');
  const beforeFailedItemsPollAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'selected',
    apiFingerprints: { selected: 'fp-old' },
    lastItemsPollAt: beforeFailedItemsPollAt,
    history: []
  });
  failSetWhen = (obj) => Object.prototype.hasOwnProperty.call(obj, 'history');
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fingerprint-after-fail"' },
        json: () => Promise.resolve({ selected: 'fp-after-fail', all: 'fp-all' })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items: [{ title: '写入失败内容', url: 'https://example.com/storage-fail', publishedAt: new Date().toISOString() }], hasNext: false })
    });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(storageData.apiFingerprints.selected === 'fp-old', 'history写入失败时不保存新fingerprint');
  assert(storageData.lastItemsPollAt === beforeFailedItemsPollAt, 'history写入失败时不推进lastItemsPollAt');
  failSetWhen = null;

  console.log('\n[自动轮询-500也设置退避]');
  resetState({ feedMode: 'selected' });
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/public/fingerprint')) return Promise.resolve({ ok: false, status: 500 });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(storageData.failCount === 1, '500失败递增failCount');
  assert(new Date(storageData.nextAllowedPollAt || 0).getTime() > Date.now(), '500失败设置nextAllowedPollAt退避');

  console.log('\n[pollNow-退避期间不绕过API冷却]');
  resetState({
    nextAllowedPollAt: new Date(Date.now() + 60 * 1000).toISOString(),
    failCount: 2
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  const backoffManualResponse = await sendMessage({ type: 'pollNow' });

  assert(backoffManualResponse.ok === false, '退避期间手动刷新返回失败提示');
  assert(requestedUrls.length === 0, '退避期间手动刷新不请求API');
  assert(storageData.failCount === 2, '退避期间手动刷新不额外递增failCount');

  console.log('\n[pollNow-空结果也清理失败状态]');
  resetState({
    failCount: 2,
    nextAllowedPollAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lastItemsPollAt: ''
  });
  fetchImpl = (url) => {
    requestedUrls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], hasNext: false }) });
  };

  const emptyManualResponse = await sendMessage({ type: 'pollNow' });

  assert(emptyManualResponse.ok === true, '手动刷新空结果仍返回成功');
  assert(storageData.failCount === 0 && storageData.nextAllowedPollAt === '', '手动刷新空结果清理失败与退避状态');
  assert(storageData.lastItemsPollAt, '手动刷新空结果也记录lastItemsPollAt');

  console.log('\n[feedModeChanged失败]');
  resetState();
  const oldHistory = storageData.history;
  fetchImpl = () => Promise.resolve({ ok: false, status: 500 });

  const failedResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });

  assert(failedResponse.ok === false, '失败时返回 ok=false');
  assert(storageData.history === oldHistory, '失败时不覆盖旧 history');
  assert(storageData.feedMode === 'selected', '失败时不提交新 feedMode');
  assert(storageData.failCount === 1, '失败时递增 failCount');

  console.log('\n[feedModeChanged成功]');
  resetState();
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [
        {
          title: '新内容',
          url: 'https://example.com/new',
          source: 'Test',
          category: 'industry',
          summary: 'summary',
          publishedAt: new Date().toISOString()
        }
      ],
      hasNext: false
    })
  });

  const successResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });

  assert(successResponse.ok === true, '成功时返回 ok=true');
  assert(storageData.feedMode === 'all', '成功后提交新 feedMode');
  assert(storageData.history.length === 1 && storageData.history[0].title === '新内容', '成功后重建 history');
  assert(storageData.failCount === 0, '成功后清空 failCount');

  console.log('\n[feedModeChanged-all模式分页超过3页]');
  resetState({ historyDays: 5 });
  requestedUrls = [];
  fetchImpl = (url) => {
    requestedUrls.push(url);
    const cursor = new URL(url).searchParams.get('cursor');
    const page = cursor ? Number(cursor.replace('page-', '')) : 1;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [{
          id: `id-${page}`,
          title: `第${page}页`,
          url: `https://example.com/page-${page}`,
          permalink: `https://aihot.virxact.com/items/id-${page}`,
          score: 80 - page,
          selected: page === 1,
          source: 'Test',
          category: 'industry',
          summary: 'summary',
          publishedAt: new Date(Date.now() - page * 60 * 1000).toISOString()
        }],
        hasNext: page < 5,
        nextCursor: `page-${page + 1}`
      })
    });
  };

  const allPagedResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });

  assert(allPagedResponse.ok === true, 'all模式多页刷新成功');
  assert(requestedUrls.filter(url => url.includes('/api/public/items')).length === 5, 'all模式不再限制为最多3页');
  assert(storageData.history.length === 5, 'all模式保存超过3页的结果');
  assert(storageData.history[0].id === 'id-1' && storageData.history[0].permalink.includes('/items/id-1'), 'history保留id和permalink字段');
  assert(storageData.history[0].score === 79 && storageData.history[0].selected === true, 'history保留score和selected字段');

  console.log('\n[pollNow-本轮分页内部去重]');
  resetState({ history: [] });
  fetchImpl = (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [{
          id: 'dup-id',
          title: cursor ? '重复第二页' : '重复第一页',
          url: cursor ? 'https://example.com/dup-b' : 'https://example.com/dup-a',
          permalink: 'https://aihot.virxact.com/items/dup-id',
          publishedAt: new Date().toISOString()
        }],
        hasNext: !cursor,
        nextCursor: cursor ? null : 'page-2'
      })
    });
  };

  const internalDedupResponse = await sendMessage({ type: 'pollNow' });

  assert(internalDedupResponse.ok === true, '本轮内部重复手动刷新成功');
  assert(storageData.history.length === 1, '本轮分页内部按id/permalink去重');

  console.log('\n[pollNow-id去重]');
  resetState({
    history: [{ id: 'same-id', url: 'https://example.com/old-url', time: new Date().toISOString() }]
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [{
        id: 'same-id',
        title: '同ID不同URL',
        url: 'https://example.com/new-url',
        permalink: 'https://aihot.virxact.com/items/same-id',
        publishedAt: new Date().toISOString()
      }],
      hasNext: false
    })
  });

  const dedupResponse = await sendMessage({ type: 'pollNow' });

  assert(dedupResponse.ok === true, '手动刷新同id返回成功');
  assert(storageData.history.length === 1, '手动刷新按id识别重复，不新增不同URL副本');

  console.log('\n[pollNow-无稳定链接时使用组合指纹去重]');
  resetState({ history: [] });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [
        { title: '同标题', source: 'S', summary: 'A', publishedAt: '2026-07-24T00:00:00.000Z' },
        { title: '同标题', source: 'S', summary: 'B', publishedAt: '2026-07-24T00:00:00.000Z' }
      ],
      hasNext: false
    })
  });

  const noStableKeyResponse = await sendMessage({ type: 'pollNow' });

  assert(noStableKeyResponse.ok === true, '无稳定链接条目刷新成功');
  assert(storageData.history.length === 2, '同标题但摘要不同的无链接条目不互相误去重');

  console.log('\n[pollNow-手动刷新也写入特关metadata]');
  resetState({
    history: [],
    watchRules: [{ id: 'wr_manual', source: 'X', author: '目标作者', keywords: [], enabled: true }],
    watchNotifyState: {}
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [{ id: 'manual-watch', title: '手动特关', url: 'https://example.com/manual-watch', source: 'X：目标作者', publishedAt: new Date().toISOString() }],
      hasNext: false
    })
  });

  const manualWatchResponse = await sendMessage({ type: 'pollNow' });

  assert(manualWatchResponse.ok === true, '手动刷新特关内容成功');
  assert(storageData.history[0].watchMatched === true, '手动刷新写入特关标记');
  assert(storageData.watchNotifyState['manual-watch'], '手动刷新初始化稳定特关提醒状态');

  console.log('\n[pollNow失败]');
  resetState();
  fetchImpl = () => Promise.resolve({ ok: false, status: 503 });

  const pollResponse = await sendMessage({ type: 'pollNow' });

  assert(pollResponse.ok === false, '手动刷新失败返回 ok=false');
  assert(storageData.failCount === 1, '手动刷新失败递增 failCount');
  assert(badgeText === null || badgeText === '!', '手动刷新失败不误报未读数');

  console.log('\n[通知点击-持久化映射]');
  resetState({
    history: [],
    notificationUrlMap: {},
    watchRules: [
      { id: 'wr_1', source: 'X', author: '目标作者', keywords: [], enabled: true }
    ],
    watchNotifyState: {}
  });
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [
        {
          title: '特关内容',
          url: 'https://example.com/watch-target',
          source: 'X：目标作者',
          category: 'industry',
          summary: 'summary',
          publishedAt: new Date().toISOString()
        }
      ],
      hasNext: false
    })
  });

  await onAlarmHandler({ name: 'aihot-poll' });
  const notificationIds = Object.keys(storageData.notificationUrlMap || {});
  const notificationId = notificationIds[0];
  await onClickedHandler(notificationId);

  assert(storageData.history.length === 1, '特关后台轮询写入历史');
  assert(notificationId && notificationId.startsWith('aihot-watch-'), '特关通知 URL 写入持久化映射');
  assert(openedTabs[0] === 'https://example.com/watch-target', '点击通知打开持久化映射中的 URL');
  assert(!storageData.notificationUrlMap[notificationId], '点击后清理已使用的通知映射');
  assert(storageData.watchNotifyState['https://example.com/watch-target'].viewedAt, '点击特关通知后标记已查看');

  console.log('\n[特关-permalink兜底也能通知和点击]');
  resetState({
    history: [],
    notificationUrlMap: {},
    watchRules: [
      { id: 'wr_permalink', source: 'X', author: '作者', keywords: [], enabled: true }
    ],
    watchNotifyState: {}
  });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fp-permalink"' },
        json: () => Promise.resolve({ selected: 'fp-permalink', all: 'fp-all' })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [{ id: 'permalink-id', title: '无URL特关', url: '', permalink: 'https://aihot.virxact.com/items/permalink-id', source: 'X：作者', publishedAt: new Date().toISOString() }],
        hasNext: false
      })
    });
  };

  await onAlarmHandler({ name: 'aihot-poll' });
  const permalinkNotificationId = Object.keys(storageData.notificationUrlMap || {})[0];
  await onClickedHandler(permalinkNotificationId);

  assert(permalinkNotificationId && permalinkNotificationId.startsWith('aihot-watch-'), 'url为空但有permalink时仍创建特关通知');
  assert(openedTabs[0] === 'https://aihot.virxact.com/items/permalink-id', 'url为空时点击通知打开permalink');
  assert(storageData.watchNotifyState['permalink-id'].viewedAt, 'url为空时点击通知按稳定key标记已查看');

  console.log('\n[特关-同一alarm周期最多3条通知]');
  resetState({
    history: [],
    watchRules: [
      { id: 'wr_many', source: 'X', author: '作者', keywords: [], enabled: true }
    ],
    watchNotifyState: {}
  });
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'W/"fp-many-watch"' },
        json: () => Promise.resolve({ selected: 'fp-many-watch', all: 'fp-all' })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [1, 2, 3, 4].map(index => ({
          id: `many-${index}`,
          title: `特关${index}`,
          url: `https://example.com/many-${index}`,
          source: 'X：作者',
          publishedAt: new Date(Date.now() - index * 1000).toISOString()
        })),
        hasNext: false
      })
    });
  };

  await onAlarmHandler({ name: 'aihot-poll' });

  assert(notificationCreateIds.filter(id => id.startsWith('aihot-watch-')).length === 3, '同一alarm周期特关通知总数限制为3');

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
