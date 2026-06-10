/**
 * 模拟验证：有新条目时 pollForUpdates 是否触发通知 + 更新 badge
 *
 * 模拟 chrome API 和 fetch，验证完整流程：
 * 1. API 返回新条目（不在 history 中）
 * 2. 应调用 chrome.notifications.create
 * 3. 应调用 chrome.action.setBadgeText 显示未读数
 */

let notificationCreated = null;
let badgeText = null;
let badgeColor = null;
let storageData = {
  enabled: true,
  interval: 5,
  lastCheck: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  feedMode: 'selected',
  history: [],
  historyDays: 1,
  readIds: [],
  readAllBefore: '',
  failCount: 0,
};

// Mock chrome API
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
    create: (id, opts) => {
      notificationCreated = { id, ...opts };
      return Promise.resolve();
    },
    onClicked: { addListener: () => {} }
  },
  action: {
    setBadgeText: (opts) => { badgeText = opts.text; },
    setBadgeBackgroundColor: (opts) => { badgeColor = opts.color; }
  },
  alarms: {
    create: () => {},
    clear: () => Promise.resolve(),
    onAlarm: { addListener: () => {} }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  }
};

// Mock fetch - 返回 2 条新条目
const mockApiItems = [
  {
    id: 'new-1',
    title: '测试新闻：Claude 5 发布',
    url: 'https://example.com/claude-5',
    source: 'Anthropic Blog',
    category: '模型',
    summary: '最新一代模型',
    publishedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
  },
  {
    id: 'new-2',
    title: '测试新闻：GPT-6 发布',
    url: 'https://example.com/gpt-6',
    source: 'OpenAI Blog',
    category: '模型',
    summary: '又一个新模型',
    publishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  }
];

globalThis.fetch = (url) => {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: mockApiItems, hasNext: false })
  });
};

// 加载 background.js 的核心函数（提取逻辑）
const API_BASE = 'https://aihot.virxact.com/api/public/items?take=100';
const BADGE_COLOR = '#e2231a';

function getApiUrl(mode) {
  return `${API_BASE}&mode=${mode}`;
}

function getItemTime(item) {
  return new Date(item.time).getTime();
}

function getUnreadReferenceTime(item) {
  return Math.max(getItemTime(item) || 0, new Date(item.discoveredAt || item.time).getTime() || 0);
}

function isWithinHistoryWindow(item, cutoff) {
  return getUnreadReferenceTime(item) > cutoff;
}

function toHistoryEntry(item, discoveredAt) {
  return {
    title: item.title,
    url: item.url,
    source: item.source || '',
    category: item.category || '',
    summary: item.summary || '',
    time: item.publishedAt,
    discoveredAt
  };
}

async function getConfig() {
  const data = await chrome.storage.local.get(['enabled', 'interval', 'lastCheck', 'feedMode']);
  return {
    enabled: data.enabled !== false,
    interval: data.interval || 5,
    lastCheck: data.lastCheck || new Date().toISOString(),
    feedMode: data.feedMode || 'selected'
  };
}

async function updateBadge() {
  const { history = [], readIds = [], readAllBefore = '', historyDays = 1 } = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'historyDays']);
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const unread = history.filter(i => {
    if (!isWithinHistoryWindow(i, cutoff)) return false;
    if (readIds.includes(i.url)) return false;
    if (readAllBefore && getUnreadReferenceTime(i) <= new Date(readAllBefore).getTime()) return false;
    return true;
  }).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

