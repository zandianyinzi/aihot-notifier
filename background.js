const API_BASE = 'https://aihot.virxact.com/api/public/items?take=100';
const FINGERPRINT_URL = 'https://aihot.virxact.com/api/public/fingerprint';
const ALARM_NAME = 'aihot-poll';
const DEFAULT_INTERVAL = 5;
const MIN_INTERVAL = 2;
const DEFAULT_HISTORY_DAYS = 2;
const MAX_HISTORY_DAYS = 5;
const AUTO_POLL_DELAY_BUFFER_MS = 6 * 60 * 60 * 1000;
const BADGE_COLOR = '#e2231a';
const MAX_WATCH_NOTIFICATIONS_PER_CYCLE = 3;
const SELECTED_MAX_PAGES = 3;
const ALL_MAX_PAGES = 20;
const MANUAL_MAX_PAGES = 3;
const PAGE_DELAY_MS = Number.isFinite(globalThis.__AIHOT_TEST_PAGE_DELAY_MS) ? globalThis.__AIHOT_TEST_PAGE_DELAY_MS : 1100;
const RETRY_AFTER_FALLBACK_MS = 45 * 1000;
const TEMPORARY_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const ITEMS_SAFETY_POLL_MS = 6 * 60 * 60 * 1000;
const WATCH_REMINDER_DELAYS = [0, 2 * 60 * 1000, 5 * 60 * 1000, 2 * 60 * 60 * 1000];
const WATCH_DAILY_REMINDER_MS = 24 * 60 * 60 * 1000;
let notificationCounter = 0;
async function getConfig() {
  const data = await chrome.storage.local.get(['enabled', 'interval', 'lastCheck', 'feedMode']);
  return {
    enabled: data.enabled !== false,
    interval: Math.max(Number(data.interval) || DEFAULT_INTERVAL, MIN_INTERVAL),
    lastCheck: data.lastCheck || new Date().toISOString(),
    feedMode: normalizeFeedMode(data.feedMode)
  };
}

function getApiUrl(mode) {
  return `${API_BASE}&mode=${mode}`;
}

