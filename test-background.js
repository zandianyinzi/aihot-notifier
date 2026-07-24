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
        Object.assign(storageData, obj);
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  notifications: {
    create: () => Promise.resolve(),
    onClicked: { addListener: (fn) => { onClickedHandler = fn; } }
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

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
