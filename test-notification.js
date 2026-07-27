/**
 * 加载真实 background.js，验证 v1 拉取后的通知、特关和 badge 行为。
 * 运行: node test-notification.js
 */

let passed = 0;
let failed = 0;
let storageData = {};
let fetchImpl = null;
let notificationsCreated = [];
let badgeText = null;
let badgeColor = null;
let onMessageHandler = null;
let onAlarmHandler = null;
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
    lastItemsPollAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    feedMode: 'selected',
    history: [],
    historyDays: 1,
    readIds: [],
    readAllBefore: '',
    readAllBeforeByMode: {},
    failCount: 0,
    watchRules: [],
    watchNotifyState: {},
    ...overrides
  };
  notificationsCreated = [];
  badgeText = null;
  badgeColor = null;
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
    selected: true,
    publishedAt: new Date().toISOString(),
    ...item
  };
}

function v1Page(items, { hasMore = false, nextCursor = null } = {}) {
  return { items, page: { hasMore, nextCursor } };
}

function fingerprintResponse(selected = 'fp-new', all = 'fp-all') {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'W/"fingerprint"' },
    json: () => Promise.resolve({ selected, all })
  });
}

function responseForItems(items) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page(items)) });
}

function useV1Feed(items, fingerprint = 'fp-new') {
  fetchImpl = (url) => url.includes('/api/public/fingerprint')
    ? fingerprintResponse(fingerprint)
    : responseForItems(items);
}

function sendMessage(message) {
  return new Promise(resolve => onMessageHandler(message, {}, resolve));
}

async function waitFor(check, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return false;
}