function getMaxPages(mode) {
  return normalizeFeedMode(mode) === 'all' ? ALL_MAX_PAGES : SELECTED_MAX_PAGES;
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getResponseHeader(response, name) {
  if (!response || !response.headers) return '';
  if (typeof response.headers.get === 'function') return response.headers.get(name) || '';
  return response.headers[name] || response.headers[name.toLowerCase()] || '';
}

function getRetryAfterMs(response, status) {
  const retryAfter = getResponseHeader(response, 'Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = new Date(retryAfter).getTime();
    if (dateMs > Date.now()) return dateMs - Date.now();
  }
  if (status === 429) return RETRY_AFTER_FALLBACK_MS;
  if (status === 567 || (status >= 500 && status < 600)) return TEMPORARY_FAILURE_BACKOFF_MS;
  return 0;
}

async function recordApiFailure(responseOrStatus) {
  const status = typeof responseOrStatus === 'number' ? responseOrStatus : responseOrStatus?.status;
  await incrementFailCount();
  const backoffMs = getRetryAfterMs(responseOrStatus, status);
  if (backoffMs > 0) {
    await chrome.storage.local.set({ nextAllowedPollAt: new Date(Date.now() + backoffMs).toISOString() });
  }
}

function getItemKey(item) {
  if (!item) return '';
  if (item.id || item.permalink || item.url) return item.id || item.permalink || item.url;
  const time = item.publishedAt || item.time || item.indexedAt || '';
  return [item.source || '', item.title || '', time, item.summary || ''].join('|');
}

function getItemOpenUrl(item) {
  return item && (item.url || item.permalink || '');
}

function getItemStateKey(item) {
  return item && (item.id || item.permalink || item.url || '');
}

function getItemAliases(itemOrKey) {
  if (!itemOrKey) return [];
  if (typeof itemOrKey === 'string') return [itemOrKey].filter(Boolean);
  return [getItemStateKey(itemOrKey), itemOrKey.id, itemOrKey.permalink, itemOrKey.url]
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function getExistingItemKeys(history) {
  return new Set((history || []).flatMap(item => [getItemKey(item), item.id, item.url, item.permalink].filter(Boolean)));
}

function isSafetyItemsPollDue(lastItemsPollAt) {
  const last = new Date(lastItemsPollAt || 0).getTime();
  return !last || Date.now() - last >= ITEMS_SAFETY_POLL_MS;
}

function getAutoPollSinceTime(config, _safetyPollDue, lastItemsPollAt) {
  const bufferMs = Math.max(config.interval * 2 * 60 * 1000, AUTO_POLL_DELAY_BUFFER_MS);
  const referenceTime = lastItemsPollAt || config.lastCheck;
  return new Date(new Date(referenceTime).getTime() - bufferMs).toISOString();
}

function addItemKeys(keySet, item) {
  [item && getItemKey(item), item && item.url, item && item.permalink]
    .filter(Boolean)
    .forEach(key => keySet.add(key));
}

function isNewApiItem(item, existingKeys) {
  return !existingKeys.has(getItemKey(item)) && !existingKeys.has(item.url) && !existingKeys.has(item.permalink);
}

function filterNewApiItems(items, history) {
  const seenKeys = getExistingItemKeys(history);
  return (items || []).filter(item => {
    if (!isNewApiItem(item, seenKeys)) return false;
    addItemKeys(seenKeys, item);
    return true;
  });
}

async function probeFingerprint(mode) {
  const normalizedMode = normalizeFeedMode(mode);
  const { apiFingerprints = {}, apiFingerprintEtags = {} } = await chrome.storage.local.get(['apiFingerprints', 'apiFingerprintEtags']);
  const headers = {};
  if (apiFingerprints[normalizedMode] && apiFingerprintEtags.current) headers['If-None-Match'] = apiFingerprintEtags.current;

  const res = await fetch(FINGERPRINT_URL, Object.keys(headers).length > 0 ? { headers } : undefined);
  if (res.status === 304) {
    return { ok: true, changed: !apiFingerprints[normalizedMode], fingerprints: apiFingerprints, etag: apiFingerprintEtags.current || '' };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, response: res };
  }

  const json = await res.json();
  const nextFingerprint = json && json[normalizedMode];
  if (!nextFingerprint) {
    return { ok: true, changed: true, unavailable: true, fingerprints: apiFingerprints, etag: '' };
  }

  const etag = getResponseHeader(res, 'ETag');
  const changed = apiFingerprints[normalizedMode] !== nextFingerprint;
  return {
    ok: true,
    changed,
    fingerprints: {
      ...apiFingerprints,
      ...(json.selected ? { selected: json.selected } : {}),
      ...(json.all ? { all: json.all } : {})
    },
    etag
  };
}

async function saveFingerprintProbe(probe) {
  if (!probe || probe.unavailable) return;
  const data = {};
  if (probe.fingerprints) data.apiFingerprints = probe.fingerprints;
  if (probe.etag) {
    const { apiFingerprintEtags = {} } = await chrome.storage.local.get('apiFingerprintEtags');
    data.apiFingerprintEtags = { ...apiFingerprintEtags, current: probe.etag };
  }
  if (Object.keys(data).length > 0) await chrome.storage.local.set(data);
}

async function fetchItemsPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`API returned ${res.status}`), { response: res, status: res.status });
  return res.json();
}

