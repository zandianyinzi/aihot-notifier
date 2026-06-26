const API_BASE = 'https://aihot.virxact.com/api/public/items?take=100';
const ALARM_NAME = 'aihot-poll';
const DEFAULT_INTERVAL = 5;
const MIN_INTERVAL = 2;
const DEFAULT_HISTORY_DAYS = 2;
const MAX_HISTORY_DAYS = 5;
const BADGE_COLOR = '#e2231a';
const MAX_WATCH_NOTIFICATIONS_PER_CYCLE = 3;
const WATCH_REMINDER_DELAYS = [0, 2 * 60 * 1000, 5 * 60 * 1000, 2 * 60 * 60 * 1000];
const WATCH_DAILY_REMINDER_MS = 24 * 60 * 60 * 1000;
const notificationUrlMap = {};



async function getConfig() {
  const data = await chrome.storage.local.get(['enabled', 'interval', 'lastCheck', 'feedMode']);
  return {
    enabled: data.enabled !== false,
    interval: Math.max(Number(data.interval) || DEFAULT_INTERVAL, MIN_INTERVAL),
    lastCheck: data.lastCheck || new Date().toISOString(),
    feedMode: data.feedMode || 'all'
  };
}

function getApiUrl(mode) {
  return `${API_BASE}&mode=${mode}`;
}

function splitWatchKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap(v => splitWatchKeywords(v))
      .filter(Boolean);
  }
  return String(value || '')
    .split(/[,，]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeWatchRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule, index) => {
      const source = String(rule.source || '').trim();
      const author = String(rule.author || '').trim();
      const keywords = splitWatchKeywords(rule.keywords);
      return {
        id: String(rule.id || `wr_${index}`),
        source,
        author,
        keywords,
        enabled: rule.enabled !== false,
        createdAt: rule.createdAt || ''
      };
    })
    .filter(rule => rule.enabled && (rule.source || rule.author || rule.keywords.length > 0));
}

function parseSourceParts(source) {
  const text = String(source || '').trim();
  const parts = text.split(/[:：]/);
  if (parts.length < 2) return { sourceType: text, authorText: text };
  return {
    sourceType: parts[0].trim(),
    authorText: parts.slice(1).join('：').trim()
  };
}

function includesText(haystack, needle) {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return true;
  return normalizeText(haystack).includes(normalizedNeedle);
}

function matchWatchRules(item, rules) {
  const normalizedRules = normalizeWatchRules(rules);
  if (normalizedRules.length === 0) return [];

  const source = item.source || '';
  const parts = parseSourceParts(source);
  const keywordText = `${item.title || ''}\n${item.summary || ''}`;

  return normalizedRules.filter(rule => {
    if (rule.source && !includesText(parts.sourceType, rule.source)) return false;
    if (rule.author && !includesText(parts.authorText || source, rule.author)) return false;
    if (rule.keywords.length > 0 && !rule.keywords.some(keyword => includesText(keywordText, keyword))) return false;
    return true;
  });
}

function getNextWatchNotifyAt(firstMatchedAt, notifyCount, referenceNow) {
  const first = new Date(firstMatchedAt).getTime();
  if (!first) return '';
  if (notifyCount < WATCH_REMINDER_DELAYS.length) {
    return new Date(first + WATCH_REMINDER_DELAYS[notifyCount]).toISOString();
  }
  const base = referenceNow ? new Date(referenceNow).getTime() : Date.now();
  return new Date(base + WATCH_DAILY_REMINDER_MS).toISOString();
}

function isWatchViewed(state) {
  return Boolean(state && state.viewedAt);
}

function buildWatchStateForItem(existingState, item, ruleIds, now) {
  const current = existingState || {};
  const firstMatchedAt = current.firstMatchedAt || now;
  const notifyCount = Number(current.notifyCount || 0);
  return {
    ruleIds: Array.from(new Set([...(current.ruleIds || []), ...ruleIds])),
    firstMatchedAt,
    lastNotifiedAt: current.lastNotifiedAt || '',
    notifyCount,
    nextNotifyAt: current.nextNotifyAt || getNextWatchNotifyAt(firstMatchedAt, notifyCount, now),
    viewedAt: current.viewedAt || ''
  };
}

function shouldNotifyWatchState(state, nowMs) {
  if (!state || isWatchViewed(state)) return false;
  const next = new Date(state.nextNotifyAt || state.firstMatchedAt || 0).getTime();
  return next > 0 && next <= nowMs;
}

function advanceWatchNotifyState(state, now) {
  const notifyCount = Number(state.notifyCount || 0) + 1;
  return {
    ...state,
    lastNotifiedAt: now,
    notifyCount,
    nextNotifyAt: getNextWatchNotifyAt(state.firstMatchedAt || now, notifyCount, now)
  };
}

function getWatchNotificationTitle(item, state) {
  const ruleLabel = parseSourceParts(item.source || '').authorText || item.source || '特别关注';
  return `特别关注：${ruleLabel}`;
}

function createNotification(id, options, url) {
  if (url) notificationUrlMap[id] = url;
  chrome.notifications.create(id, options);
}