async function autoPoll() {
  await onAlarmHandler({ name: 'aihot-poll' });
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
        Object.assign(storageData, values);
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  notifications: {
    create: (id, options) => {
      notificationsCreated.push({ id, ...options });
      return Promise.resolve(id);
    },
    onClicked: { addListener: () => {} },
    onClosed: { addListener: () => {} }
  },
  action: {
    setBadgeText: ({ text }) => { badgeText = text; },
    setBadgeBackgroundColor: ({ color }) => { badgeColor = color; }
  },
  tabs: { create: () => Promise.resolve() },
  alarms: {
    create: () => {},
    clear: () => Promise.resolve(),
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

async function runTests() {
  const firstItems = [
    v1Item({
      id: 'new-1',
      title: '测试新闻：Claude 5 发布',
      source: { name: 'Anthropic Blog' },
      links: { original: 'https://example.com/claude-5', aihot: 'https://aihot.virxact.com/items/new-1' },
      publishedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
    }),
    v1Item({
      id: 'new-2',
      title: '测试新闻：GPT-6 发布',
      source: { name: 'OpenAI Blog' },
      links: { original: 'https://example.com/gpt-6', aihot: 'https://aihot.virxact.com/items/new-2' },
      publishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    })
  ];

  console.log('\n[场景1: v1 新条目触发普通通知与角标]');
  resetState({ apiFingerprints: { selected: 'fp-old' } });
  useV1Feed(firstItems);
  await autoPoll();
  const firstNotification = notificationsCreated[0];
  assert(notificationsCreated.length === 1, '通知已创建');
  assert(firstNotification?.title === 'AI HOT 有 2 条新内容', `通知标题正确: "${firstNotification?.title}"`);
  assert(firstNotification?.message === '测试新闻：Claude 5 发布', '通知内容使用第一条标题');
  assert(firstNotification?.contextMessage === 'Anthropic Blog', '通知来源映射 source.name');
  assert(badgeText === '2' && badgeColor === '#e2231a', `角标显示未读数 2: "${badgeText}"`);
  assert(storageData.history.length === 2 && storageData.history[0].url === 'https://example.com/claude-5', 'history 存入 v1 links.original');
  assert(storageData.history[0].permalink === 'https://aihot.virxact.com/items/new-1', 'history 保留 v1 links.aihot');

  console.log('\n[场景2-4: 已有条目不通知，已读影响角标]');
  notificationsCreated = [];
  useV1Feed(firstItems, 'fp-new');
  await autoPoll();
  assert(notificationsCreated.length === 0, '无新条目时不弹通知');
  assert(badgeText === '2', `角标保持未读数 2: "${badgeText}"`);
  storageData.readIds = ['https://example.com/claude-5'];
  await autoPoll();
  assert(badgeText === '1', `标记 1 条已读后角标为 1: "${badgeText}"`);
  storageData.readIds.push('new-2');
  await autoPoll();
  assert(badgeText === '', `全部已读后角标为空: "${badgeText}"`);

  console.log('\n[场景5-7: 单条格式、关闭通知与手动刷新]');
  resetState({ apiFingerprints: { selected: 'fp-old' } });
  useV1Feed([v1Item({ id: 'new-3', title: '单条测试新闻', source: { name: 'Test' }, links: { original: 'https://example.com/single', aihot: 'https://aihot.virxact.com/items/new-3' } })]);
  await autoPoll();
  assert(notificationsCreated.length === 1, '单条新消息触发通知');
  assert(notificationsCreated[0]?.title === 'AI HOT 新内容', `单条通知标题: "${notificationsCreated[0]?.title}"`);
  assert(notificationsCreated[0]?.message === '单条测试新闻', `单条通知内容: "${notificationsCreated[0]?.message}"`);
  assert(notificationsCreated[0]?.contextMessage === 'Test', `单条通知来源: "${notificationsCreated[0]?.contextMessage}"`);
  resetState({ enabled: false });
  fetchImpl = () => { throw new Error('disabled poll should not fetch'); };
  await autoPoll();
  assert(notificationsCreated.length === 0, '关闭通知后不轮询或弹窗');
  resetState();
  useV1Feed(firstItems);
  const manualResponse = await sendMessage({ type: 'pollNow' });
  assert(manualResponse.ok === true && notificationsCreated.length === 0, '手动刷新只更新列表和角标，不弹通知');
  assert(storageData.history.length === 2, `手动刷新写入 2 条 v1 history: ${storageData.history.length}`);

  console.log('\n[场景8-9: 重建与手动刷新失败保留状态]');
  const oldHistory = [{ id: 'old', title: '旧内容', url: 'https://example.com/old', time: new Date().toISOString() }];
  resetState({ history: oldHistory, feedMode: 'selected' });
  fetchImpl = () => Promise.resolve({ ok: false, status: 500, headers: { get: () => '' } });
  const resetResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  assert(resetResponse.ok === false, 'resetAndPoll失败会向调用方返回失败');
  assert(storageData.history === oldHistory, 'resetAndPoll失败不覆盖旧history');
  assert(storageData.feedMode === 'selected', `resetAndPoll失败不提交新feedMode: ${storageData.feedMode}`);
  assert(storageData.failCount === 1, `resetAndPoll失败递增failCount: ${storageData.failCount}`);
  resetState({ history: oldHistory });
  fetchImpl = () => Promise.resolve({ ok: false, status: 503, headers: { get: () => '' } });
  const failedManualResponse = await sendMessage({ type: 'pollNow' });
  assert(failedManualResponse.ok === false, 'manualPoll失败返回失败态');
  assert(storageData.history === oldHistory, 'manualPoll失败不覆盖旧history');
  assert(storageData.failCount === 1, `manualPoll失败递增failCount: ${storageData.failCount}`);

  console.log('\n[场景10: all 模式新发现旧发布时间仍通知]');
  resetState({ feedMode: 'all', apiFingerprints: { all: 'fp-old' }, readAllBefore: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  useV1Feed([v1Item({ id: 'old-new', title: '新发现旧发布时间内容', source: { name: 'AI HOT' }, links: { original: 'https://example.com/old-new', aihot: 'https://aihot.virxact.com/items/old-new' }, publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() })], 'fp-selected');
  await autoPoll();
  assert(notificationsCreated.length === 1, '旧发布时间的新 URL 仍触发通知');
  assert(storageData.history.length === 1 && Boolean(storageData.history[0].discoveredAt), '已通知条目写入 history 并记录发现时间');
  assert(badgeText === '1', `旧全部已读不吞掉新发现条目角标: "${badgeText}"`);

  console.log('\n[场景11-12: 特关通知单独发送且每轮至多三条]');
  resetState({
    apiFingerprints: { selected: 'fp-old' },
    watchRules: [{ id: 'wr_khazix', source: '公众号', author: '数字生命卡兹克', keywords: ['Claude Code'], enabled: true }]
  });
  useV1Feed([v1Item({ id: 'khazix-1', title: 'Claude Code 6个实用Hook玩法', source: { name: '公众号：数字生命卡兹克' }, links: { original: 'https://mp.weixin.qq.com/s/LVj2foSXi_hBRKxjuYaUyw', aihot: 'https://aihot.virxact.com/items/khazix-1' } })]);
  await autoPoll();
  assert(notificationsCreated.length === 1 && notificationsCreated[0].title.includes('特关'), '特关只发1条独立通知');
  assert(storageData.history[0].watchMatched === true, 'history 标记特关命中');
  assert(storageData.watchNotifyState['khazix-1']?.notifyCount === 1, '特关通知状态记录次数');
  resetState({ apiFingerprints: { selected: 'fp-old' }, watchRules: [{ id: 'wr_x', source: 'X', author: '', keywords: [], enabled: true }] });
  useV1Feed([0, 1, 2, 3].map(index => v1Item({ id: `x-${index}`, title: `X热点${index}`, source: { name: 'X：测试账号 (@test)' }, links: { original: `https://x.com/a/status/${index}`, aihot: `https://aihot.virxact.com/items/x-${index}` }, publishedAt: new Date(Date.now() - index * 1000).toISOString() })));
  await autoPoll();
  assert(notificationsCreated.length === 3, `特关每轮最多3条: ${notificationsCreated.length}`);
  assert(storageData.history.filter(item => item.watchMatched).length === 4, '超过3条仍全部进入特关历史');

  console.log('\n[场景13-14: 特关查看、重复提醒和停用规则]');
  const watched = storageData.history[0];
  storageData.history.forEach(item => {
    storageData.watchNotifyState[item.id] = {
      ...storageData.watchNotifyState[item.id],
      nextNotifyAt: '',
      notifyCount: 3,
      viewedAt: ''
    };
  });
  storageData.watchNotifyState[watched.id] = { ...storageData.watchNotifyState[watched.id], nextNotifyAt: new Date(Date.now() - 60 * 1000).toISOString(), viewedAt: new Date().toISOString() };
  storageData.apiFingerprints = { selected: 'fp-new' };
  storageData.lastItemsPollAt = new Date().toISOString();
  notificationsCreated = [];
  useV1Feed([], 'fp-new');
  await autoPoll();
  assert(notificationsCreated.length === 0, '已查看的特关不重复通知');
  const repeat = storageData.history[1];
  storageData.watchNotifyState[repeat.id] = { ...storageData.watchNotifyState[repeat.id], nextNotifyAt: new Date(Date.now() - 60 * 1000).toISOString(), notifyCount: 1, viewedAt: '' };
  notificationsCreated = [];
  await autoPoll();
  assert(notificationsCreated[0]?.title.startsWith('特关：'), `重复提醒标题不含提醒二字: ${notificationsCreated[0]?.title}`);
  assert(!notificationsCreated[0]?.title.includes('提醒：'), `重复提醒标题删除提醒二字: ${notificationsCreated[0]?.title}`);
  const stopped = storageData.history[2];
  storageData.watchNotifyState[stopped.id] = { ...storageData.watchNotifyState[stopped.id], nextNotifyAt: '', notifyCount: 3, viewedAt: '' };
  notificationsCreated = [];
  await autoPoll();
  assert(notificationsCreated.length === 0, '特关第三次提醒后停止重复提醒');
  storageData.watchRules = [{ id: 'wr_x', source: 'X', author: '', keywords: [], enabled: false }];
  storageData.watchNotifyState[repeat.id] = { ...storageData.watchNotifyState[repeat.id], nextNotifyAt: new Date(Date.now() - 60 * 1000).toISOString(), notifyCount: 1, viewedAt: '' };
  notificationsCreated = [];
  await autoPoll();
  assert(notificationsCreated.length === 0, '停用规则后不再重复提醒');

  console.log('\n[标准 upsert 通知分类与隐藏提醒]');
  const retainedUrl = 'https://example.com/retained-new-match';
  resetState({
    apiFingerprints: { selected: 'fp-old' },
    history: [{
      id: 'retained-new-match',
      title: '旧标题',
      source: '普通来源',
      url: retainedUrl,
      permalink: 'https://aihot.virxact.com/items/retained-new-match',
      time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      discoveredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      selected: true
    }],
    watchRules: [{ id: 'wr_new_match', source: '目标来源', author: '', keywords: [], enabled: true }]
  });
  useV1Feed([v1Item({
    id: 'retained-new-match',
    title: '刷新后标题',
    source: { name: '目标来源' },
    links: { original: retainedUrl, aihot: 'https://aihot.virxact.com/items/retained-new-match' }
  })]);
  await autoPoll();
  const newlyMatchedRetained = storageData.history.find(item => item.id === 'retained-new-match');
  assert(notificationsCreated.length === 0 && newlyMatchedRetained?.title === '刷新后标题' && newlyMatchedRetained?.watchMatched === true, '已保留条目刷新并新命中特关时不立即通知');
  assert(!storageData.watchNotifyState['retained-new-match'], '新命中的已保留条目没有旧特关状态时不新建提醒状态');

  resetState({
    apiFingerprints: { selected: 'fp-old' },
    history: [{
      id: 'stale-watch-match',
      title: '旧命中条目',
      source: '旧目标来源',
      url: 'https://example.com/stale-watch-match',
      permalink: 'https://aihot.virxact.com/items/stale-watch-match',
      time: new Date().toISOString(),
      discoveredAt: new Date().toISOString(),
      selected: true,
      watchMatched: true,
      watchRuleIds: ['wr_stale'],
      watchMatchedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    }],
    watchRules: [{ id: 'wr_stale', source: '旧目标来源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      'stale-watch-match': { ruleIds: ['wr_stale'], firstMatchedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), lastNotifiedAt: '', notifyCount: 0, nextNotifyAt: new Date(Date.now() - 1000).toISOString(), viewedAt: '' }
    }
  });
  useV1Feed([v1Item({ id: 'stale-watch-match', source: { name: '新非目标来源' }, links: { original: 'https://example.com/stale-watch-match', aihot: 'https://aihot.virxact.com/items/stale-watch-match' } })]);
  await autoPoll();
  const noLongerMatched = storageData.history.find(item => item.id === 'stale-watch-match');
  assert(notificationsCreated.length === 0 && noLongerMatched?.watchMatched !== true && !noLongerMatched?.watchRuleIds, '刷新后不再命中的保留条目清除匹配元数据且不提醒');

  resetState({ apiFingerprints: { selected: 'fp-old' } });
  useV1Feed([
    v1Item({ id: 'duplicate-notification', title: '通知旧字段', links: { original: 'https://example.com/duplicate-notification', aihot: 'https://aihot.virxact.com/items/duplicate-notification' } }),
    v1Item({ id: 'duplicate-notification', title: '通知最终字段', links: { original: 'https://example.com/duplicate-notification', aihot: 'https://aihot.virxact.com/items/duplicate-notification' } })
  ]);
  await autoPoll();
  assert(storageData.history.length === 1 && notificationsCreated.length === 1 && notificationsCreated[0]?.message === '通知最终字段', '重复 ID 只作为一个 inserted 分类并使用最终字段通知');

  const hiddenFirstMatchedAt = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  resetState({
    feedMode: 'selected',
    apiFingerprints: { selected: 'fp-same' },
    lastItemsPollAt: new Date().toISOString(),
    history: [{
      id: 'hidden-watch',
      title: '隐藏特关',
      source: '隐藏来源',
      url: 'https://example.com/hidden-watch',
      permalink: 'https://aihot.virxact.com/items/hidden-watch',
      time: new Date().toISOString(),
      discoveredAt: new Date().toISOString(),
      selected: false,
      watchMatched: true,
      watchRuleIds: ['wr_hidden']
    }],
    watchRules: [{ id: 'wr_hidden', source: '隐藏来源', author: '', keywords: [], enabled: true }],
    watchNotifyState: {
      'hidden-watch': { ruleIds: ['wr_hidden'], firstMatchedAt: hiddenFirstMatchedAt, lastNotifiedAt: hiddenFirstMatchedAt, notifyCount: 1, nextNotifyAt: new Date(Date.now() - 1000).toISOString(), viewedAt: '' }
    }
  });
  useV1Feed([], 'fp-same');
  await autoPoll();
  assert(notificationsCreated.length === 0 && storageData.watchNotifyState['hidden-watch']?.notifyCount === 1, '隐藏的 all-only 特关状态保留但不进入 selected 提醒候选');

  resetState({
    apiFingerprints: { selected: 'fp-old' },
    watchRules: [{ id: 'wr_silent_paths', source: '静默来源', author: '', keywords: [], enabled: true }]
  });
  useV1Feed([v1Item({ id: 'manual-watch', source: { name: '静默来源' }, links: { original: 'https://example.com/manual-watch', aihot: 'https://aihot.virxact.com/items/manual-watch' } })]);
  await sendMessage({ type: 'pollNow' });
  assert(notificationsCreated.length === 0 && storageData.watchNotifyState['manual-watch']?.notifyCount === 0, '手动刷新的新特关条目静默建立提醒状态');

  resetState({
    feedMode: 'selected',
    watchRules: [{ id: 'wr_silent_paths', source: '静默来源', author: '', keywords: [], enabled: true }]
  });
  let continuationRequested = false;
  fetchImpl = (url) => {
    if (url.includes('/api/public/fingerprint')) return fingerprintResponse('fp-selected', 'fp-all-switch');
    const cursor = new URL(url).searchParams.get('cursor');
    if (cursor === 'silent-watch-cursor') {
      continuationRequested = true;
      return responseForItems([v1Item({ id: 'continuation-watch', source: { name: '静默来源' }, links: { original: 'https://example.com/continuation-watch', aihot: 'https://aihot.virxact.com/items/continuation-watch' } })]);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(v1Page([
      v1Item({ id: 'switch-watch', source: { name: '静默来源' }, links: { original: 'https://example.com/switch-watch', aihot: 'https://aihot.virxact.com/items/switch-watch' } })
    ], { hasMore: true, nextCursor: 'silent-watch-cursor' })) });
  };
  await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });
  await waitFor(() => continuationRequested && Boolean(storageData.watchNotifyState['continuation-watch']));
  assert(notificationsCreated.length === 0 && storageData.watchNotifyState['switch-watch']?.notifyCount === 0, '内容源切换的新特关条目静默建立提醒状态');
  assert(storageData.watchNotifyState['continuation-watch']?.notifyCount === 0, 'all 续拉的新特关条目静默建立提醒状态');

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