async function fetchItems({ mode, sinceTime = '', cutoff = -Infinity, maxPages = getMaxPages(mode), baseUrl = '' }) {
  const normalizedMode = normalizeFeedMode(mode);
  let allItems = [];
  let cursor = null;
  let truncated = false;
  let nextCursor = '';

  for (let page = 0; page < maxPages; page++) {
    let url = baseUrl || getApiUrl(normalizedMode);
    if (sinceTime) url += `&since=${encodeURIComponent(sinceTime)}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const json = await fetchItemsPage(url);
    if (!json.items || json.items.length === 0) {
      truncated = Boolean(json.hasNext && json.nextCursor);
      nextCursor = json.nextCursor || '';
      break;
    }

    allItems = allItems.concat(json.items);

    if (!json.hasNext || !json.nextCursor) break;
    const oldest = json.items[json.items.length - 1];
    if (new Date(getNormalizedItemTime(oldest)).getTime() < cutoff) break;
    if (page === maxPages - 1) {
      truncated = true;
      nextCursor = json.nextCursor;
      break;
    }
    cursor = json.nextCursor;
    await sleep(PAGE_DELAY_MS);
  }

  allItems.truncated = truncated;
  allItems.nextCursor = nextCursor;
  return allItems;
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

function getActiveWatchMatchIds(historyItem, watchRules) {
  const normalizedRules = normalizeWatchRules(watchRules);
  if (!historyItem || !historyItem.watchMatched || !Array.isArray(historyItem.watchRuleIds) || historyItem.watchRuleIds.length === 0) {
    return [];
  }
  const activeRuleIds = new Set(normalizedRules.map(rule => rule.id));
  return historyItem.watchRuleIds.filter(ruleId => activeRuleIds.has(ruleId));
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
  const ruleLabel = parseSourceParts(item.source || '').authorText || item.source || '特关';
  return `特关：${ruleLabel}`;
}

async function rememberNotificationUrl(id, url) {
  if (!url) return;
  const { notificationUrlMap = {} } = await chrome.storage.local.get('notificationUrlMap');
  await chrome.storage.local.set({
    notificationUrlMap: {
      ...notificationUrlMap,
      [id]: url
    }
  });
}

async function rememberNotificationStateKey(id, key) {
  if (!key) return;
  const { notificationStateKeyMap = {} } = await chrome.storage.local.get('notificationStateKeyMap');
  await chrome.storage.local.set({
    notificationStateKeyMap: {
      ...notificationStateKeyMap,
      [id]: key
    }
  });
}

async function forgetNotificationUrl(id) {
  const { notificationUrlMap = {}, notificationStateKeyMap = {} } = await chrome.storage.local.get(['notificationUrlMap', 'notificationStateKeyMap']);
  if (!notificationUrlMap[id] && !notificationStateKeyMap[id]) return;
  const nextMap = { ...notificationUrlMap };
  const nextStateKeyMap = { ...notificationStateKeyMap };
  delete nextMap[id];
  delete nextStateKeyMap[id];
  await chrome.storage.local.set({ notificationUrlMap: nextMap, notificationStateKeyMap: nextStateKeyMap });
}

function getNotificationId(prefix) {
  notificationCounter = (notificationCounter + 1) % Number.MAX_SAFE_INTEGER;
  const randomPart = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${notificationCounter}`;
  return `${prefix}-${randomPart}`;
}

async function createNotification(id, options, url, stateKey = '') {
  await rememberNotificationUrl(id, url);
  await rememberNotificationStateKey(id, stateKey);
  try {
    await chrome.notifications.create(id, options);
  } catch (e) {
    await forgetNotificationUrl(id).catch(() => {});
    throw e;
  }
}

function findWatchState(watchNotifyState, item) {
  const aliases = getItemAliases(item);
  const key = aliases.find(alias => watchNotifyState[alias]);
  return {
    key: key || getItemStateKey(item),
    state: key ? watchNotifyState[key] : null
  };
}

async function sendWatchNotifications(items, watchNotifyState, now, limit = MAX_WATCH_NOTIFICATIONS_PER_CYCLE) {
  if (limit <= 0) return [];
  const nowMs = new Date(now).getTime();
  const dueItems = items
    .filter(item => shouldNotifyWatchState(findWatchState(watchNotifyState, item).state, nowMs))
    .sort((a, b) => getItemTime(b) - getItemTime(a))
    .slice(0, limit);

  for (let index = 0; index < dueItems.length; index++) {
    const item = dueItems[index];
    const { key, state } = findWatchState(watchNotifyState, item);
    const url = getItemOpenUrl(item);
    await createNotification(getNotificationId('aihot-watch'), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: getWatchNotificationTitle(item, state),
      message: item.title,
      contextMessage: item.source || ''
    }, url, key);
    watchNotifyState[key] = advanceWatchNotifyState(state, now);
  }

  return dueItems;
}