async function showNotification(items) {
  const count = items.length;
  const discoveredAt = new Date().toISOString();
  if (count === 1) {
    chrome.notifications.create('aihot-new', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'AI HOT 新内容',
      message: items[0].title,
      contextMessage: items[0].source || ''
    });
  } else {
    chrome.notifications.create('aihot-new', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `AI HOT ${count} 条新内容`,
      message: items.slice(0, 3).map(i => i.title).join('\n')
    });
  }

  await chrome.storage.local.set({ lastItems: items.slice(0, 5) });

  const { history = [], historyDays = 1 } = await chrome.storage.local.get(['history', 'historyDays']);
  const existingUrls = new Set(history.map(i => i.url));
  const newEntries = items
    .filter(i => !existingUrls.has(i.url))
    .map(i => toHistoryEntry(i, discoveredAt));
  const cutoff = Date.now() - Math.max(historyDays, 7) * 24 * 60 * 60 * 1000;
  const updated = [...newEntries, ...history]
    .filter(i => isWithinHistoryWindow(i, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  await chrome.storage.local.set({ history: updated });
  await updateBadge();
}

async function pollForUpdates() {
  const config = await getConfig();
  if (!config.enabled) return;

  const bufferMs = Math.max(config.interval * 2 * 60 * 1000, 2 * 60 * 60 * 1000);
  const sinceTime = new Date(new Date(config.lastCheck).getTime() - bufferMs).toISOString();
  const now = new Date().toISOString();

  const res = await fetch(`${getApiUrl(config.feedMode)}&since=${encodeURIComponent(sinceTime)}`);
  if (!res.ok) return;

  const json = await res.json();
  const { history = [] } = await chrome.storage.local.get('history');
  const existingUrls = new Set(history.map(i => i.url));
  const newItems = (json.items || []).filter(i => !existingUrls.has(i.url));
  await chrome.storage.local.set({ lastCheck: now, failCount: 0 });

  if (newItems.length > 0) {
    await showNotification(newItems);
  } else {
    await updateBadge();
  }
}

async function manualPoll() {
  try {
    const { history = [], historyDays = 1, feedMode = 'selected' } = await chrome.storage.local.get(['history', 'historyDays', 'feedMode']);
    const sinceTime = new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${getApiUrl(feedMode)}&since=${encodeURIComponent(sinceTime)}`);
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const json = await res.json();
    const allItems = json.items || [];
    if (allItems.length === 0) return;

    const existingUrls = new Set(history.map(i => i.url));
    const discoveredAt = new Date().toISOString();
    const newEntries = allItems
      .filter(i => !existingUrls.has(i.url))
      .map(i => toHistoryEntry(i, discoveredAt));
    const cutoff = Date.now() - Math.max(historyDays, 7) * 24 * 60 * 60 * 1000;
    const merged = [...newEntries, ...history]
      .filter(i => isWithinHistoryWindow(i, cutoff))
      .sort((a, b) => getItemTime(b) - getItemTime(a));

    await chrome.storage.local.set({ history: merged, lastCheck: new Date().toISOString(), failCount: 0 });
    await updateBadge();
  } catch (e) {
    await incrementFailCount();
    throw e;
  }
}

async function incrementFailCount() {
  const { failCount = 0 } = await chrome.storage.local.get('failCount');
  await chrome.storage.local.set({ failCount: failCount + 1 });
}

async function resetAndPoll(feedMode) {
  try {
    const { historyDays = 1 } = await chrome.storage.local.get('historyDays');
    const cutoff = Date.now() - Math.max(historyDays, 7) * 24 * 60 * 60 * 1000;
    const sinceTime = new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();
    let allItems = [];
    let cursor = null;
    const maxPages = 3;

    for (let page = 0; page < maxPages; page++) {
      let url = `${getApiUrl(feedMode)}&since=${encodeURIComponent(sinceTime)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const json = await res.json();
      if (!json.items || json.items.length === 0) break;

      allItems = allItems.concat(json.items);

      if (!json.hasNext || !json.nextCursor) break;
      const oldest = json.items[json.items.length - 1];
      if (new Date(oldest.publishedAt).getTime() < cutoff) break;
      cursor = json.nextCursor;
    }

    const history = allItems
      .map(i => toHistoryEntry(i, i.publishedAt))
      .filter(i => isWithinHistoryWindow(i, cutoff))
      .sort((a, b) => getItemTime(b) - getItemTime(a));

    await chrome.storage.local.set({ history, feedMode, lastCheck: new Date().toISOString(), failCount: 0 });
    await updateBadge();
  } catch (e) {
    await incrementFailCount();
    throw e;
  }
}

// ---- 测试 ----

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n[场景1: history 为空，API 返回 2 条新条目]');

  // 重置状态
  notificationCreated = null;
  badgeText = null;
  storageData.history = [];
  storageData.readIds = [];

  await pollForUpdates();

  assert(notificationCreated !== null, '通知已创建');
  assert(notificationCreated.title === 'AI HOT 2 条新内容', `通知标题正确: "${notificationCreated?.title}"`);
  assert(notificationCreated.message.includes('Claude 5'), '通知内容包含第一条标题');
  assert(notificationCreated.message.includes('GPT-6'), '通知内容包含第二条标题');
  assert(badgeText === '2', `角标显示未读数 2: "${badgeText}"`);
  assert(storageData.history.length === 2, `history 存入 2 条: ${storageData.history.length}`);

  console.log('\n[场景2: history 已有这 2 条，API 返回相同条目（无新增）]');

  notificationCreated = null;
  badgeText = null;

  await pollForUpdates();

  assert(notificationCreated === null, '无新条目时不弹通知');
  assert(badgeText === '2', `角标保持未读数 2: "${badgeText}"`);

  console.log('\n[场景3: 标记已读后角标更新]');

  storageData.readIds = ['https://example.com/claude-5'];
  badgeText = null;

  await updateBadge();

  assert(badgeText === '1', `标记 1 条已读后角标为 1: "${badgeText}"`);

  console.log('\n[场景4: 全部已读后角标清除]');

  storageData.readIds = ['https://example.com/claude-5', 'https://example.com/gpt-6'];
  badgeText = null;

  await updateBadge();

  assert(badgeText === '', `全部已读后角标为空: "${badgeText}"`);

  console.log('\n[场景5: 单条新消息的通知格式]');

  storageData.history = [storageData.history[0]]; // 只保留一条
  notificationCreated = null;

  // mock 只返回 1 条新的
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [{
        id: 'new-3',
        title: '单条测试新闻',
        url: 'https://example.com/single',
        source: 'Test',
        category: '产品',
        summary: '测试',
        publishedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      }],
      hasNext: false
    })
  });

  await pollForUpdates();

  assert(notificationCreated !== null, '单条新消息触发通知');
  assert(notificationCreated.title === 'AI HOT 新内容', `单条通知标题: "${notificationCreated?.title}"`);
  assert(notificationCreated.message === '单条测试新闻', `单条通知内容: "${notificationCreated?.message}"`);
  assert(notificationCreated.contextMessage === 'Test', `单条通知来源: "${notificationCreated?.contextMessage}"`);

  globalThis.fetch = origFetch;

  console.log('\n[场景6: 通知关闭时不轮询]');

  storageData.enabled = false;
  notificationCreated = null;
  const prevBadge = badgeText;

  await pollForUpdates();

  assert(notificationCreated === null, '关闭通知后不弹窗');

  console.log('\n[场景7: 手动刷新不弹桌面通知]');

  storageData.enabled = true;
  storageData.history = [];
  storageData.readIds = [];
  notificationCreated = null;

  await manualPoll();

  assert(notificationCreated === null, '手动刷新只更新列表和角标，不弹通知');
  assert(storageData.history.length === 2, `手动刷新写入 2 条 history: ${storageData.history.length}`);

  console.log('\n[场景8: 内容源重建失败不清空history]');

  const oldHistory = [{ title: '旧内容', url: 'https://example.com/old', time: new Date().toISOString() }];
  storageData.history = oldHistory;
  storageData.feedMode = 'selected';
  storageData.failCount = 0;
  const okFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 500 });

  let threw = false;
  try {
    await resetAndPoll('all');
  } catch (_e) {
    threw = true;
  }

  assert(threw, 'resetAndPoll失败会向调用方抛错');
  assert(storageData.history === oldHistory, 'resetAndPoll失败不覆盖旧history');
  assert(storageData.feedMode === 'selected', `resetAndPoll失败不提交新feedMode: ${storageData.feedMode}`);
  assert(storageData.failCount === 1, `resetAndPoll失败递增failCount: ${storageData.failCount}`);

  globalThis.fetch = okFetch;

  console.log('\n[场景9: 手动刷新失败返回失败态]');

  storageData.history = oldHistory;
  storageData.failCount = 0;
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 503 });

  let manualThrew = false;
  try {
    await manualPoll();
  } catch (_e) {
    manualThrew = true;
  }

  assert(manualThrew, 'manualPoll失败会向调用方抛错');
  assert(storageData.history === oldHistory, 'manualPoll失败不覆盖旧history');
  assert(storageData.failCount === 1, `manualPoll失败递增failCount: ${storageData.failCount}`);

  globalThis.fetch = okFetch;

  console.log('\n[场景10: all模式新发现旧发布时间仍入列表和角标]');

  storageData.enabled = true;
  storageData.feedMode = 'all';
  storageData.history = [];
  storageData.readIds = [];
  storageData.readAllBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  storageData.historyDays = 1;
  notificationCreated = null;
  badgeText = null;
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [{
        id: 'old-new',
        title: '新发现旧发布时间内容',
        url: 'https://example.com/old-new',
        source: 'AI HOT',
        category: '全部',
        summary: '发布时间较早但刚被插件发现',
        publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      }],
      hasNext: false
    })
  });

  await pollForUpdates();

  assert(notificationCreated !== null, '旧发布时间的新URL仍触发通知');
  assert(storageData.history.length === 1, `已通知条目写入history: ${storageData.history.length}`);
  assert(Boolean(storageData.history[0].discoveredAt), 'history记录发现时间');
  assert(badgeText === '1', `旧全部已读不吞掉新发现条目角标: "${badgeText}"`);

  globalThis.fetch = okFetch;

  console.log(`\n========================================`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
