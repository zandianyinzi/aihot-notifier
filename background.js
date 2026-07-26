const API_BASE = 'https://aihot.virxact.com/api/v1/items';
const API_WINDOW = '7d';
const API_LIMIT = 100;
const MAX_CURSOR_LENGTH = 1024;
const FINGERPRINT_URL = 'https://aihot.virxact.com/api/public/fingerprint';
const ALARM_NAME = 'aihot-poll';
const ALL_CONTINUATION_ALARM_NAME = 'aihot-all-continuation';
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
const ALL_CONTINUATION_MAX_429_RETRIES = 2;
const ALL_CONTINUATION_STATUS_TTL_MS = 15 * 60 * 1000;
const RETRY_AFTER_FALLBACK_MS = 45 * 1000;
const TEMPORARY_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const ITEMS_SAFETY_POLL_MS = 6 * 60 * 60 * 1000;
const WATCH_REMINDER_DELAYS = [0, 8 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
let notificationCounter = 0;
let stateMutationQueue = Promise.resolve();
let feedModeGeneration = 0;

function runStateMutation(task) {
  const operation = stateMutationQueue.then(task, task);
  stateMutationQueue = operation.catch(() => {});
  return operation;
}

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
  return `${API_BASE}?mode=${encodeURIComponent(normalizeFeedMode(mode))}&window=${API_WINDOW}&limit=${API_LIMIT}`;
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

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_e) {
    return false;
  }
}

function normalizeAttribution(attribution) {
  if (!attribution || typeof attribution !== 'object') return null;
  const name = typeof attribution.name === 'string' ? attribution.name : '';
  const url = typeof attribution.url === 'string' ? attribution.url : '';
  return name || url ? { name, url } : null;
}

function normalizeV1Item(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !item.title) return null;
  if (!item.source || typeof item.source !== 'object' || typeof item.source.name !== 'string' || !item.source.name) return null;
  if (!item.links || typeof item.links !== 'object') return null;

  const original = typeof item.links.original === 'string' ? item.links.original : '';
  const permalink = typeof item.links.aihot === 'string' ? item.links.aihot : '';
  const url = isHttpsUrl(original) ? original : (isHttpsUrl(permalink) ? permalink : '');
  if (!url) return null;

  return {
    ...item,
    source: item.source.name,
    url,
    permalink,
    titleEn: typeof item.originalTitle === 'string' ? item.originalTitle : '',
    attribution: normalizeAttribution(item.attribution)
  };
}

function getV1Page(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.items)) {
    throw new Error('Invalid API items response');
  }
  if (!json.page || typeof json.page !== 'object' || Array.isArray(json.page) || typeof json.page.hasMore !== 'boolean') {
    throw new Error('Invalid API page response');
  }

  const nextCursor = json.page.nextCursor;
  if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'string') {
    throw new Error('Invalid API cursor');
  }
  if (typeof nextCursor === 'string' && nextCursor.length > MAX_CURSOR_LENGTH) {
    throw new Error('API cursor is too long');
  }
  if (json.page.hasMore && !nextCursor) throw new Error('Missing API cursor');

  return { items: json.items, hasMore: json.page.hasMore, nextCursor: nextCursor || '' };
}