async function markWatchViewed(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  const filtered = list.filter(Boolean);
  if (filtered.length === 0) return;
  const { watchNotifyState = {} } = await chrome.storage.local.get('watchNotifyState');
  const now = new Date().toISOString();
  filtered.forEach(value => {
    const aliases = getItemAliases(value);
    aliases.forEach(alias => {
      if (watchNotifyState[alias]) {
        watchNotifyState[alias] = { ...watchNotifyState[alias], viewedAt: watchNotifyState[alias].viewedAt || now };
      }
    });
  });
  await chrome.storage.local.set({ watchNotifyState });
}

async function assertNotInBackoff() {
  const { nextAllowedPollAt = '' } = await chrome.storage.local.get('nextAllowedPollAt');
  if (nextAllowedPollAt && new Date(nextAllowedPollAt).getTime() > Date.now()) {
    throw Object.assign(new Error(`polling paused until ${nextAllowedPollAt}`), { backoff: true, nextAllowedPollAt });
  }
}

async function commitSuccessfulItemsPoll(data = {}) {
  const { now: providedNow, ...rest } = data;
  const now = providedNow || new Date().toISOString();
  await chrome.storage.local.set({
    ...rest,
    lastCheck: now,
    lastItemsPollAt: now,
    failCount: 0,
    nextAllowedPollAt: ''
  });
}

function buildHistoryEntriesWithWatch(items, history, watchRules, watchNotifyState, discoveredAt) {
  const newEntries = [];
  const watchItems = [];
  const normalItems = [];
  const nextWatchNotifyState = { ...watchNotifyState };

  filterNewApiItems(items, history)
    .forEach(item => {
      const watchMatches = matchWatchRules(item, watchRules);
      const entry = toHistoryEntry(item, discoveredAt, watchMatches);
      newEntries.push(entry);
      if (watchMatches.length > 0) {
        const key = getItemStateKey(entry);
        const existingState = getItemAliases(entry)
          .map(alias => nextWatchNotifyState[alias])
          .find(Boolean);
        nextWatchNotifyState[key] = buildWatchStateForItem(existingState, entry, watchMatches.map(rule => rule.id), discoveredAt);
        watchItems.push(entry);
      } else {
        normalItems.push(entry);
      }
    });

  return { newEntries, watchItems, normalItems, nextWatchNotifyState };
}

