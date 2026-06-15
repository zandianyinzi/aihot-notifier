chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const API_BASE = 'https://aihot.virxact.com/api/public/items?take=100';
const ALARM_NAME = 'aihot-poll';
const DEFAULT_INTERVAL = 5;
const MIN_INTERVAL = 2;
const DEFAULT_HISTORY_DAYS = 2;
const MAX_HISTORY_DAYS = 5;
const BADGE_COLOR = '#e2231a';


async function getConfig() {
  const data = await chrome.storage.local.get(['enabled', 'interval', 'lastCheck', 'feedMode']);
  return {
    enabled: data.enabled !== false,
    interval: Math.max(Number(data.interval) || DEFAULT_INTERVAL, MIN_INTERVAL),
    lastCheck: data.lastCheck || new Date().toISOString(),
    feedMode: data.feedMode || 'selected'
  };
}

function getApiUrl(mode) {
  return `${API_BASE}&mode=${mode}`;
}

function normalizeFeedMode(mode) {
  return mode === 'all' ? 'all' : 'selected';
}

function getReadAllBeforeForMode(data) {
  const mode = normalizeFeedMode(data.feedMode);
  const byMode = data.readAllBeforeByMode || {};
  return byMode[mode] || data.readAllBefore || '';
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

async function migrateReadAllBefore() {
  const data = await chrome.storage.local.get(['readAllBefore', 'readAllBeforeByMode', 'feedMode']);
  if (!data.readAllBefore) return;

  const mode = normalizeFeedMode(data.feedMode);
  await chrome.storage.local.set({
    readAllBeforeByMode: {
      ...(data.readAllBeforeByMode || {}),
      [mode]: data.readAllBefore
    },
    readAllBefore: ''
  });
}

async function pollForUpdates() {
  const config = await getConfig();
  if (!config.enabled) return;

  // API 公开接口有 30-80 分钟入库/缓存延迟，回退 2 小时确保不漏
  const bufferMs = Math.max(config.interval * 2 * 60 * 1000, 2 * 60 * 60 * 1000);
  const sinceTime = new Date(new Date(config.lastCheck).getTime() - bufferMs).toISOString();
  const now = new Date().toISOString();
  console.log(`[AI HOT] polling since=${sinceTime}`);

  try {
    const res = await fetch(`${getApiUrl(config.feedMode)}&since=${encodeURIComponent(sinceTime)}`);
    if (!res.ok) {
      console.warn(`[AI HOT] API returned ${res.status}`);
      await incrementFailCount();
      return;
    }

    const json = await res.json();
    const { history = [] } = await chrome.storage.local.get('history');
    const existingUrls = new Set(history.map(i => i.url));
    const newItems = (json.items || []).filter(i => !existingUrls.has(i.url));
    console.log(`[AI HOT] got ${json.items?.length || 0} items, ${newItems.length} new`);
    await chrome.storage.local.set({ lastCheck: now, failCount: 0 });

    if (newItems.length > 0) {
      await showNotification(newItems);
    } else {
      await updateBadge();
    }
  } catch (e) {
    console.error(`[AI HOT] fetch error:`, e);
    await incrementFailCount();
  }
}

async function incrementFailCount() {
  const { failCount = 0 } = await chrome.storage.local.get('failCount');
  const newCount = failCount + 1;
  await chrome.storage.local.set({ failCount: newCount });
  if (newCount >= 3) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
  }
}

