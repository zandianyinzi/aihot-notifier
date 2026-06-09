const enabledEl = document.getElementById('enabled');
const intervalEl = document.getElementById('interval');
const feedModeEl = document.getElementById('feedMode');
const themeEl = document.getElementById('theme');
const fontFamilyEl = document.getElementById('fontFamily');
const fontSizeEl = document.getElementById('fontSize');
const historyDaysEl = document.getElementById('historyDays');
const markAllReadBtn = document.getElementById('markAllRead');
const pollBtn = document.getElementById('pollNow');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const historyList = document.getElementById('historyList');
const unreadCountEl = document.getElementById('unreadCount');

const CATEGORY_MAP = {
  'ai-models': { cls: 'cat-model', label: '模型' },
  'model': { cls: 'cat-model', label: '模型' },
  'ai-products': { cls: 'cat-products', label: '产品' },
  'industry': { cls: 'cat-industry', label: '行业' },
  'paper': { cls: 'cat-paper', label: '论文' },
  'tip': { cls: 'cat-tips', label: '技巧' },
  'tips': { cls: 'cat-tips', label: '技巧' }
};

const VALID_THEMES = new Set(['dark', 'green-dark']);
const DEFAULT_HISTORY_DAYS = 2;
const POPUP_CACHE_KEY = 'popupDataSnapshot';
const POPUP_SESSION_KEY = 'popupWarmSession';
const POPUP_CACHE_VERSION = 3;
const POPUP_CACHE_TTL_MS = 5 * 60 * 1000;
const BUTTON_RESULT_CLASSES = ['is-result-accent', 'is-result-danger', 'is-result-ok'];
const BUTTON_TRANSIENT_CLASSES = ['is-loading', ...BUTTON_RESULT_CLASSES];
const BUTTON_RESULT_MIN_MS = 600;
const BUTTON_RESULT_MAX_MS = 1400;
const BUTTON_RESULT_TARGET_TOTAL_MS = 1800;

let cachedReadIds = new Set();
let lastRenderSignature = '';

function clearButtonFeedback(button) {
  button.classList.remove(...BUTTON_TRANSIENT_CLASSES);
  button.style.removeProperty('--control-result-duration');
}

function getButtonResultDuration(elapsedMs) {
  if (!Number.isFinite(elapsedMs)) return BUTTON_RESULT_MAX_MS;
  return Math.round(Math.max(
    BUTTON_RESULT_MIN_MS,
    Math.min(BUTTON_RESULT_MAX_MS, BUTTON_RESULT_TARGET_TOTAL_MS - elapsedMs)
  ));
}

function removeClassAfterAnimation(button, className, onCleanup) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    button.classList.remove(className);
    if (onCleanup) onCleanup();
  };

  button.addEventListener('animationend', cleanup, { once: true });
  requestAnimationFrame(() => {
    if (getComputedStyle(button).animationName === 'none') cleanup();
  });
}

function showButtonResult(button, className, elapsedMs) {
  button.classList.remove(...BUTTON_TRANSIENT_CLASSES);
  button.style.setProperty('--control-result-duration', `${getButtonResultDuration(elapsedMs)}ms`);
  button.classList.add(className);
  removeClassAfterAnimation(button, className, () => {
    button.style.removeProperty('--control-result-duration');
  });
}

function showButtonConfirm(button) {
  button.classList.remove('is-confirmed');
  // Restart the short confirmation pulse if this state is applied again quickly.
  void button.offsetWidth;
  button.classList.add('is-confirmed');
  removeClassAfterAnimation(button, 'is-confirmed');
}

function readPopupCache() {
  try {
    const raw = localStorage.getItem(POPUP_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw);
    if (!cached || cached.version !== POPUP_CACHE_VERSION || !cached.data) return null;
    if (cached.extensionVersion !== chrome.runtime.getManifest().version) return null;
    if (!cached.cachedAt || Date.now() - cached.cachedAt > POPUP_CACHE_TTL_MS) return null;
    return cached.data;
  } catch (_e) {
    localStorage.removeItem(POPUP_CACHE_KEY);
    return null;
  }
}