async function mergeAndPersistHistory(newEntries, history, historyDays) {
  const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
  const updated = [...newEntries, ...history]
    .filter(i => isWithinHistoryWindow(i, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  await chrome.storage.local.set({ history: updated });
  return updated;
}

function getNormalizedItemTime(item, discoveredAt) {
  return item.publishedAt || item.indexedAt || item.discoveredAt || discoveredAt || new Date().toISOString();
}

function getCycleWatchNotificationBudget(used = 0) {
  return Math.max(MAX_WATCH_NOTIFICATIONS_PER_CYCLE - used, 0);
}

async function clearNotificationUrlOnClosed(notificationId) {
  if (notificationId && notificationId.startsWith('aihot-')) {
    await forgetNotificationUrl(notificationId);
  }
}

if (chrome.notifications.onClosed && chrome.notifications.onClosed.addListener) {
  chrome.notifications.onClosed.addListener((notificationId) => {
    clearNotificationUrlOnClosed(notificationId).catch(e => console.warn('[AI HOT] failed to forget closed notification:', e));
  });
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
  return new Date(item.time || item.discoveredAt || 0).getTime();
}

function getUnreadReferenceTime(item) {
  return Math.max(getItemTime(item) || 0, new Date(item.discoveredAt || item.time).getTime() || 0);
}

function isWithinHistoryWindow(item, cutoff) {
  return getUnreadReferenceTime(item) > cutoff;
}

function toHistoryEntry(item, discoveredAt, watchMatches = []) {
  const normalizedTime = getNormalizedItemTime(item, discoveredAt);
  const entry = {
    title: item.title,
    id: item.id || '',
    titleEn: item.title_en || '',
    url: getItemOpenUrl(item),
    permalink: item.permalink || item.url || '',
    source: item.source || '',
    category: item.category || '',
    summary: item.summary || '',
    score: item.score ?? null,
    selected: item.selected === true,
    attribution: item.attribution || null,
    time: normalizedTime,
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

  const { nextAllowedPollAt = '', lastItemsPollAt = '' } = await chrome.storage.local.get(['nextAllowedPollAt', 'lastItemsPollAt']);
  if (nextAllowedPollAt && new Date(nextAllowedPollAt).getTime() > Date.now()) {
    console.log(`[AI HOT] polling paused until ${nextAllowedPollAt}`);
    return;
  }

  const now = new Date().toISOString();

  try {
    const fingerprintProbe = await probeFingerprint(config.feedMode);
    if (!fingerprintProbe.ok) {
      console.warn(`[AI HOT] fingerprint returned ${fingerprintProbe.status}`);
      await recordApiFailure(fingerprintProbe.response || fingerprintProbe.status);
      return;
    }
    const safetyPollDue = isSafetyItemsPollDue(lastItemsPollAt);
    const sinceTime = getAutoPollSinceTime(config, safetyPollDue, lastItemsPollAt);
    console.log(`[AI HOT] polling since=${sinceTime}`);
    if (!fingerprintProbe.changed && !safetyPollDue) {
      await saveFingerprintProbe(fingerprintProbe);
      await chrome.storage.local.set({ lastCheck: now, failCount: 0, nextAllowedPollAt: '' });
      await updateBadge();
      console.log('[AI HOT] fingerprint unchanged, skip items');
      return;
    }

    const cutoff = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const allItems = await fetchItems({ mode: config.feedMode, sinceTime, cutoff });
    const newWatchNotifications = await persistFetchedItems(allItems, { notify: true });
    console.log(`[AI HOT] got ${allItems.length} items`);

    if (!allItems.truncated) {
      await saveFingerprintProbe(fingerprintProbe);
      await commitSuccessfulItemsPoll({ now });
    } else {
      await chrome.storage.local.set({ lastCheck: now, failCount: 0, nextAllowedPollAt: '' });
    }
    return { watchNotificationsSent: newWatchNotifications, truncated: Boolean(allItems.truncated) };
  } catch (e) {
    console.error(`[AI HOT] fetch error:`, e);
    await recordApiFailure(e.response || e.status || 0);
    return { error: e };
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

async function persistFetchedItems(items, options = {}) {
  const shouldNotify = options.notify === true;
  const watchNotificationLimit = Number.isFinite(options.watchNotificationLimit)
    ? options.watchNotificationLimit
    : MAX_WATCH_NOTIFICATIONS_PER_CYCLE;
  const discoveredAt = new Date().toISOString();
  const {
    history = [],
    historyDays = DEFAULT_HISTORY_DAYS,
    watchRules = [],
    watchNotifyState = {}
  } = await chrome.storage.local.get(['history', 'historyDays', 'watchRules', 'watchNotifyState']);

  const { newEntries, watchItems, normalItems, nextWatchNotifyState } = buildHistoryEntriesWithWatch(items, history, watchRules, watchNotifyState, discoveredAt);
  const updated = await mergeAndPersistHistory(newEntries, history, historyDays);

  const notifiedWatchItems = shouldNotify
    ? await sendWatchNotifications(watchItems, nextWatchNotifyState, discoveredAt, watchNotificationLimit)
    : [];

  if (shouldNotify && normalItems.length > 0) {
    const count = normalItems.length;
    const notifId = getNotificationId('aihot');

    if (count === 1) {
      await createNotification(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'AI HOT 新内容',
        message: normalItems[0].title,
        contextMessage: normalItems[0].source || ''
      }, getItemOpenUrl(normalItems[0]));
    } else {
      await createNotification(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `AI HOT 有 ${count} 条新内容`,
        message: normalItems[0].title,
        contextMessage: normalItems[0].source || ''
      }, getItemOpenUrl(normalItems[0]));
    }
  }

  await chrome.storage.local.set({
    lastItems: [...watchItems, ...normalItems].slice(0, 5),
    watchNotifyState: nextWatchNotifyState
  });

  await updateBadge();
  return { updated, newEntries, watchNotificationsSent: notifiedWatchItems.length };
}

async function showNotification(items) {
  const result = await persistFetchedItems(items, { notify: true });
  return result.watchNotificationsSent;
}

async function checkWatchReminders(limit = MAX_WATCH_NOTIFICATIONS_PER_CYCLE) {
  if (limit <= 0) return 0;
  const { history = [], watchRules = [], watchNotifyState = {} } = await chrome.storage.local.get(['history', 'watchRules', 'watchNotifyState']);
  const watchItems = history.filter(item => getActiveWatchMatchIds(item, watchRules).length > 0 && findWatchState(watchNotifyState, item).state);
  if (watchItems.length === 0) return;
  const now = new Date().toISOString();
  const nextWatchNotifyState = { ...watchNotifyState };
  const notified = await sendWatchNotifications(watchItems, nextWatchNotifyState, now, limit);
  if (notified.length > 0) {
    await chrome.storage.local.set({ watchNotifyState: nextWatchNotifyState, lastItems: notified.slice(0, 5) });
  }
  return notified.length;
}

async function manualPoll() {
  await assertNotInBackoff();
  const { history = [], historyDays = DEFAULT_HISTORY_DAYS, feedMode, lastCheck = '', lastItemsPollAt = '' } = await chrome.storage.local.get(['history', 'historyDays', 'feedMode', 'lastCheck', 'lastItemsPollAt']);
  const mode = normalizeFeedMode(feedMode);
  const now = new Date().toISOString();

  try {
    const fingerprintProbe = await probeFingerprint(mode);
    if (!fingerprintProbe.ok) {
      console.warn(`[AI HOT] manual fingerprint returned ${fingerprintProbe.status}`);
      throw Object.assign(new Error(`API returned ${fingerprintProbe.status}`), { response: fingerprintProbe.response, status: fingerprintProbe.status });
    }

    if (!fingerprintProbe.changed) {
      await saveFingerprintProbe(fingerprintProbe);
      await chrome.storage.local.set({ lastCheck: now, failCount: 0, nextAllowedPollAt: '' });
      await updateBadge();
      console.log('[AI HOT] manual fingerprint unchanged, skip items');
      return;
    }

    const sinceTime = getAutoPollSinceTime({ interval: DEFAULT_INTERVAL, lastCheck: lastCheck || now }, false, lastItemsPollAt);
    console.log(`[AI HOT] manual poll since=${sinceTime}`);
    const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
    const allItems = await fetchItems({ mode, sinceTime, cutoff, maxPages: MANUAL_MAX_PAGES });
    const discoveredAt = new Date().toISOString();
    const { watchRules = [], watchNotifyState = {} } = await chrome.storage.local.get(['watchRules', 'watchNotifyState']);
    const { newEntries, watchItems, normalItems, nextWatchNotifyState } = buildHistoryEntriesWithWatch(allItems, history, watchRules, watchNotifyState, discoveredAt);
    const merged = await mergeAndPersistHistory(newEntries, history, historyDays);
    await chrome.storage.local.set({ lastItems: [...watchItems, ...normalItems].slice(0, 5), watchNotifyState: nextWatchNotifyState });
    if (allItems.truncated) {
      await chrome.storage.local.set({ lastCheck: new Date().toISOString(), failCount: 0, nextAllowedPollAt: '' });
    } else {
      await saveFingerprintProbe(fingerprintProbe);
      await commitSuccessfulItemsPoll();
    }
    await updateBadge();
    console.log(`[AI HOT] manual poll done, ${merged.length} total items (fetched ${allItems.length})`);
  } catch (e) {
    if (e.backoff) throw e;
    console.error(`[AI HOT] manual poll error:`, e);
    await recordApiFailure(e.response || e.status || 0);
    throw e;
  }
}

async function updateBadge() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  const { history = [], readIds = [], historyDays = DEFAULT_HISTORY_DAYS } = data;
  const readIdSet = new Set(readIds);
  const readAllBefore = getReadAllBeforeForMode(data);
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const unread = history.filter(i => {
    if (!isWithinHistoryWindow(i, cutoff)) return false;
    if (getItemAliases(i).some(alias => readIdSet.has(alias))) return false;
    if (readAllBefore && getUnreadReferenceTime(i) <= new Date(readAllBefore).getTime()) return false;
    return true;
  }).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

async function resetAndPoll(feedMode) {
  await assertNotInBackoff();
  console.log(`[AI HOT] resetAndPoll feedMode=${feedMode}`);
  try {
    const { historyDays = DEFAULT_HISTORY_DAYS, watchRules = [], watchNotifyState = {} } = await chrome.storage.local.get(['historyDays', 'watchRules', 'watchNotifyState']);
    const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
    const sinceTime = new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();

    const allItems = await fetchItems({ mode: feedMode, sinceTime, cutoff });
    const discoveredAt = new Date().toISOString();
    const { newEntries: history, watchItems, normalItems, nextWatchNotifyState } = buildHistoryEntriesWithWatch(allItems, [], watchRules, watchNotifyState, discoveredAt);
    const nextHistory = history
      .filter(i => isWithinHistoryWindow(i, cutoff))
      .sort((a, b) => getItemTime(b) - getItemTime(a));

    const fingerprintProbe = await probeFingerprint(feedMode).catch(() => null);
    const resetData = {
      history: nextHistory,
      lastItems: [...watchItems, ...normalItems].slice(0, 5),
      watchNotifyState: nextWatchNotifyState,
      feedMode: normalizeFeedMode(feedMode)
    };
    if (!allItems.truncated) {
      await saveFingerprintProbe(fingerprintProbe);
      await commitSuccessfulItemsPoll(resetData);
    } else {
      await chrome.storage.local.set({ ...resetData, lastCheck: new Date().toISOString(), failCount: 0, nextAllowedPollAt: '' });
    }
    await updateBadge();
    console.log(`[AI HOT] resetAndPoll done, ${nextHistory.length} items from ${allItems.length} fetched`);
  } catch (e) {
    if (e.backoff) throw e;
    console.error(`[AI HOT] resetAndPoll error:`, e);
    await recordApiFailure(e.response || e.status || 0);
    throw e;
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('aihot-')) {
    const { lastItems = [], notificationUrlMap = {}, notificationStateKeyMap = {} } = await chrome.storage.local.get(['lastItems', 'notificationUrlMap', 'notificationStateKeyMap']);
    const url = notificationUrlMap[notificationId] || lastItems[0]?.url;
    if (url) {
      if (notificationId.startsWith('aihot-watch-')) {
        await markWatchViewed([notificationStateKeyMap[notificationId], url]);
      }
      await forgetNotificationUrl(notificationId);
      await chrome.tabs.create({ url });
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    return pollForUpdates().then((result = {}) => checkWatchReminders(getCycleWatchNotificationBudget(result.watchNotificationsSent || 0)));
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
      const { feedMode, historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get(['feedMode', 'historyDays']);
      const mode = normalizeFeedMode(feedMode);
      const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
      const allItems = await fetchItems({ mode, cutoff, maxPages: Math.min(getMaxPages(mode), SELECTED_MAX_PAGES) });

      if (allItems.length > 0) {
        const { history = [] } = await chrome.storage.local.get('history');
        const newEntries = filterNewApiItems(allItems, history)
          .map(i => toHistoryEntry(i, getNormalizedItemTime(i)));
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