async function showNotification(items) {
  const count = items.length;
  const discoveredAt = new Date().toISOString();
  const notifId = 'aihot-' + Date.now();

  if (count === 1) {
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'AI HOT 新内容',
      message: items[0].title,
      contextMessage: items[0].source || ''
    });
  } else {
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `AI HOT ${count} 条新内容`,
      message: items.slice(0, 3).map(i => i.title).join('\n')
    });
  }

  await chrome.storage.local.set({ lastItems: items.slice(0, 5) });

  const { history = [], historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get(['history', 'historyDays']);
  const existingUrls = new Set(history.map(i => i.url));
  const newEntries = items
    .filter(i => !existingUrls.has(i.url))
    .map(i => toHistoryEntry(i, discoveredAt));
  const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
  const updated = [...newEntries, ...history]
    .filter(i => isWithinHistoryWindow(i, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  await chrome.storage.local.set({ history: updated });
  await updateBadge();
}

async function manualPoll() {
  const { history = [], historyDays = DEFAULT_HISTORY_DAYS, feedMode = 'selected' } = await chrome.storage.local.get(['history', 'historyDays', 'feedMode']);
  const sinceTime = new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();
  console.log(`[AI HOT] manual poll since=${sinceTime}`);

  try {
    let allItems = [];
    let cursor = null;
    const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
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

    if (allItems.length === 0) return;

    const existingUrls = new Set(history.map(i => i.url));
    const discoveredAt = new Date().toISOString();
    const newEntries = allItems
      .filter(i => !existingUrls.has(i.url))
      .map(i => toHistoryEntry(i, discoveredAt));

    const merged = [...newEntries, ...history]
      .filter(i => isWithinHistoryWindow(i, cutoff))
      .sort((a, b) => getItemTime(b) - getItemTime(a));

    await chrome.storage.local.set({ history: merged, lastCheck: new Date().toISOString(), failCount: 0 });
    await updateBadge();
    console.log(`[AI HOT] manual poll done, ${merged.length} total items (fetched ${allItems.length})`);
  } catch (e) {
    console.error(`[AI HOT] manual poll error:`, e);
    await incrementFailCount();
    throw e;
  }
}

async function updateBadge() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  const { history = [], readIds = [], historyDays = DEFAULT_HISTORY_DAYS } = data;
  const readAllBefore = getReadAllBeforeForMode(data);
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

async function resetAndPoll(feedMode) {
  console.log(`[AI HOT] resetAndPoll feedMode=${feedMode}`);
  try {
    const { historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get('historyDays');
    const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
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

    await chrome.storage.local.set({ history, feedMode: normalizeFeedMode(feedMode), lastCheck: new Date().toISOString(), failCount: 0 });
    await updateBadge();
    console.log(`[AI HOT] resetAndPoll done, ${history.length} items from ${allItems.length} fetched`);
  } catch (e) {
    console.error(`[AI HOT] resetAndPoll error:`, e);
    await incrementFailCount();
    throw e;
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('aihot-')) {
    const { lastItems = [] } = await chrome.storage.local.get('lastItems');
    if (lastItems.length > 0 && lastItems[0].url) {
      chrome.tabs.create({ url: lastItems[0].url });
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollForUpdates();
  }
});

async function setupAlarm() {
  const config = await getConfig();
  await chrome.alarms.clear(ALARM_NAME);
  if (config.enabled) {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.1, periodInMinutes: config.interval });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[AI HOT] extension ${details.reason}`);
  await migrateReadAllBefore();
  if (details.reason === 'install') {
    try {
      const { feedMode = 'selected', historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get(['feedMode', 'historyDays']);
      const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
      const maxPages = 3;
      let allItems = [];
      let cursor = null;

      for (let page = 0; page < maxPages; page++) {
        let url = getApiUrl(feedMode);
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

        const res = await fetch(url);
        if (!res.ok) break;
        const json = await res.json();
        if (!json.items || json.items.length === 0) break;

        allItems = allItems.concat(json.items);

        if (!json.hasNext || !json.nextCursor) break;
        const oldest = json.items[json.items.length - 1];
        if (new Date(oldest.publishedAt).getTime() < cutoff) break;
        cursor = json.nextCursor;
      }

      if (allItems.length > 0) {
        const { history = [] } = await chrome.storage.local.get('history');
        const existingUrls = new Set(history.map(i => i.url));
        const newEntries = allItems
          .filter(i => !existingUrls.has(i.url))
          .map(i => toHistoryEntry(i, i.publishedAt));
        const merged = [...newEntries, ...history]
          .filter(i => isWithinHistoryWindow(i, cutoff))
          .sort((a, b) => getItemTime(b) - getItemTime(a));
        await chrome.storage.local.set({ history: merged });
      }
    } catch (e) {
      console.warn('[AI HOT] failed to fetch initial items:', e);
    }
  }
  await chrome.storage.local.set({ lastCheck: new Date().toISOString() });
  await updateBadge();
  await setupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateReadAllBefore();
  await setupAlarm();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'configChanged') {
    setupAlarm();
    sendResponse({ ok: true });
  }
  if (msg.type === 'pollNow') {
    manualPoll()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'feedModeChanged') {
    resetAndPoll(msg.feedMode)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// 数据变化时自动更新 badge
chrome.storage.onChanged.addListener((changes) => {
  if (changes.history || changes.readIds || changes.readAllBefore || changes.readAllBeforeByMode || changes.feedMode) {
    updateBadge();
  }
});
