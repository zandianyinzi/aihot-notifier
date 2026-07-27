const feedState = typeof importScripts === 'function'
  ? (importScripts('feed-state.js'), globalThis.FeedState)
  : require('./feed-state.js');
const { normalizeFeedMode, projectHistory } = feedState;

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
const CANONICAL_HISTORY_VERSION = 1;
const SUPPORTS_CONSISTENT_SELECTED_SNAPSHOT = false;
let notificationCounter = 0;
let stateMutationQueue = Promise.resolve();
let feedModeGeneration = 0;
let sourceSwitchGeneration = 0;
let canonicalHistoryMigrationPromise = null;

function runStateMutation(task) {
  const operation = stateMutationQueue.then(task, task);
  stateMutationQueue = operation.catch(() => {});
  return operation;
}

function ensureCanonicalHistoryMigration() {
  if (!canonicalHistoryMigrationPromise) {
    canonicalHistoryMigrationPromise = runStateMutation(async () => {
      const data = await chrome.storage.local.get(['canonicalHistoryVersion', 'history', 'feedMode']);
      if (Number(data.canonicalHistoryVersion || 0) >= CANONICAL_HISTORY_VERSION) return;
      const mode = normalizeFeedMode(data.feedMode);
      const history = (data.history || []).map(item => ({
        ...item,
        selected: mode === 'selected' ? true : item?.selected === true
      }));
      await chrome.storage.local.set({ history, canonicalHistoryVersion: CANONICAL_HISTORY_VERSION });
    });
  }
  return canonicalHistoryMigrationPromise;
}