async function sendWatchNotifications(items, watchNotifyState, now) {
  const nowMs = new Date(now).getTime();
  const dueItems = items
    .filter(item => shouldNotifyWatchState(watchNotifyState[item.url], nowMs))
    .sort((a, b) => getItemTime(b) - getItemTime(a))
    .slice(0, MAX_WATCH_NOTIFICATIONS_PER_CYCLE);

  dueItems.forEach((item, index) => {
    const state = watchNotifyState[item.url];
    createNotification(`aihot-watch-${Date.now()}-${index}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: getWatchNotificationTitle(item, state),
      message: item.title,
      contextMessage: item.source || ''
    }, item.url);
    watchNotifyState[item.url] = advanceWatchNotifyState(state, now);
  });

  return dueItems;
}

async function markWatchViewed(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  const filtered = list.filter(Boolean);
  if (filtered.length === 0) return;
  const { watchNotifyState = {} } = await chrome.storage.local.get('watchNotifyState');
  const now = new Date().toISOString();
  filtered.forEach(url => {
    if (watchNotifyState[url]) {
      watchNotifyState[url] = { ...watchNotifyState[url], viewedAt: watchNotifyState[url].viewedAt || now };
    }
  });
  await chrome.storage.local.set({ watchNotifyState });
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

function toHistoryEntry(item, discoveredAt, watchMatches = []) {
  const entry = {
    title: item.title,
    url: item.url,
    source: item.source || '',
    category: item.category || '',
    summary: item.summary || '',
    time: item.publishedAt,
    discoveredAt
  };
  if (watchMatches.length > 0) {
    entry.watchMatched = true;
    entry.watchRuleIds = watchMatches.map(rule => rule.id);
    entry.watchMatchedAt = discoveredAt;
  }
  return entry;
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
  const discoveredAt = new Date().toISOString();
  const {
    history = [],
    historyDays = DEFAULT_HISTORY_DAYS,
    watchRules = [],
    watchNotifyState = {}
  } = await chrome.storage.local.get(['history', 'historyDays', 'watchRules', 'watchNotifyState']);

  const existingUrls = new Set(history.map(i => i.url));
  const newEntries = [];
  const watchItems = [];
  const normalItems = [];
  const nextWatchNotifyState = { ...watchNotifyState };

  items
    .filter(i => !existingUrls.has(i.url))
    .forEach(item => {
      const watchMatches = matchWatchRules(item, watchRules);
      const entry = toHistoryEntry(item, discoveredAt, watchMatches);
      newEntries.push(entry);
      if (watchMatches.length > 0) {
        const ruleIds = watchMatches.map(rule => rule.id);
        nextWatchNotifyState[item.url] = buildWatchStateForItem(nextWatchNotifyState[item.url], item, ruleIds, discoveredAt);
        watchItems.push(entry);
      } else {
        normalItems.push(item);
      }
    });

  await sendWatchNotifications(watchItems, nextWatchNotifyState, discoveredAt);

  if (normalItems.length > 0) {
    const count = normalItems.length;
    const notifId = 'aihot-' + Date.now();

    if (count === 1) {
      createNotification(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'AI HOT 新内容',
        message: normalItems[0].title,
        contextMessage: normalItems[0].source || ''
      }, normalItems[0].url);
    } else {
      createNotification(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `AI HOT 有 ${count} 条新内容`,
        message: normalItems[0].title,
        contextMessage: normalItems[0].source || ''
      }, normalItems[0].url);
    }
  }

  await chrome.storage.local.set({
    lastItems: [...watchItems, ...normalItems.map(i => toHistoryEntry(i, discoveredAt))].slice(0, 5),
    watchNotifyState: nextWatchNotifyState
  });

  const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
  const updated = [...newEntries, ...history]
    .filter(i => isWithinHistoryWindow(i, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  await chrome.storage.local.set({ history: updated });
  await updateBadge();
}

async function checkWatchReminders() {
  const { history = [], watchNotifyState = {} } = await chrome.storage.local.get(['history', 'watchNotifyState']);
  const watchItems = history.filter(item => item.watchMatched && watchNotifyState[item.url]);
  if (watchItems.length === 0) return;
  const now = new Date().toISOString();
  const nextWatchNotifyState = { ...watchNotifyState };
  const notified = await sendWatchNotifications(watchItems, nextWatchNotifyState, now);
  if (notified.length > 0) {
    await chrome.storage.local.set({ watchNotifyState: nextWatchNotifyState, lastItems: notified.slice(0, 5) });
  }
}

async function manualPoll() {
  const { history = [], historyDays = DEFAULT_HISTORY_DAYS, feedMode = 'all' } = await chrome.storage.local.get(['history', 'historyDays', 'feedMode']);
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
    const url = notificationUrlMap[notificationId] || lastItems[0]?.url;
    if (url) {
      if (notificationId.startsWith('aihot-watch-')) {
        await markWatchViewed(url);
      }
      delete notificationUrlMap[notificationId];
      chrome.tabs.create({ url });
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollForUpdates().then(() => checkWatchReminders());
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
      const { feedMode = 'all', historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get(['feedMode', 'historyDays']);
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
  if (msg.type === 'markWatchViewed') {
    markWatchViewed(msg.urls || msg.url)
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