async function fetchItems({ mode, cutoff = -Infinity, maxPages = getMaxPages(mode), baseUrl = '' }) {
  const normalizedMode = normalizeFeedMode(mode);
  let allItems = [];
  let cursor = null;
  let truncated = false;
  let nextCursor = '';
  const seenCursors = new Set();

  for (let page = 0; page < maxPages; page++) {
    let url = baseUrl || getApiUrl(normalizedMode);
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const response = getV1Page(await fetchItemsPage(url));
    const items = response.items.map(normalizeV1Item).filter(Boolean);
    allItems = allItems.concat(items);

    if (!response.hasMore) break;
    const oldest = items[items.length - 1];
    if (oldest && new Date(getNormalizedItemTime(oldest)).getTime() < cutoff) break;
    if (page === maxPages - 1) {
      truncated = true;
      nextCursor = response.nextCursor;
      break;
    }
    if (seenCursors.has(response.nextCursor)) throw new Error('Repeated API cursor');
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
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
  return '';
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
  const nextNotifyAt = Object.prototype.hasOwnProperty.call(state, 'nextNotifyAt') ? state.nextNotifyAt : state.firstMatchedAt;
  const next = new Date(nextNotifyAt || 0).getTime();
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

function pruneWatchNotifyState(history, watchNotifyState) {
  const retainedAliases = new Set((history || []).flatMap(item => getItemAliases(item)));
  return Object.fromEntries(Object.entries(watchNotifyState || {})
    .filter(([key]) => retainedAliases.has(key)));
}

async function mergeAndPersistHistory(newEntries, history, historyDays, watchNotifyState = {}) {
  const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
  const updated = [...newEntries, ...history]
    .filter(i => isWithinHistoryWindow(i, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  const nextWatchNotifyState = pruneWatchNotifyState(updated, watchNotifyState);
  await chrome.storage.local.set({ history: updated, watchNotifyState: nextWatchNotifyState });
  return { history: updated, watchNotifyState: nextWatchNotifyState };
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
    return runStateMutation(() => clearNotificationUrlOnClosed(notificationId))
      .catch(e => console.warn('[AI HOT] failed to forget closed notification:', e));
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
    titleEn: item.titleEn || item.title_en || item.originalTitle || '',
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

async function pollForUpdatesInternal() {
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

function pollForUpdates() {
  return runStateMutation(pollForUpdatesInternal);
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

  if (typeof options.isCurrent === 'function' && !await options.isCurrent()) {
    return { skipped: true, updated: history, newEntries: [], watchNotificationsSent: 0 };
  }

  const { newEntries, watchItems, normalItems, nextWatchNotifyState } = buildHistoryEntriesWithWatch(items, history, watchRules, watchNotifyState, discoveredAt);
  const persisted = await mergeAndPersistHistory(newEntries, history, historyDays, nextWatchNotifyState);
  const updated = persisted.history;
  const persistedWatchNotifyState = persisted.watchNotifyState;

  const notifiedWatchItems = shouldNotify
    ? await sendWatchNotifications(watchItems, persistedWatchNotifyState, discoveredAt, watchNotificationLimit)
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

  const updates = { watchNotifyState: persistedWatchNotifyState };
  if (options.updateLastItems !== false) updates.lastItems = [...watchItems, ...normalItems].slice(0, 5);
  await chrome.storage.local.set(updates);

  await updateBadge();
  return { updated, newEntries, watchNotificationsSent: notifiedWatchItems.length };
}

async function showNotification(items) {
  const result = await persistFetchedItems(items, { notify: true });
  return result.watchNotificationsSent;
}

async function checkWatchRemindersInternal(limit = MAX_WATCH_NOTIFICATIONS_PER_CYCLE) {
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

function checkWatchReminders(limit = MAX_WATCH_NOTIFICATIONS_PER_CYCLE) {
  return runStateMutation(() => checkWatchRemindersInternal(limit));
}

async function manualPollInternal() {
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
    const persisted = await mergeAndPersistHistory(newEntries, history, historyDays, nextWatchNotifyState);
    const merged = persisted.history;
    await chrome.storage.local.set({ lastItems: [...watchItems, ...normalItems].slice(0, 5), watchNotifyState: persisted.watchNotifyState });
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

function manualPoll() {
  return runStateMutation(manualPollInternal);
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

async function isCurrentFeedModeGeneration(generation, mode) {
  if (generation !== null && generation !== undefined && generation !== feedModeGeneration) return false;
  const { feedMode } = await chrome.storage.local.get('feedMode');
  return (generation === null || generation === undefined || generation === feedModeGeneration) && normalizeFeedMode(feedMode) === normalizeFeedMode(mode);
}

function getContinuationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

function getActiveAllContinuationStatus(cursor, continuationId) {
  return {
    active: true,
    id: continuationId,
    cursor,
    retryAttempts: 0,
    retryAt: '',
    expiresAt: new Date(Date.now() + ALL_CONTINUATION_STATUS_TTL_MS).toISOString()
  };
}

async function recoverAllFeedContinuationStatus() {
  const { allFeedContinuation = {}, feedMode } = await chrome.storage.local.get(['allFeedContinuation', 'feedMode']);
  if (allFeedContinuation.active !== true) return;
  if (normalizeFeedMode(feedMode) !== 'all' || !allFeedContinuation.id || !allFeedContinuation.cursor) {
    await chrome.storage.local.set({ allFeedContinuation: { ...allFeedContinuation, active: false } });
    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    return;
  }
  const retryAt = new Date(allFeedContinuation.retryAt || 0).getTime();
  chrome.alarms.create(ALL_CONTINUATION_ALARM_NAME, { when: retryAt > Date.now() ? retryAt : Date.now() });
}

function startFingerprintProbe(mode) {
  return probeFingerprint(mode).catch(() => null);
}

function saveDeferredAllFingerprintProbe(generation, fingerprintProbe, continuationId = '') {
  void Promise.resolve(fingerprintProbe)
    .then(probe => runStateMutation(async () => {
      if (!probe || !await isCurrentFeedModeGeneration(generation, 'all')) return;
      if (continuationId) {
        const { allFeedContinuation = {} } = await chrome.storage.local.get('allFeedContinuation');
        if (allFeedContinuation.id !== continuationId) return;
      }
      await saveFingerprintProbe(probe);
    }))
    .catch(e => console.warn('[AI HOT] deferred fingerprint save failed:', e));
}

async function getActiveAllContinuation(generation, continuationId, expected = {}) {
  if (!await isCurrentFeedModeGeneration(generation, 'all')) return null;
  const { allFeedContinuation = {} } = await chrome.storage.local.get('allFeedContinuation');
  if (allFeedContinuation.active !== true || !allFeedContinuation.cursor || allFeedContinuation.id !== continuationId) return null;
  if (expected.cursor !== undefined && allFeedContinuation.cursor !== expected.cursor) return null;
  if (expected.retryAttempts !== undefined && Number(allFeedContinuation.retryAttempts || 0) !== Number(expected.retryAttempts || 0)) return null;
  if (expected.retryAt !== undefined && (allFeedContinuation.retryAt || '') !== (expected.retryAt || '')) return null;
  return allFeedContinuation;
}

async function commitAllContinuationMutation(generation, continuationId, expected, mutation) {
  return runStateMutation(async () => {
    const continuation = await getActiveAllContinuation(generation, continuationId, expected);
    if (!continuation) return { skipped: true };
    return mutation(continuation);
  });
}

async function scheduleAllContinuationRetry(generation, continuationId, expected, retryAfterMs) {
  const retryAt = Date.now() + retryAfterMs;
  const scheduled = {
    ...expected,
    retryAttempts: expected.retryAttempts + 1,
    retryAt: new Date(retryAt).toISOString()
  };
  let retryPersisted = false;
  try {
    const result = await commitAllContinuationMutation(generation, continuationId, expected, async continuation => {
      await chrome.storage.local.set({ allFeedContinuation: { ...continuation, retryAttempts: scheduled.retryAttempts, retryAt: scheduled.retryAt } });
      retryPersisted = true;
      chrome.alarms.create(ALL_CONTINUATION_ALARM_NAME, { when: retryAt });
      return { scheduled: true };
    });
    return !result.skipped;
  } catch (e) {
    const rollbackExpected = retryPersisted ? scheduled : expected;
    await commitAllContinuationMutation(generation, continuationId, rollbackExpected, async continuation => {
      await chrome.storage.local.set({ allFeedContinuation: { ...continuation, active: false, retryAt: '' } });
      await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    });
    throw e;
  }
}

async function continueAllFeedInternal({ generation, continuationId, cursor, retryAttempts = 0, retryAt = '', fingerprintProbe = null }) {
  let nextCursor = cursor;
  const seenCursors = new Set();

  try {
    for (let page = 1; page < ALL_MAX_PAGES && nextCursor; page++) {
      const expected = { cursor: nextCursor, retryAttempts, retryAt };
      if (!await getActiveAllContinuation(generation, continuationId, expected)) return;
      if (seenCursors.has(nextCursor)) throw new Error('Repeated API cursor');
      seenCursors.add(nextCursor);

      const url = `${getApiUrl('all')}&cursor=${encodeURIComponent(nextCursor)}`;
      const response = getV1Page(await fetchItemsPage(url));
      if (!await getActiveAllContinuation(generation, continuationId, expected)) return;

      const items = response.items.map(normalizeV1Item).filter(Boolean);
      const persisted = await commitAllContinuationMutation(generation, continuationId, expected, async continuation => {
        const result = await persistFetchedItems(items, {
          notify: false,
          updateLastItems: false,
          isCurrent: () => getActiveAllContinuation(generation, continuationId, expected)
        });
        if (!result.skipped && response.hasMore) {
          await chrome.storage.local.set({
            allFeedContinuation: { ...continuation, cursor: response.nextCursor, retryAttempts: 0, retryAt: '' }
          });
        }
        return result;
      });
      if (persisted.skipped) return;

      if (!response.hasMore) {
        const completed = await commitAllContinuationMutation(generation, continuationId, expected, async continuation => {
          await commitSuccessfulItemsPoll({ allFeedContinuation: { ...continuation, active: false, retryAt: '' } });
          await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
          await updateBadge();
          return { completed: true };
        });
        if (!completed.skipped && fingerprintProbe) saveDeferredAllFingerprintProbe(generation, fingerprintProbe, continuationId);
        return;
      }
      nextCursor = response.nextCursor;
      retryAttempts = 0;
      retryAt = '';
    }

    const expected = { cursor: nextCursor, retryAttempts, retryAt };
    if (await getActiveAllContinuation(generation, continuationId, expected)) {
      await commitAllContinuationMutation(generation, continuationId, expected, async continuation => {
        await chrome.storage.local.set({ allFeedContinuation: { ...continuation, active: false, retryAt: '' }, lastCheck: new Date().toISOString(), failCount: 0, nextAllowedPollAt: '' });
        await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
        await updateBadge();
      });
    }
  } catch (e) {
    const expected = { cursor: nextCursor, retryAttempts, retryAt };
    if (!await getActiveAllContinuation(generation, continuationId, expected)) return;
    const status = e.status || e.response?.status;
    const hasRetryAfter = Boolean(getResponseHeader(e.response, 'Retry-After'));
    if (status === 429 && hasRetryAfter && retryAttempts < ALL_CONTINUATION_MAX_429_RETRIES) {
      await scheduleAllContinuationRetry(generation, continuationId, expected, getRetryAfterMs(e.response, 429));
      return;
    }
    console.error('[AI HOT] all feed continuation error:', e);
    await commitAllContinuationMutation(generation, continuationId, expected, async continuation => {
      await incrementFailCount();
      await chrome.storage.local.set({ allFeedContinuation: { ...continuation, active: false, retryAt: '' } });
      await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    });
  }
}

function continueAllFeed(continuation) {
  void continueAllFeedInternal(continuation)
    .catch(e => console.error('[AI HOT] all feed continuation failed:', e));
}

async function resumeAllFeedContinuation() {
  const { allFeedContinuation = {}, feedMode } = await chrome.storage.local.get(['allFeedContinuation', 'feedMode']);
  if (normalizeFeedMode(feedMode) !== 'all' || allFeedContinuation.active !== true || !allFeedContinuation.id || !allFeedContinuation.cursor) {
    await chrome.storage.local.set({ allFeedContinuation: { ...allFeedContinuation, active: false } });
    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    return;
  }
  const retryAt = new Date(allFeedContinuation.retryAt || 0).getTime();
  if (retryAt > Date.now()) {
    chrome.alarms.create(ALL_CONTINUATION_ALARM_NAME, { when: retryAt });
    return;
  }
  continueAllFeed({
    generation: null,
    continuationId: allFeedContinuation.id,
    cursor: allFeedContinuation.cursor,
    retryAttempts: Number(allFeedContinuation.retryAttempts || 0),
    retryAt: allFeedContinuation.retryAt || ''
  });
}

async function resetAndPollInternal(feedMode) {
  await assertNotInBackoff();
  console.log(`[AI HOT] resetAndPoll feedMode=${feedMode}`);
  try {
    const { historyDays = DEFAULT_HISTORY_DAYS, watchRules = [], watchNotifyState = {} } = await chrome.storage.local.get(['historyDays', 'watchRules', 'watchNotifyState']);
    const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
    const sinceTime = new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();

    const mode = normalizeFeedMode(feedMode);
    const allItems = await fetchItems({ mode, sinceTime, cutoff, maxPages: mode === 'all' ? 1 : getMaxPages(mode) });
    const discoveredAt = new Date().toISOString();
    const { newEntries: history, watchItems, normalItems, nextWatchNotifyState } = buildHistoryEntriesWithWatch(allItems, [], watchRules, watchNotifyState, discoveredAt);
    const nextHistory = history
      .filter(i => isWithinHistoryWindow(i, cutoff))
      .sort((a, b) => getItemTime(b) - getItemTime(a));

    const fingerprintProbe = startFingerprintProbe(mode);
    const resetData = {
      history: nextHistory,
      lastItems: [...watchItems, ...normalItems].slice(0, 5),
      watchNotifyState: pruneWatchNotifyState(nextHistory, nextWatchNotifyState),
      feedMode: mode
    };
    const nextGeneration = feedModeGeneration + 1;
    const continuationId = getContinuationId();
    const continuation = mode === 'all' && allItems.truncated && allItems.nextCursor
      ? { generation: nextGeneration, continuationId, cursor: allItems.nextCursor, fingerprintProbe }
      : null;
    if (continuation) {
      await chrome.storage.local.set({
        ...resetData,
        allFeedContinuation: getActiveAllContinuationStatus(allItems.nextCursor, continuationId),
        lastCheck: new Date().toISOString(),
        failCount: 0,
        nextAllowedPollAt: ''
      });
      feedModeGeneration = nextGeneration;
    } else if (!allItems.truncated) {
      if (mode !== 'all') await saveFingerprintProbe(await fingerprintProbe);
      await commitSuccessfulItemsPoll({ ...resetData, allFeedContinuation: { active: false } });
      feedModeGeneration = nextGeneration;
      if (mode === 'all') {
        saveDeferredAllFingerprintProbe(nextGeneration, fingerprintProbe);
      }
    } else {
      await chrome.storage.local.set({ ...resetData, allFeedContinuation: { active: false }, lastCheck: new Date().toISOString(), failCount: 0, nextAllowedPollAt: '' });
      feedModeGeneration = nextGeneration;
    }
    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    await updateBadge();
    console.log(`[AI HOT] resetAndPoll done, ${nextHistory.length} items from ${allItems.length} fetched`);
    if (continuation) continueAllFeed(continuation);
  } catch (e) {
    if (e.backoff) throw e;
    console.error(`[AI HOT] resetAndPoll error:`, e);
    await recordApiFailure(e.response || e.status || 0);
    throw e;
  }
}

function resetAndPoll(feedMode) {
  return runStateMutation(() => resetAndPollInternal(feedMode));
}

chrome.notifications.onClicked.addListener((notificationId) => runStateMutation(async () => {
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
}));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALL_CONTINUATION_ALARM_NAME) {
    return runStateMutation(resumeAllFeedContinuation);
  }
  if (alarm.name === ALARM_NAME) {
    return runStateMutation(async () => {
      const result = await pollForUpdatesInternal();
      return checkWatchRemindersInternal(getCycleWatchNotificationBudget(result?.watchNotificationsSent || 0));
    });
  }
});

async function setupAlarm() {
  const config = await getConfig();
  await chrome.alarms.clear(ALARM_NAME);
  if (config.enabled) {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.1, periodInMinutes: config.interval });
  }
}

async function handleInstalled(details) {
  console.log(`[AI HOT] extension ${details.reason}`);
  await migrateReadAllBefore();
  if (details.reason === 'install') {
    try {
      const { feedMode, historyDays = DEFAULT_HISTORY_DAYS, history = [], watchNotifyState = {} } = await chrome.storage.local.get(['feedMode', 'historyDays', 'history', 'watchNotifyState']);
      const mode = normalizeFeedMode(feedMode);
      const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
      const allItems = await fetchItems({ mode, cutoff, maxPages: Math.min(getMaxPages(mode), SELECTED_MAX_PAGES) });
      const newEntries = filterNewApiItems(allItems, history)
        .map(i => toHistoryEntry(i, getNormalizedItemTime(i)));
      await mergeAndPersistHistory(newEntries, history, historyDays, watchNotifyState);
    } catch (e) {
      console.warn('[AI HOT] failed to fetch initial items:', e);
    }
  }
  await chrome.storage.local.set({ lastCheck: new Date().toISOString() });
  await updateBadge();
  await setupAlarm();
}

chrome.runtime.onInstalled.addListener((details) => runStateMutation(() => handleInstalled(details)));

chrome.runtime.onStartup.addListener(() => runStateMutation(async () => {
  await recoverAllFeedContinuationStatus();
  await migrateReadAllBefore();
  await setupAlarm();
}));

void runStateMutation(recoverAllFeedContinuationStatus);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'configChanged') {
    runStateMutation(setupAlarm)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
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
    runStateMutation(() => markWatchViewed(msg.urls || msg.url))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// 数据变化时自动更新 badge
chrome.storage.onChanged.addListener((changes) => {
  if (changes.history || changes.readIds || changes.readAllBefore || changes.readAllBeforeByMode || changes.feedMode) {
    runStateMutation(updateBadge)
      .catch(e => console.warn('[AI HOT] failed to update badge:', e));
  }
});