function runMigratedStateMutation(task) {
  return ensureCanonicalHistoryMigration().then(() => runStateMutation(task));
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

function getDiscoveredAtAliases(item) {
  if (!item) return [];
  return [
    item.id ? `id:${item.id}` : '',
    item.permalink ? `permalink:${item.permalink}` : '',
    item.url ? `url:${item.url}` : ''
  ].filter(Boolean);
}

function buildDiscoveredAtByAlias(history, limit = Infinity) {
  const entries = new Map();
  const indexedHistory = Number.isFinite(limit) ? (history || []).slice(0, limit) : (history || []);
  indexedHistory.forEach(item => {
    const discoveredAt = item.discoveredAt || item.time || '';
    if (!discoveredAt || !Number.isFinite(new Date(discoveredAt).getTime())) return;
    const alias = getDiscoveredAtAliases(item)[0];
    if (!alias) return;
    const existing = entries.get(alias);
    if (!existing || new Date(discoveredAt) < new Date(existing)) entries.set(alias, discoveredAt);
  });
  return Object.fromEntries(entries);
}

function getKnownDiscoveredAt(item, discoveredAtByAlias, fallback) {
  const known = getDiscoveredAtAliases(item)
    .map(alias => discoveredAtByAlias?.[alias])
    .find(value => value && Number.isFinite(new Date(value).getTime()));
  return known || fallback;
}

function getLegacyExactIdDiscoveredAt(item, discoveredAtByAlias, fallback) {
  const known = item?.id ? discoveredAtByAlias?.[`id:${item.id}`] : '';
  return known && Number.isFinite(new Date(known).getTime()) ? known : fallback;
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
    selectedPresent: Object.prototype.hasOwnProperty.call(item, 'selected'),
    selected: item.selected === true,
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
  let skippedItems = 0;
  let termination = 'page-bound';
  const seenCursors = new Set();

  for (let page = 0; page < maxPages; page++) {
    let url = baseUrl || getApiUrl(normalizedMode);
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const response = getV1Page(await fetchItemsPage(url));
    const items = response.items.map(normalizeV1Item).filter(Boolean);
    skippedItems += response.items.length - items.length;
    allItems = allItems.concat(items);

    if (!response.hasMore) {
      termination = 'complete';
      break;
    }
    const oldest = items[items.length - 1];
    if (oldest && new Date(getNormalizedItemTime(oldest)).getTime() < cutoff) {
      termination = 'cutoff';
      break;
    }
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
  allItems.skippedItems = skippedItems;
  allItems.termination = termination;
  return allItems;
}

function isCompleteSelectedSnapshot(items, mode, supportsConsistentSnapshot = SUPPORTS_CONSISTENT_SELECTED_SNAPSHOT) {
  return supportsConsistentSnapshot === true &&
    normalizeFeedMode(mode) === 'selected' &&
    items?.termination === 'complete' &&
    Number(items?.skippedItems || 0) === 0 &&
    items?.truncated !== true;
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

function getIdentityAliases(item) {
  return [item?.permalink, item?.url].filter(Boolean);
}

function findAliasCandidates(history, item) {
  const aliases = new Set(getIdentityAliases(item));
  return (history || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => getIdentityAliases(candidate).some(alias => aliases.has(alias)))
    .map(({ index }) => index);
}

function findLegacyDuplicates(history, item, winnerIndex) {
  const aliasCandidates = findAliasCandidates(history, item);
  const candidates = aliasCandidates
    .filter(index => index !== winnerIndex && !history[index].id);
  const conflictingId = aliasCandidates
    .some(index => index !== winnerIndex && Boolean(history[index].id));
  return !conflictingId && candidates.length === 1 ? candidates : [];
}

function earliestIso(values) {
  return (values || [])
    .filter(value => value && Number.isFinite(new Date(value).getTime()))
    .sort((a, b) => new Date(a) - new Date(b))[0] || '';
}

function latestIso(values) {
  return (values || [])
    .filter(value => value && Number.isFinite(new Date(value).getTime()))
    .sort((a, b) => new Date(b) - new Date(a))[0] || '';
}

function findCanonicalMatch(history, item) {
  const exactIndex = item.id ? history.findIndex(candidate => candidate.id === item.id) : -1;
  if (exactIndex >= 0) {
    return { index: exactIndex, legacyIndexes: findLegacyDuplicates(history, item, exactIndex) };
  }
  const candidates = findAliasCandidates(history, item);
  return candidates.length === 1 && !history[candidates[0]].id
    ? { index: candidates[0], legacyIndexes: [] }
    : { index: -1, legacyIndexes: [] };
}

function mergeCanonicalItem(existing, incoming, { mode, discoveredAt }) {
  const knownDiscovery = earliestIso([existing?.discoveredAt, incoming.discoveredAt]) || discoveredAt;
  const selected = normalizeFeedMode(mode) === 'selected'
    ? true
    : incoming.selectedPresent ? incoming.selected === true : existing?.selected === true;
  const { selectedPresent, ...serverFields } = incoming;
  return { ...existing, ...serverFields, discoveredAt: knownDiscovery, selected };
}

function mergeWatchStates(states, item, watchRules) {
  const valid = (states || []).filter(Boolean);
  if (valid.length === 0) return null;
  const firstMatchedAt = earliestIso(valid.map(state => state.firstMatchedAt));
  const viewedAt = earliestIso(valid.map(state => state.viewedAt));
  const notifyCount = Math.max(0, ...valid.map(state => Number(state.notifyCount || 0)));
  const lastNotifiedAt = latestIso(valid.map(state => state.lastNotifiedAt));
  return {
    ruleIds: matchWatchRules(item, watchRules).map(rule => rule.id),
    firstMatchedAt,
    viewedAt,
    notifyCount,
    lastNotifiedAt,
    nextNotifyAt: viewedAt ? '' : getNextWatchNotifyAt(firstMatchedAt, notifyCount, lastNotifiedAt)
  };
}

function getSafeCanonicalAliases(history, canonicalIndexes, item) {
  const canonicalIndexSet = new Set(canonicalIndexes);
  const aliases = new Set([item?.id, ...canonicalIndexes.flatMap(index => getItemAliases(history[index])), ...getItemAliases(item)].filter(Boolean));
  return Array.from(aliases).filter(alias => {
    if (alias === item?.id) return true;
    return !history.some((candidate, index) =>
      !canonicalIndexSet.has(index) && getItemAliases(candidate).includes(alias));
  });
}

function coalesceApiItems(items) {
  const coalesced = [];
  const indexById = new Map();
  (items || []).forEach(item => {
    if (item?.id && indexById.has(item.id)) {
      coalesced[indexById.get(item.id)] = item;
      return;
    }
    if (item?.id) indexById.set(item.id, coalesced.length);
    coalesced.push(item);
  });
  return coalesced;
}

function upsertCanonicalItems(state, items, options = {}) {
  const mode = normalizeFeedMode(options.mode);
  const discoveredAt = options.discoveredAt || new Date().toISOString();
  const matchedAt = options.matchedAt || (typeof discoveredAt === 'string' ? discoveredAt : new Date().toISOString());
  const historyDays = Number(options.historyDays || DEFAULT_HISTORY_DAYS);
  const history = [...(state.history || [])];
  const readIds = new Set(state.readIds || []);
  const watchRules = state.watchRules || [];
  const watchNotifyState = { ...(state.watchNotifyState || {}) };
  const inserted = [];
  const updated = [];
  const newlyMatched = [];
  const insertedIndexByKey = new Map();
  const returnedCanonicalByKey = new Map();

  coalesceApiItems(items).forEach(item => {
    const match = findCanonicalMatch(history, item);
    const isInserted = match.index < 0;
    const canonicalIndexes = isInserted ? [] : [match.index, ...match.legacyIndexes];
    const existing = isInserted ? null : history[match.index];
    const absorbed = canonicalIndexes.map(index => history[index]).filter(Boolean);
    const itemDiscoveredAt = typeof discoveredAt === 'function' ? discoveredAt(item) : discoveredAt;
    const watchMatches = matchWatchRules(item, watchRules);
    const incomingEntry = {
      ...toHistoryEntry(item, itemDiscoveredAt, watchMatches, matchedAt),
      selectedPresent: item.selectedPresent
    };
    const existingForMerge = existing
      ? { ...existing, discoveredAt: earliestIso(absorbed.map(candidate => candidate.discoveredAt)) || existing.discoveredAt }
      : null;
    const canonical = mergeCanonicalItem(existingForMerge, incomingEntry, { mode, discoveredAt: itemDiscoveredAt });
    if (watchMatches.length === 0) {
      delete canonical.watchMatched;
      delete canonical.watchRuleIds;
      delete canonical.watchMatchedAt;
    }
    const priorMatchIds = new Set(existing?.watchRuleIds || []);
    const isNewlyMatched = !isInserted && watchMatches.length > 0 && watchMatches.some(rule => !priorMatchIds.has(rule.id));
    const safeAliases = getSafeCanonicalAliases(history, canonicalIndexes, canonical);
    const priorWatchStates = safeAliases.map(alias => watchNotifyState[alias]).filter(Boolean);
    const canonicalKey = getItemStateKey(canonical);

    if (priorWatchStates.length > 0) {
      watchNotifyState[canonicalKey] = mergeWatchStates(priorWatchStates, canonical, watchRules);
    } else if (isInserted && watchMatches.length > 0) {
      watchNotifyState[canonicalKey] = buildWatchStateForItem(null, canonical, watchMatches.map(rule => rule.id), matchedAt);
    }

    if (canonical.id && safeAliases.some(alias => readIds.has(alias))) readIds.add(canonical.id);
    safeAliases.forEach(alias => {
      if (alias !== canonicalKey) delete watchNotifyState[alias];
    });

    if (isInserted) {
      history.push(canonical);
      insertedIndexByKey.set(canonicalKey, inserted.length);
      inserted.push(canonical);
    } else {
      history[match.index] = canonical;
      [...match.legacyIndexes].sort((a, b) => b - a).forEach(index => history.splice(index, 1));
      if (insertedIndexByKey.has(canonicalKey)) {
        inserted[insertedIndexByKey.get(canonicalKey)] = canonical;
      } else if (isNewlyMatched) {
        newlyMatched.push(canonical);
      } else {
        updated.push(canonical);
      }
    }
    returnedCanonicalByKey.set(canonicalKey, canonical);
  });

  const returnedCanonicalItems = Array.from(returnedCanonicalByKey.values());

  if (mode === 'selected' && options.completeSelectedSnapshot === true) {
    const returnedIds = new Set(returnedCanonicalItems.map(item => item.id).filter(Boolean));
    history.forEach(item => {
      if (item.id && !returnedIds.has(item.id)) item.selected = false;
    });
  }

  const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
  const retainedHistory = history
    .filter(item => isWithinHistoryWindow(item, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  const retainedWatchNotifyState = options.retainUnmatchedWatchState
    ? watchNotifyState
    : pruneWatchNotifyState(retainedHistory, watchNotifyState);

  return {
    history: retainedHistory,
    readIds: Array.from(readIds),
    watchNotifyState: retainedWatchNotifyState,
    inserted,
    updated,
    newlyMatched
  };
}

function pruneWatchNotifyState(history, watchNotifyState) {
  const retainedAliases = new Set((history || []).flatMap(item => getItemAliases(item)));
  return Object.fromEntries(Object.entries(watchNotifyState || {})
    .filter(([key]) => retainedAliases.has(key)));
}

async function getPrunedStoredWatchNotifyState() {
  const { history = [], watchNotifyState = {} } = await chrome.storage.local.get(['history', 'watchNotifyState']);
  return pruneWatchNotifyState(history, watchNotifyState);
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
    return runMigratedStateMutation(() => clearNotificationUrlOnClosed(notificationId))
      .catch(e => console.warn('[AI HOT] failed to forget closed notification:', e));
  });
}


function getReadAllBefore(data) {
  return [data.readAllBefore, ...Object.values(data.readAllBeforeByMode || {})]
    .filter(value => value && Number.isFinite(new Date(value).getTime()))
    .reduce((latest, value) => !latest || new Date(value) > new Date(latest) ? value : latest, '');
}

async function advanceReadAllBefore(candidate = '', markWatchViewed = false) {
  const data = await chrome.storage.local.get(['readAllBefore', 'readAllBeforeByMode', 'watchNotifyState']);
  const readAllBefore = getReadAllBefore({
    ...data,
    readAllBeforeByMode: {
      ...(data.readAllBeforeByMode || {}),
      candidate
    }
  });
  const updates = {};
  if (readAllBefore !== (data.readAllBefore || '') || Object.keys(data.readAllBeforeByMode || {}).length > 0) {
    updates.readAllBefore = readAllBefore;
    updates.readAllBeforeByMode = {};
  }

  if (markWatchViewed) {
    const watchNotifyState = { ...(data.watchNotifyState || {}) };
    const candidateTime = new Date(candidate).getTime();
    Object.keys(watchNotifyState).forEach(alias => {
      const firstMatchedTime = new Date(watchNotifyState[alias].firstMatchedAt || 0).getTime();
      if (firstMatchedTime > candidateTime) return;
      watchNotifyState[alias] = { ...watchNotifyState[alias], viewedAt: watchNotifyState[alias].viewedAt || candidate };
    });
    updates.watchNotifyState = watchNotifyState;
  }

  if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
  return readAllBefore;
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

function toHistoryEntry(item, discoveredAt, watchMatches = [], watchMatchedAt = discoveredAt) {
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
    entry.watchMatchedAt = watchMatchedAt;
  }
  return entry;
}

async function migrateReadAllBefore() {
  await advanceReadAllBefore();
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
  return runMigratedStateMutation(pollForUpdatesInternal);
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
    readIds = [],
    watchRules = [],
    watchNotifyState = {},
    allFeedContinuation = {},
    feedMode
  } = await chrome.storage.local.get(['history', 'historyDays', 'readIds', 'watchRules', 'watchNotifyState', 'allFeedContinuation', 'feedMode']);

  if (typeof options.isCurrent === 'function' && !await options.isCurrent()) {
    return { skipped: true, updated: history, newEntries: [], watchNotificationsSent: 0 };
  }

  const resolveDiscoveredAt = item => {
    const match = findCanonicalMatch(history, item);
    if (match.index >= 0) {
      return earliestIso([match.index, ...match.legacyIndexes]
        .map(index => history[index]?.discoveredAt)) || discoveredAt;
    }
    return getLegacyExactIdDiscoveredAt(item, options.discoveredAtByAlias, discoveredAt);
  };
  const retainUnmatchedWatchState = options.retainUnmatchedWatchState === undefined
    ? normalizeFeedMode(feedMode) === 'all' && allFeedContinuation.active === true
    : options.retainUnmatchedWatchState === true;
  const persisted = upsertCanonicalItems({ history, readIds, watchRules, watchNotifyState }, items, {
    mode: feedMode,
    discoveredAt: resolveDiscoveredAt,
    matchedAt: discoveredAt,
    historyDays,
    retainUnmatchedWatchState
  });
  await chrome.storage.local.set({
    history: persisted.history,
    readIds: persisted.readIds,
    watchNotifyState: persisted.watchNotifyState,
    ...(options.storageUpdates || {})
  });
  const updated = persisted.history;
  const persistedWatchNotifyState = persisted.watchNotifyState;
  const watchItems = persisted.inserted.filter(item => item.watchMatched === true);
  const normalItems = persisted.inserted.filter(item => item.watchMatched !== true);

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
  return {
    updated,
    newEntries: persisted.inserted,
    inserted: persisted.inserted,
    updatedEntries: persisted.updated,
    newlyMatched: persisted.newlyMatched,
    watchNotifyState: persistedWatchNotifyState,
    watchNotificationsSent: notifiedWatchItems.length
  };
}

async function showNotification(items) {
  const result = await persistFetchedItems(items, { notify: true });
  return result.watchNotificationsSent;
}

async function checkWatchRemindersInternal(limit = MAX_WATCH_NOTIFICATIONS_PER_CYCLE) {
  if (limit <= 0) return 0;
  const { history = [], feedMode, watchRules = [], watchNotifyState = {} } = await chrome.storage.local.get(['history', 'feedMode', 'watchRules', 'watchNotifyState']);
  const watchItems = projectHistory(history, feedMode)
    .filter(item => getActiveWatchMatchIds(item, watchRules).length > 0 && findWatchState(watchNotifyState, item).state);
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
  return runMigratedStateMutation(() => checkWatchRemindersInternal(limit));
}

async function manualPollInternal() {
  await assertNotInBackoff();
  const {
    history = [],
    historyDays = DEFAULT_HISTORY_DAYS,
    readIds = [],
    feedMode,
    lastCheck = '',
    lastItemsPollAt = '',
    watchRules = [],
    watchNotifyState = {},
    allFeedContinuation = {}
  } = await chrome.storage.local.get(['history', 'historyDays', 'readIds', 'feedMode', 'lastCheck', 'lastItemsPollAt', 'watchRules', 'watchNotifyState', 'allFeedContinuation']);
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
    const persisted = upsertCanonicalItems({ history, readIds, watchRules, watchNotifyState }, allItems, {
      mode,
      discoveredAt,
      matchedAt: discoveredAt,
      historyDays,
      retainUnmatchedWatchState: mode === 'all' && allFeedContinuation.active === true
    });
    const merged = persisted.history;
    await chrome.storage.local.set({
      history: persisted.history,
      readIds: persisted.readIds,
      watchNotifyState: persisted.watchNotifyState,
      lastItems: persisted.inserted.slice(0, 5)
    });
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
  return runMigratedStateMutation(manualPollInternal);
}

async function updateBadge() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  const { history = [], readIds = [], historyDays = DEFAULT_HISTORY_DAYS, feedMode } = data;
  const readIdSet = new Set(readIds);
  const readAllBefore = getReadAllBefore(data);
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const projectedHistory = projectHistory(history, feedMode);
  const unread = projectedHistory.filter(i => {
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

function getSettledAllContinuationStatus(continuation, updates = {}) {
  const { discoveredAtByAlias, ...status } = continuation || {};
  return { ...status, ...updates };
}

async function recoverAllFeedContinuationStatus() {
  const { allFeedContinuation = {}, feedMode } = await chrome.storage.local.get(['allFeedContinuation', 'feedMode']);
  if (allFeedContinuation.active !== true) {
    if (Object.prototype.hasOwnProperty.call(allFeedContinuation, 'discoveredAtByAlias')) {
      await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(allFeedContinuation) });
    }
    return;
  }
  if (normalizeFeedMode(feedMode) !== 'all' || !allFeedContinuation.id || !allFeedContinuation.cursor) {
    const watchNotifyState = await getPrunedStoredWatchNotifyState();
    await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(allFeedContinuation, { active: false }), watchNotifyState });
    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    return;
  }
  const retryAt = new Date(allFeedContinuation.retryAt || 0).getTime();
  try {
    await chrome.alarms.create(ALL_CONTINUATION_ALARM_NAME, { when: retryAt > Date.now() ? retryAt : Date.now() });
  } catch (e) {
    console.warn('[AI HOT] failed to recover all feed continuation alarm:', e);
    const watchNotifyState = await getPrunedStoredWatchNotifyState();
    await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(allFeedContinuation, { active: false, retryAt: '' }), watchNotifyState });
    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
  }
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
      await chrome.alarms.create(ALL_CONTINUATION_ALARM_NAME, { when: retryAt });
      return { scheduled: true };
    });
    return !result.skipped;
  } catch (e) {
    const rollbackExpected = retryPersisted ? scheduled : expected;
    await commitAllContinuationMutation(generation, continuationId, rollbackExpected, async continuation => {
      const watchNotifyState = await getPrunedStoredWatchNotifyState();
      await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(continuation, { active: false, retryAt: '' }), watchNotifyState });
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
        const reachedPageLimit = response.hasMore && page === ALL_MAX_PAGES - 1;
        const terminal = !response.hasMore || reachedPageLimit;
        const continuationStatus = terminal
          ? getSettledAllContinuationStatus(continuation, { active: false, retryAt: '' })
          : { ...continuation, cursor: response.nextCursor, retryAttempts: 0, retryAt: '' };
        return persistFetchedItems(items, {
          notify: false,
          updateLastItems: false,
          discoveredAtByAlias: continuation.discoveredAtByAlias,
          retainUnmatchedWatchState: false,
          isCurrent: () => getActiveAllContinuation(generation, continuationId, expected),
          storageUpdates: {
            allFeedContinuation: continuationStatus,
            ...(terminal ? {
              lastCheck: new Date().toISOString(),
              failCount: 0,
              nextAllowedPollAt: '',
              ...(!response.hasMore ? { lastItemsPollAt: new Date().toISOString() } : {})
            } : {})
          }
        });
      });
      if (persisted.skipped) return;

      const reachedPageLimit = response.hasMore && page === ALL_MAX_PAGES - 1;
      if (!response.hasMore || reachedPageLimit) {
        await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
        await updateBadge();
        if (!response.hasMore && fingerprintProbe) saveDeferredAllFingerprintProbe(generation, fingerprintProbe, continuationId);
        return;
      }
      nextCursor = response.nextCursor;
      retryAttempts = 0;
      retryAt = '';
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
      const watchNotifyState = await getPrunedStoredWatchNotifyState();
      await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(continuation, { active: false, retryAt: '' }), watchNotifyState });
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
    const watchNotifyState = await getPrunedStoredWatchNotifyState();
    await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(allFeedContinuation, { active: false }), watchNotifyState });
    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    return;
  }
  const retryAt = new Date(allFeedContinuation.retryAt || 0).getTime();
  if (retryAt > Date.now()) {
    try {
      await chrome.alarms.create(ALL_CONTINUATION_ALARM_NAME, { when: retryAt });
    } catch (e) {
      console.warn('[AI HOT] failed to resume all feed continuation alarm:', e);
      const watchNotifyState = await getPrunedStoredWatchNotifyState();
      await chrome.storage.local.set({ allFeedContinuation: getSettledAllContinuationStatus(allFeedContinuation, { active: false, retryAt: '' }), watchNotifyState });
      await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    }
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

async function resetAndPollInternal(feedMode, generation) {
  await assertNotInBackoff();
  console.log(`[AI HOT] resetAndPoll feedMode=${feedMode}`);
  try {
    const { historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get('historyDays');
    const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
    const sinceTime = new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();
    const mode = normalizeFeedMode(feedMode);
    const allItems = await fetchItems({ mode, sinceTime, cutoff, maxPages: mode === 'all' ? 1 : getMaxPages(mode) });
    if (generation !== sourceSwitchGeneration) return { stale: true };
    const discoveredAt = new Date().toISOString();
    const hasContinuation = mode === 'all' && allItems.truncated && allItems.nextCursor;
    const fingerprintProbe = startFingerprintProbe(mode);
    const committed = await runStateMutation(async () => {
      if (generation !== sourceSwitchGeneration) return { stale: true };
      const {
        history: previousHistory = [],
        historyDays: committedHistoryDays = DEFAULT_HISTORY_DAYS,
        readIds = [],
        watchRules = [],
        watchNotifyState = {}
      } = await chrome.storage.local.get(['history', 'historyDays', 'readIds', 'watchRules', 'watchNotifyState']);
      if (generation !== sourceSwitchGeneration) return { stale: true };

      const canonical = upsertCanonicalItems({ history: previousHistory, readIds, watchRules, watchNotifyState }, allItems, {
        mode,
        discoveredAt,
        matchedAt: discoveredAt,
        historyDays: committedHistoryDays,
        completeSelectedSnapshot: isCompleteSelectedSnapshot(allItems, mode)
      });
      const watchItems = canonical.inserted.filter(item => item.watchMatched === true);
      const normalItems = canonical.inserted.filter(item => item.watchMatched !== true);
      const nextGeneration = feedModeGeneration + 1;
      const continuationId = getContinuationId();
      const continuation = hasContinuation
        ? { generation: nextGeneration, continuationId, cursor: allItems.nextCursor, fingerprintProbe }
        : null;
      if (generation !== sourceSwitchGeneration) return { stale: true };
      await chrome.storage.local.set({
        history: canonical.history,
        readIds: canonical.readIds,
        lastItems: [...watchItems, ...normalItems].slice(0, 5),
        watchNotifyState: pruneWatchNotifyState(canonical.history, canonical.watchNotifyState),
        feedMode: mode,
        allFeedContinuation: continuation
          ? getActiveAllContinuationStatus(allItems.nextCursor, continuationId)
          : { active: false },
        lastCheck: new Date().toISOString(),
        failCount: 0,
        nextAllowedPollAt: '',
        ...(!allItems.truncated ? { lastItemsPollAt: new Date().toISOString() } : {})
      });
      feedModeGeneration = nextGeneration;
      return { continuation, nextHistory: canonical.history, nextGeneration };
    });
    if (committed.stale) return committed;

    await chrome.alarms.clear(ALL_CONTINUATION_ALARM_NAME);
    await updateBadge();
    console.log(`[AI HOT] resetAndPoll done, ${committed.nextHistory.length} items from ${allItems.length} fetched`);
    if (committed.continuation) {
      continueAllFeed(committed.continuation);
    } else if (mode === 'all') {
      saveDeferredAllFingerprintProbe(committed.nextGeneration, fingerprintProbe);
    } else {
      void Promise.resolve(fingerprintProbe)
        .then(probe => runStateMutation(async () => {
          if (generation !== sourceSwitchGeneration) return;
          const { feedMode: committedMode } = await chrome.storage.local.get('feedMode');
          if (normalizeFeedMode(committedMode) !== mode) return;
          await saveFingerprintProbe(probe);
        }))
        .catch(e => console.warn('[AI HOT] deferred fingerprint save failed:', e));
    }
    return { stale: false };
  } catch (e) {
    if (generation !== sourceSwitchGeneration) return { stale: true };
    if (e.backoff) throw e;
    console.error(`[AI HOT] resetAndPoll error:`, e);
    await runStateMutation(() => recordApiFailure(e.response || e.status || 0));
    throw e;
  }
}

function resetAndPoll(feedMode) {
  const generation = ++sourceSwitchGeneration;
  return ensureCanonicalHistoryMigration()
    .then(() => resetAndPollInternal(feedMode, generation));
}

chrome.notifications.onClicked.addListener((notificationId) => runMigratedStateMutation(async () => {
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
    return runMigratedStateMutation(resumeAllFeedContinuation);
  }
  if (alarm.name === ALARM_NAME) {
    return runMigratedStateMutation(async () => {
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
      const {
        feedMode,
        historyDays = DEFAULT_HISTORY_DAYS,
        history = [],
        readIds = [],
        watchRules = [],
        watchNotifyState = {}
      } = await chrome.storage.local.get(['feedMode', 'historyDays', 'history', 'readIds', 'watchRules', 'watchNotifyState']);
      const mode = normalizeFeedMode(feedMode);
      const cutoff = Date.now() - Math.max(historyDays, MAX_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
      const allItems = await fetchItems({ mode, cutoff, maxPages: Math.min(getMaxPages(mode), SELECTED_MAX_PAGES) });
      const discoveredAt = new Date().toISOString();
      const canonical = upsertCanonicalItems({ history, readIds, watchRules, watchNotifyState }, allItems, {
        mode,
        discoveredAt,
        matchedAt: discoveredAt,
        historyDays
      });
      await chrome.storage.local.set({
        history: canonical.history,
        readIds: canonical.readIds,
        watchNotifyState: canonical.watchNotifyState
      });
    } catch (e) {
      console.warn('[AI HOT] failed to fetch initial items:', e);
    }
  }
  await chrome.storage.local.set({ lastCheck: new Date().toISOString() });
  await updateBadge();
  await setupAlarm();
}

chrome.runtime.onInstalled.addListener((details) => runMigratedStateMutation(() => handleInstalled(details)));

chrome.runtime.onStartup.addListener(() => runMigratedStateMutation(async () => {
  await recoverAllFeedContinuationStatus();
  await migrateReadAllBefore();
  await setupAlarm();
}));

void runMigratedStateMutation(recoverAllFeedContinuationStatus)
  .catch(e => console.warn('[AI HOT] failed to initialize canonical history:', e));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'configChanged') {
    runMigratedStateMutation(setupAlarm)
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
    runMigratedStateMutation(() => markWatchViewed(msg.urls || msg.url))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'markAllRead') {
    runMigratedStateMutation(async () => {
      if (!msg.readAllBefore || !Number.isFinite(new Date(msg.readAllBefore).getTime())) throw new Error('Invalid readAllBefore');
      return advanceReadAllBefore(msg.readAllBefore, true);
    })
      .then(readAllBefore => sendResponse({ ok: true, readAllBefore }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// 数据变化时自动更新 badge
chrome.storage.onChanged.addListener((changes) => {
  if (changes.history || changes.readIds || changes.readAllBefore || changes.readAllBeforeByMode || changes.feedMode) {
    runMigratedStateMutation(updateBadge)
      .catch(e => console.warn('[AI HOT] failed to update badge:', e));
  }
});

if (typeof module === 'object' && module.exports) {
  module.exports = { isCompleteSelectedSnapshot };
}