async function readWarmPopupCache() {
  if (!chrome.storage.session) return null;

  try {
    const data = await chrome.storage.session.get(POPUP_SESSION_KEY);
    const session = data[POPUP_SESSION_KEY];
    if (!session || session.extensionVersion !== chrome.runtime.getManifest().version) return null;
    return readPopupCache();
  } catch (_e) {
    return null;
  }
}

async function markPopupSessionWarm() {
  if (!chrome.storage.session) return;

  try {
    await chrome.storage.session.set({
      [POPUP_SESSION_KEY]: {
        extensionVersion: chrome.runtime.getManifest().version,
        warmedAt: Date.now()
      }
    });
  } catch (_e) {
    // Session cache is an optimization only.
  }
}

function writePopupCache(partialData) {
  try {
    const previous = readPopupCache() || {};
    localStorage.setItem(POPUP_CACHE_KEY, JSON.stringify({
      version: POPUP_CACHE_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
      cachedAt: Date.now(),
      data: {
        ...previous,
        ...partialData
      }
    }));
  } catch (_e) {
    // Keep popup rendering fast even if localStorage is full or unavailable.
  }
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function getDateLabel(isoStr) {
  const d = new Date(isoStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return '今天';
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function getCategory(category) {
  if (!category) return { cls: 'cat-default', label: '' };
  if (CATEGORY_MAP[category]) return CATEGORY_MAP[category];
  return { cls: 'cat-default', label: '' };
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeTheme(theme) {
  return VALID_THEMES.has(theme) ? theme : 'dark';
}

function normalizeFeedMode(mode) {
  return mode === 'all' ? 'all' : 'selected';
}

function getReadAllBeforeForMode(data) {
  const mode = normalizeFeedMode(data.feedMode);
  const byMode = data.readAllBeforeByMode || {};
  return byMode[mode] || data.readAllBefore || '';
}

function mergeReadIds(current = [], cached = []) {
  const merged = [...new Set([...current, ...cached])];
  return merged.length > 100 ? merged.slice(merged.length - 100) : merged;
}

function sameStringArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function reconcileCachedReadIds(data, cachedData) {
  if (!cachedData || !cachedData.readIds) return { data, changed: false };

  const mergedReadIds = mergeReadIds(data.readIds || [], cachedData.readIds || []);
  if (sameStringArray(mergedReadIds, data.readIds || [])) {
    return { data, changed: false };
  }

  return {
    data: {
      ...data,
      readIds: mergedReadIds
    },
    changed: true
  };
}

async function migrateReadAllBefore(data) {
  if (!data.readAllBefore) return;

  const mode = normalizeFeedMode(data.feedMode);
  await chrome.storage.local.set({
    readAllBeforeByMode: {
      ...(data.readAllBeforeByMode || {}),
      [mode]: data.readAllBefore
    },
    readAllBefore: ''
  });
  data.readAllBeforeByMode = {
    ...(data.readAllBeforeByMode || {}),
    [mode]: data.readAllBefore
  };
  data.readAllBefore = '';
}

function applyTheme(theme) {
  theme = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function applyFontSize(size) {
  document.documentElement.setAttribute('data-size', size);
  localStorage.setItem('fontSize', size);
}

function applyFontFamily(font) {
  document.documentElement.setAttribute('data-font', font);
  localStorage.setItem('fontFamily', font);
}

function applyConfig(data) {
  enabledEl.checked = data.enabled !== false;
  let interval = data.interval || 5;
  if (interval < 2) interval = 2;
  intervalEl.value = String(interval);
  feedModeEl.value = normalizeFeedMode(data.feedMode);
  const theme = normalizeTheme(data.theme);
  themeEl.value = theme;
  applyTheme(theme);
  const font = data.fontFamily || 'noto-sans';
  fontFamilyEl.value = font;
  applyFontFamily(font);
  const size = data.fontSize || 'medium';
  fontSizeEl.value = size;
  applyFontSize(size);
  let days = data.historyDays || DEFAULT_HISTORY_DAYS;
  if (days > 5) days = 5;
  historyDaysEl.value = String(days);
}

function getRenderSignature(history, readIdSet, readAllBeforeTime, historyDays) {
  return JSON.stringify({
    historyDays,
    items: history.map(item => [
      item.url,
      item.time,
      item.title,
      item.source || '',
      item.category || '',
      item.summary || '',
      getDateLabel(item.time),
      isReadFast(item, readIdSet, readAllBeforeTime) ? 1 : 0
    ])
  });
}

function renderHistory(data, options = {}) {
  const shouldUpdateBadge = options.updateBadge !== false;
  const skipUnchanged = options.skipUnchanged !== false;
  const shouldScrollToFirstUnread = options.scrollToFirstUnread === true;
  const rawHistory = data.history || [];
  const readIds = data.readIds || [];
  const readAllBefore = getReadAllBeforeForMode(data);
  const historyDays = data.historyDays || DEFAULT_HISTORY_DAYS;

  const readIdSet = new Set(readIds);
  cachedReadIds = readIdSet;
  const readAllBeforeTime = readAllBefore ? new Date(readAllBefore).getTime() : 0;

  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const history = rawHistory.filter(i => new Date(i.time).getTime() > cutoff);
  const signature = getRenderSignature(history, readIdSet, readAllBeforeTime, historyDays);

  if (skipUnchanged && signature === lastRenderSignature) {
    if (shouldUpdateBadge) updateBadgeFromData(history, readIdSet, readAllBeforeTime);
    if (shouldScrollToFirstUnread) scrollToFirstUnread();
    return;
  }

  if (history.length === 0) {
    const tip = rawHistory.length > 0
      ? `当前${historyDays}天内无记录，记录会随轮询逐步积累`
      : '暂无内容，等待下一次推送';
    historyList.innerHTML = `<div class="empty-state">${tip}</div>`;
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
    if (shouldUpdateBadge) updateBadgeFromData(history, cachedReadIds, readAllBeforeTime);
    lastRenderSignature = signature;
    return;
  }

  const unread = history.filter(i => !isReadFast(i, readIdSet, readAllBeforeTime)).length;
  if (unread > 0) {
    unreadCountEl.textContent = `${unread} 条未读`;
    unreadCountEl.classList.add('show');
    markAllReadBtn.classList.add('visible');
  } else {
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
  }

  const groups = {};
  history.forEach(item => {
    const label = getDateLabel(item.time);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  });

  let html = '';
  Object.entries(groups).forEach(([dateLabel, items]) => {
    html += `<div class="date-label">${dateLabel}</div>`;
    items.forEach(item => {
      const isUnread = !isReadFast(item, cachedReadIds, readAllBeforeTime);
      const cat = getCategory(item.category);
      const title = escapeHtml(item.title);
      const source = escapeHtml(item.source || '');
      const tagHtml = cat.label ? `<span class="cat-tag ${cat.cls}">${cat.label}</span>` : '';
      const summary = escapeHtml(item.summary || '');
      const summaryHtml = summary ? `<div class="item-summary">${summary}</div>` : '';
      html += `<div class="item ${isUnread ? 'unread' : 'read'}" data-url="${escapeHtml(item.url)}">
        <div class="item-body">
          <div class="item-title">${title}</div>
          ${summaryHtml}
          <div class="item-meta">
            ${tagHtml}
            <span>${source}</span>
            <span class="sep"></span>
            <span>${formatTime(item.time)}</span>
          </div>
        </div>
      </div>`;
    });
  });

  historyList.innerHTML = html;
  if (shouldScrollToFirstUnread) scrollToFirstUnread();
  if (shouldUpdateBadge) updateBadgeFromData(history, cachedReadIds, readAllBeforeTime);
  lastRenderSignature = signature;
}

function scrollToFirstUnread() {
  const firstUnread = historyList.querySelector('.item.unread');
  if (!firstUnread) return;
  historyList.scrollTop = Math.max(firstUnread.offsetTop - historyList.offsetTop - 6, 0);
}

function cacheLoadedPopupData(data) {
  writePopupCache({
    enabled: data.enabled,
    interval: data.interval,
    feedMode: data.feedMode,
    theme: data.theme,
    fontFamily: data.fontFamily,
    fontSize: data.fontSize,
    historyDays: data.historyDays,
    history: data.history || [],
    readIds: data.readIds || [],
    readAllBefore: data.readAllBefore || '',
    readAllBeforeByMode: data.readAllBeforeByMode || {}
  });
}

function isReadFast(item, readIdSet, readAllBeforeTime) {
  if (readIdSet.has(item.url)) return true;
  if (readAllBeforeTime && new Date(item.time).getTime() <= readAllBeforeTime) return true;
  return false;
}

function updateBadgeFromData(history, readIdSet, readAllBeforeTime) {
  const unread = history.filter(i => !isReadFast(i, readIdSet, readAllBeforeTime)).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff6b35' });
}

async function updateBadge() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  const { history = [], readIds = [], historyDays = DEFAULT_HISTORY_DAYS } = data;
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const readIdSet = new Set(readIds);
  const readAllBefore = getReadAllBeforeForMode(data);
  const readAllBeforeTime = readAllBefore ? new Date(readAllBefore).getTime() : 0;
  const filtered = history.filter(i => new Date(i.time).getTime() > cutoff);
  updateBadgeFromData(filtered, readIdSet, readAllBeforeTime);
}

async function saveConfig(options = {}) {
  const shouldNotifyBackground = options.notifyBackground !== false;
  const theme = themeEl.value;
  const fontFamily = fontFamilyEl.value;
  const fontSize = fontSizeEl.value;
  const historyDays = Number(historyDaysEl.value);
  const feedMode = feedModeEl.value;
  const config = {
    enabled: enabledEl.checked,
    interval: Number(intervalEl.value),
    feedMode,
    theme,
    fontFamily,
    fontSize,
    historyDays
  };
  applyTheme(theme);
  applyFontFamily(fontFamily);
  applyFontSize(fontSize);
  writePopupCache(config);
  await chrome.storage.local.set(config);
  if (shouldNotifyBackground) {
    chrome.runtime.sendMessage({ type: 'configChanged' });
  }
  loadHistory();
}

async function loadHistory() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  const cachedData = await readWarmPopupCache();
  const reconciled = reconcileCachedReadIds(data, cachedData);
  renderHistory(reconciled.data);
  writePopupCache(reconciled.data);
  if (reconciled.changed) chrome.storage.local.set({ readIds: reconciled.data.readIds });
}

// Event delegation for item clicks
historyList.addEventListener('click', async (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  const url = item.dataset.url;

  if (!cachedReadIds.has(url)) {
    cachedReadIds.add(url);
    const arr = [...cachedReadIds];
    if (arr.length > 100) arr.splice(0, arr.length - 100);
    chrome.storage.local.set({ readIds: arr });
    writePopupCache({ readIds: arr });
    lastRenderSignature = '';
  }

  item.classList.remove('unread');
  item.classList.add('read');

  const unreadEls = historyList.querySelectorAll('.item.unread');
  const unreadCount = unreadEls.length;
  if (unreadCount > 0) {
    unreadCountEl.textContent = `${unreadCount} 条未读`;
    unreadCountEl.classList.add('show');
    markAllReadBtn.classList.add('visible');
  } else {
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
  }
  chrome.action.setBadgeText({ text: unreadCount > 0 ? String(unreadCount) : '' });

  chrome.tabs.create({ url });
});

markAllReadBtn.addEventListener('click', async () => {
  const { feedMode = 'selected', readAllBeforeByMode = {} } = await chrome.storage.local.get(['feedMode', 'readAllBeforeByMode']);
  const mode = normalizeFeedMode(feedMode);
  await chrome.storage.local.set({
    readAllBeforeByMode: {
      ...readAllBeforeByMode,
      [mode]: new Date().toISOString()
    }
  });
  showButtonConfirm(markAllReadBtn);
  await loadHistory();
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

enabledEl.addEventListener('change', () => saveConfig());
intervalEl.addEventListener('change', () => saveConfig());
feedModeEl.addEventListener('change', async () => {
  const feedbackStartedAt = Date.now();
  const nextFeedMode = normalizeFeedMode(feedModeEl.value);
  const { feedMode = 'selected' } = await chrome.storage.local.get('feedMode');
  const previousFeedMode = normalizeFeedMode(feedMode);

  clearButtonFeedback(pollBtn);
  pollBtn.classList.add('is-loading');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'feedModeChanged', feedMode: nextFeedMode });
    if (!response || response.ok === false) throw new Error(response?.error || 'feed mode update failed');
    const { failCount = 0 } = await chrome.storage.local.get('failCount');
    await loadHistory();
    writePopupCache({ feedMode: nextFeedMode });
    showButtonResult(pollBtn, failCount === 0 ? 'is-result-accent' : 'is-result-danger', Date.now() - feedbackStartedAt);
  } catch (e) {
    feedModeEl.value = previousFeedMode;
    writePopupCache({ feedMode: previousFeedMode });
    showButtonResult(pollBtn, 'is-result-danger', Date.now() - feedbackStartedAt);
  }
});
themeEl.addEventListener('change', () => saveConfig({ notifyBackground: false }));
fontFamilyEl.addEventListener('change', () => saveConfig({ notifyBackground: false }));
fontSizeEl.addEventListener('change', () => saveConfig({ notifyBackground: false }));
historyDaysEl.addEventListener('change', () => saveConfig({ notifyBackground: false }));

pollBtn.addEventListener('click', async () => {
  const feedbackStartedAt = Date.now();
  clearButtonFeedback(pollBtn);
  pollBtn.classList.add('is-loading');
  pollBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'pollNow' });
    if (!response || response.ok === false) throw new Error(response?.error || 'manual poll failed');
    const { failCount = 0 } = await chrome.storage.local.get('failCount');
    await loadHistory();
    showButtonResult(pollBtn, failCount === 0 ? 'is-result-accent' : 'is-result-danger', Date.now() - feedbackStartedAt);
  } catch (e) {
    showButtonResult(pollBtn, 'is-result-danger', Date.now() - feedbackStartedAt);
  }
  pollBtn.disabled = false;
});

// Keep cold start on the skeleton; only use cached content after this browser session has warmed.
(async function init() {
  const storageDataPromise = chrome.storage.local.get([
    'enabled', 'interval', 'feedMode', 'theme', 'fontFamily', 'fontSize', 'historyDays',
    'history', 'readIds', 'readAllBefore', 'readAllBeforeByMode'
  ]);
  const cachedData = await readWarmPopupCache();
  if (cachedData) {
    applyConfig(cachedData);
    renderHistory(cachedData, { updateBadge: false, scrollToFirstUnread: true });
  }

  const storageData = await storageDataPromise;
  const reconciled = reconcileCachedReadIds(storageData, cachedData);
  const data = reconciled.data;
  await migrateReadAllBefore(data);
  applyConfig(data);
  if (data.theme && data.theme !== normalizeTheme(data.theme)) {
    chrome.storage.local.set({ theme: 'dark' });
  }
  renderHistory(data, { scrollToFirstUnread: true });
  cacheLoadedPopupData(data);
  markPopupSessionWarm();
  if (reconciled.changed) chrome.storage.local.set({ readIds: data.readIds });
})();
