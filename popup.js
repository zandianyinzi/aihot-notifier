const enabledEl = document.getElementById('enabled');
const perfLog = window.__popupPerfLog || function () {};
perfLog('js-start');

const _dbuf = [];
const _origLog = console.log;
console.log = function(...a) {
  _origLog.apply(console, a);
  if (String(a[0]).startsWith('[POPUP][perf]')) _dbuf.push(a.join(' '));
};

new ResizeObserver(entries => {
  const r = entries[0].contentRect;
  perfLog('resize', { width: Math.round(r.width), height: Math.round(r.height) });
}).observe(document.documentElement);

new PerformanceObserver(list => {
  list.getEntries().forEach(e => perfLog('paint', {
    name: e.name,
    startTime: Number(e.startTime.toFixed(2))
  }));
}).observe({ type: 'paint', buffered: true });
const intervalEl = document.getElementById('interval');
const feedModeEl = document.getElementById('feedMode');
const themeEl = document.getElementById('theme');
const fontFamilyEl = document.getElementById('fontFamily');
const fontSizeEl = document.getElementById('fontSize');
const openPositionModeEl = document.getElementById('openPositionMode');
const historyDaysEl = document.getElementById('historyDays');
const markAllReadBtn = document.getElementById('markAllRead');
const pollBtn = document.getElementById('pollNow');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const historyList = document.getElementById('historyList');
const watchRulesList = document.getElementById('watchRulesList');
const watchSourceEl = document.getElementById('watchSource');
const watchAuthorEl = document.getElementById('watchAuthor');
const watchKeywordsEl = document.getElementById('watchKeywords');
const addWatchRuleBtn = document.getElementById('addWatchRule');

const CATEGORY_MAP = {
  'ai-models': { cls: 'cat-model', label: '模型' },
  'model': { cls: 'cat-model', label: '模型' },
  'ai-products': { cls: 'cat-products', label: '产品' },
  'industry': { cls: 'cat-industry', label: '行业' },
  'paper': { cls: 'cat-paper', label: '论文' },
  'tip': { cls: 'cat-tips', label: '技巧' },
  'tips': { cls: 'cat-tips', label: '技巧' }
};

const VALID_THEMES = new Set(['dark', 'green-dark', 'chrome-dark']);
const DEFAULT_HISTORY_DAYS = 2;
const BADGE_COLOR = '#e2231a';
const POPUP_CACHE_KEY = 'popupDataSnapshot';
const POPUP_SESSION_KEY = 'popupWarmSession';
const POPUP_SCROLL_KEY = 'popupScrollPosition';
const POPUP_CACHE_VERSION = 3;
const POPUP_CACHE_TTL_MS = 30 * 60 * 1000;
const POPUP_SCROLL_TTL_MS = 30 * 60 * 1000;
const POPUP_SCROLL_SAVE_DELAY_MS = 200;
const BUTTON_RESULT_CLASSES = ['is-result-accent', 'is-result-danger', 'is-result-ok'];
const BUTTON_TRANSIENT_CLASSES = ['is-loading', ...BUTTON_RESULT_CLASSES];
const BUTTON_RESULT_MIN_MS = 600;
const BUTTON_RESULT_MAX_MS = 1400;
const BUTTON_RESULT_TARGET_TOTAL_MS = 1800;
const VALID_FONTS = new Set(['system', 'noto-serif', 'lxgw']);
const VALID_OPEN_POSITION_MODES = new Set(['free', 'unread']);

let cachedReadIds = new Set();
let lastRenderSignature = '';
let scrollSaveTimer = 0;

function clearButtonFeedback(button) {
  button.classList.remove(...BUTTON_TRANSIENT_CLASSES);
  button.style.removeProperty('--control-result-duration');
}

function waitForNextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function logPerf(phase, fields = {}) {
  perfLog(phase, fields);
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


function splitWatchKeywords(value) {
  if (Array.isArray(value)) return value.flatMap(v => splitWatchKeywords(v)).filter(Boolean);
  return String(value || '').split(/[,，]/).map(v => v.trim()).filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeWatchRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index) => ({
    id: String(rule.id || `wr_${index}`),
    source: String(rule.source || '').trim(),
    author: String(rule.author || '').trim(),
    keywords: splitWatchKeywords(rule.keywords),
    enabled: rule.enabled !== false,
    createdAt: rule.createdAt || ''
  }));
}

function getWatchRuleLabel(rule) {
  const parts = [];
  if (rule.source) parts.push(rule.source);
  if (rule.author) parts.push(rule.author);
  if (rule.keywords.length > 0) parts.push(rule.keywords.join(', '));
  return parts.join(' · ') || '未配置规则';
}

function mergeWatchRuleInput(rules, input) {
  const normalized = normalizeWatchRules(rules);
  const source = String(input.source || '').trim();
  const author = String(input.author || '').trim();
  const keywords = splitWatchKeywords(input.keywords);
  if (!source && !author && keywords.length === 0) return normalized;
  const sameRule = normalized.find(rule => normalizeText(rule.source) === normalizeText(source) && normalizeText(rule.author) === normalizeText(author));
  if (!sameRule) {
    return [
      ...normalized,
      {
        id: `wr_${Date.now()}`,
        source,
        author,
        keywords,
        enabled: true,
        createdAt: new Date().toISOString()
      }
    ];
  }
  const mergedKeywords = [...sameRule.keywords];
  for (const keyword of keywords) {
    if (!mergedKeywords.some(existing => normalizeText(existing) === normalizeText(keyword))) mergedKeywords.push(keyword);
  }
  return normalized.map(rule => rule.id === sameRule.id ? { ...rule, keywords: mergedKeywords } : rule);
}

function removeWatchRuleKeyword(rules, ruleId, keywordIndex) {
  return normalizeWatchRules(rules)
    .map(rule => rule.id === ruleId ? { ...rule, keywords: rule.keywords.filter((_, index) => index !== keywordIndex) } : rule)
    .filter(rule => rule.source || rule.author || rule.keywords.length > 0);
}

function renderWatchRules(rules) {
  if (!watchRulesList) return;
  const normalized = normalizeWatchRules(rules);
  if (normalized.length === 0) {
    watchRulesList.innerHTML = '<div class="watch-rule-text">暂无规则，添加来源/作者/关键词开始关注</div>';
    return;
  }
  watchRulesList.innerHTML = normalized.map(rule => `
    <div class="watch-rule-card ${rule.enabled ? '' : 'disabled'}" data-rule-id="${escapeHtml(rule.id)}">
      <div class="watch-rule-content" title="${escapeHtml(getWatchRuleLabel(rule))}">
        <div class="watch-rule-head">
          <span class="watch-rule-source">${escapeHtml(rule.source || '任意来源')}</span>
          <span class="watch-rule-author">${escapeHtml(rule.author || '任意作者')}</span>
          <div class="watch-rule-actions">
            <button class="btn-mini watch-rule-btn" data-action="toggle">${rule.enabled ? '停用' : '启用'}</button>
            <button class="btn-mini watch-rule-btn" data-action="delete" title="删除">×</button>
          </div>
        </div>
        ${rule.keywords.length > 0 ? `<div class="watch-keyword-tags">${rule.keywords.map((keyword, index) => `<span class="watch-keyword-tag">${escapeHtml(keyword)}<button class="watch-keyword-remove" data-keyword-index="${index}" title="删除关键词">×</button></span>`).join('')}</div>` : ''}
      </div>
    </div>
  `).join('');
}

async function saveWatchRules(rules, options = {}) {
  const normalized = normalizeWatchRules(rules);
  await chrome.storage.local.set({ watchRules: normalized });
  renderWatchRules(normalized);
  if (options.scrollToEnd && watchRulesList) {
    watchRulesList.scrollTop = watchRulesList.scrollHeight;
  }
}

function renderItemHtml(item, isUnread, options = {}) {
  const cat = getCategory(item.category);
  const title = escapeHtml(item.title);
  const source = escapeHtml(item.source || '');
  const tagHtml = cat.label ? `<span class="cat-tag ${cat.cls}">${cat.label}</span>` : '';
  const watchTagHtml = item.watchMatched ? '<span class="watch-badge">特关</span>' : '';
  const summary = escapeHtml(item.summary || '');
  const summaryHtml = summary ? `<div class="item-summary">${summary}</div>` : '';
  return `<div class="item ${isUnread ? 'unread' : 'read'} ${item.watchMatched ? 'watch-item' : ''}" data-url="${escapeHtml(item.url)}" role="link" tabindex="0">
    <div class="item-body">
      <div class="item-title">${options.prefix || ''}${title}</div>
      ${summaryHtml}
      <div class="item-meta">
        ${watchTagHtml}
        ${tagHtml}
        <span>${source}</span>
        <span class="sep"></span>
        <span>${formatTime(item.time)}</span>
      </div>
    </div>
  </div>`;
}

async function markWatchUrlsViewed(urls) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);
  if (list.length === 0) return;
  try {
    await chrome.runtime.sendMessage({ type: 'markWatchViewed', urls: list });
  } catch (_e) {
    const { watchNotifyState = {} } = await chrome.storage.local.get('watchNotifyState');
    const now = new Date().toISOString();
    list.forEach(url => {
      if (watchNotifyState[url]) watchNotifyState[url] = { ...watchNotifyState[url], viewedAt: watchNotifyState[url].viewedAt || now };
    });
    await chrome.storage.local.set({ watchNotifyState });
  }
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

function normalizeFontFamily(font) {
  if (font === 'noto-sans') return 'system';
  return VALID_FONTS.has(font) ? font : 'system';
}

function normalizeOpenPositionMode(mode) {
  return VALID_OPEN_POSITION_MODES.has(mode) ? mode : 'unread';
}

function normalizeFeedMode(mode) {
  return mode === 'all' ? 'all' : 'selected';
}

function getScrollContext(data) {
  return {
    feedMode: normalizeFeedMode(data.feedMode),
    historyDays: Number(data.historyDays || DEFAULT_HISTORY_DAYS)
  };
}

function readScrollPosition() {
  try {
    const raw = localStorage.getItem(POPUP_SCROLL_KEY);
    if (!raw) return null;
    const position = JSON.parse(raw);
    if (!position || !position.savedAt || Date.now() - position.savedAt > POPUP_SCROLL_TTL_MS) {
      localStorage.removeItem(POPUP_SCROLL_KEY);
      return null;
    }
    return position;
  } catch (_e) {
    localStorage.removeItem(POPUP_SCROLL_KEY);
    return null;
  }
}

function writeScrollPosition(data = {}) {
  if (normalizeOpenPositionMode(openPositionModeEl.value) !== 'free') return;
  const firstVisible = getFirstVisibleItem();
  const context = getScrollContext(data);
  try {
    localStorage.setItem(POPUP_SCROLL_KEY, JSON.stringify({
      ...context,
      scrollTop: historyList.scrollTop,
      anchorUrl: firstVisible ? firstVisible.dataset.url : '',
      savedAt: Date.now()
    }));
  } catch (_e) {
    // Scroll position is a convenience only.
  }
}

function clearScrollPosition() {
  if (scrollSaveTimer) {
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = 0;
  }
  localStorage.removeItem(POPUP_SCROLL_KEY);
}

function scheduleScrollPositionWrite(data = {}) {
  if (normalizeOpenPositionMode(openPositionModeEl.value) !== 'free') return;
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    scrollSaveTimer = 0;
    writeScrollPosition(data);
  }, POPUP_SCROLL_SAVE_DELAY_MS);
}

function getFirstVisibleItem() {
  const listTop = historyList.getBoundingClientRect().top;
  const items = historyList.querySelectorAll('.item');
  for (const item of items) {
    if (item.getBoundingClientRect().bottom >= listTop) return item;
  }
  return items[0] || null;
}

function restoreScrollPosition(data) {
  const position = readScrollPosition();
  if (!position) return false;

  const context = getScrollContext(data);
  if (position.feedMode !== context.feedMode || position.historyDays !== context.historyDays) return false;

  if (position.anchorUrl) {
    const anchor = historyList.querySelector(`.item[data-url="${CSS.escape(position.anchorUrl)}"]`);
    if (anchor) {
      historyList.scrollTop = Math.max(anchor.offsetTop - historyList.offsetTop, 0);
      return true;
    }
  }

  if (Number.isFinite(position.scrollTop)) {
    historyList.scrollTop = Math.max(position.scrollTop, 0);
    return true;
  }

  return false;
}

function applyInitialPosition(data) {
  if (normalizeOpenPositionMode(data.openPositionMode) === 'free' && restoreScrollPosition(data)) return;
  scrollToFirstUnread();
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
  document.documentElement.style.background =
    theme === 'green-dark' ? '#101410' : theme === 'chrome-dark' ? '#111317' : '#111111';
  localStorage.setItem('theme', theme);
}

function applyFontSize(size) {
  document.documentElement.setAttribute('data-size', size);
  localStorage.setItem('fontSize', size);
}

function applyFontFamily(font) {
  font = normalizeFontFamily(font);
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
  const font = normalizeFontFamily(data.fontFamily);
  fontFamilyEl.value = font;
  applyFontFamily(font);
  const size = data.fontSize || 'medium';
  fontSizeEl.value = size;
  applyFontSize(size);
  openPositionModeEl.value = normalizeOpenPositionMode(data.openPositionMode);
  let days = data.historyDays || DEFAULT_HISTORY_DAYS;
  if (days > 5) days = 5;
  historyDaysEl.value = String(days);
  renderWatchRules(data.watchRules || []);
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
      item.watchMatched ? '1' : '',
      getDateLabel(item.time),
      item.discoveredAt || '',
      isReadFast(item, readIdSet, readAllBeforeTime) ? 1 : 0
    ])
  });
}

function renderHistory(data, options = {}) {
  const shouldUpdateBadge = options.updateBadge !== false;
  const skipUnchanged = options.skipUnchanged !== false;
  const shouldApplyInitialPosition = options.applyInitialPosition === true;
  const rawHistory = data.history || [];
  const readIds = data.readIds || [];
  const readAllBefore = getReadAllBeforeForMode(data);
  const historyDays = data.historyDays || DEFAULT_HISTORY_DAYS;

  const readIdSet = new Set(readIds);
  cachedReadIds = readIdSet;
  const readAllBeforeTime = readAllBefore ? new Date(readAllBefore).getTime() : 0;

  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const history = rawHistory.filter(i => isWithinHistoryWindow(i, cutoff));
  const signature = getRenderSignature(history, readIdSet, readAllBeforeTime, historyDays);
  logPerf('render-start', { items: history.length, cached: signature === lastRenderSignature });

  if (skipUnchanged && signature === lastRenderSignature) {
    if (shouldUpdateBadge) updateBadgeFromData(history, readIdSet, readAllBeforeTime);
    if (shouldApplyInitialPosition) applyInitialPosition(data);
    logPerf('render-skip', { items: history.length });
    return;
  }

  if (history.length === 0) {
    const tip = rawHistory.length > 0
      ? `当前${historyDays}天内无记录，记录会随轮询逐步积累`
      : '暂无内容，等待下一次推送';
    historyList.innerHTML = `<div class="empty-state">${tip}</div>`;
    markAllReadBtn.classList.remove('visible');
    if (shouldUpdateBadge) updateBadgeFromData(history, cachedReadIds, readAllBeforeTime);
    lastRenderSignature = signature;
    logPerf('render-end', { items: 0, empty: true });
    return;
  }

  const unread = history.filter(i => !isReadFast(i, readIdSet, readAllBeforeTime)).length;
  if (unread > 0) {
    markAllReadBtn.classList.add('visible');
  } else {
    markAllReadBtn.classList.remove('visible');
  }

  const pinnedWatch = history
    .filter(item => item.watchMatched && !isReadFast(item, readIdSet, readAllBeforeTime))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
  const pinnedUrls = new Set(pinnedWatch.map(item => item.url));
  const displayHistory = [...pinnedWatch, ...history.filter(item => !pinnedUrls.has(item.url))];

  let html = '';
  if (pinnedWatch.length > 0) {
    pinnedWatch.forEach(item => {
      html += renderItemHtml(item, true);
    });
  }

  const groups = {};
  displayHistory.filter(item => !pinnedUrls.has(item.url)).forEach(item => {
    const label = getDateLabel(item.time);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  });

  Object.entries(groups).forEach(([dateLabel, items]) => {
    html += `<div class="date-label">${dateLabel}</div>`;
    items.forEach(item => {
      const isUnread = !isReadFast(item, cachedReadIds, readAllBeforeTime);
      html += renderItemHtml(item, isUnread);
    });
  });

  historyList.innerHTML = html;
  if (shouldApplyInitialPosition) applyInitialPosition(data);
  if (shouldUpdateBadge) updateBadgeFromData(history, cachedReadIds, readAllBeforeTime);
  lastRenderSignature = signature;
  logPerf('render-end', { items: history.length, unread });
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
    fontFamily: normalizeFontFamily(data.fontFamily),
    fontSize: data.fontSize,
    openPositionMode: normalizeOpenPositionMode(data.openPositionMode),
    historyDays: data.historyDays,
    history: data.history || [],
    readIds: data.readIds || [],
    readAllBefore: data.readAllBefore || '',
    readAllBeforeByMode: data.readAllBeforeByMode || {},
    watchRules: data.watchRules || []
  });
}

function isReadFast(item, readIdSet, readAllBeforeTime) {
  if (readIdSet.has(item.url)) return true;
  if (readAllBeforeTime && getUnreadReferenceTime(item) <= readAllBeforeTime) return true;
  return false;
}

function updateBadgeFromData(history, readIdSet, readAllBeforeTime) {
  const unread = history.filter(i => !isReadFast(i, readIdSet, readAllBeforeTime)).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

async function updateBadge() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  const { history = [], readIds = [], historyDays = DEFAULT_HISTORY_DAYS } = data;
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const readIdSet = new Set(readIds);
  const readAllBefore = getReadAllBeforeForMode(data);
  const readAllBeforeTime = readAllBefore ? new Date(readAllBefore).getTime() : 0;
  const filtered = history.filter(i => isWithinHistoryWindow(i, cutoff));
  updateBadgeFromData(filtered, readIdSet, readAllBeforeTime);
}

async function saveConfig(options = {}) {
  const shouldNotifyBackground = options.notifyBackground !== false;
  const theme = themeEl.value;
  const fontFamily = normalizeFontFamily(fontFamilyEl.value);
  const fontSize = fontSizeEl.value;
  const openPositionMode = normalizeOpenPositionMode(openPositionModeEl.value);
  const historyDays = Number(historyDaysEl.value);
  const feedMode = feedModeEl.value;
  const config = {
    enabled: enabledEl.checked,
    interval: Number(intervalEl.value),
    feedMode,
    theme,
    fontFamily,
    fontSize,
    openPositionMode,
    historyDays
  };
  applyTheme(theme);
  applyFontFamily(fontFamily);
  applyFontSize(fontSize);
  if (openPositionMode === 'unread') clearScrollPosition();
  writePopupCache(config);
  await chrome.storage.local.set(config);
  if (shouldNotifyBackground) {
    chrome.runtime.sendMessage({ type: 'configChanged' });
  }
  loadHistory();
}

async function loadHistory() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode', 'openPositionMode', 'watchRules']);
  const cachedData = await readWarmPopupCache();
  const reconciled = reconcileCachedReadIds(data, cachedData);
  renderHistory(reconciled.data);
  writePopupCache(reconciled.data);
  if (reconciled.changed) chrome.storage.local.set({ readIds: reconciled.data.readIds });
}

async function handleItemClick(e) {
  const item = e.target.closest('.item');
  if (!item) return;
  await openHistoryItem(item);
}

async function openHistoryItem(item) {
  const url = item.dataset.url;

  const { feedMode = 'selected', historyDays = DEFAULT_HISTORY_DAYS } = await chrome.storage.local.get(['feedMode', 'historyDays']);
  writeScrollPosition({ feedMode, historyDays });

  if (!cachedReadIds.has(url)) {
    cachedReadIds.add(url);
    const arr = [...cachedReadIds];
    if (arr.length > 100) arr.splice(0, arr.length - 100);
    chrome.storage.local.set({ readIds: arr });
    writePopupCache({ readIds: arr });
    lastRenderSignature = '';
  }

  document.querySelectorAll(`.item[data-url="${CSS.escape(url)}"]`).forEach(el => {
    el.classList.remove('unread');
    el.classList.add('read');
  });

  const unreadEls = document.querySelectorAll('.item.unread');
  const unreadCount = unreadEls.length;
  if (unreadCount > 0) {
    markAllReadBtn.classList.add('visible');
  } else {
    markAllReadBtn.classList.remove('visible');
  }
  chrome.action.setBadgeText({ text: unreadCount > 0 ? String(unreadCount) : '' });

  await markWatchUrlsViewed(url);
  chrome.tabs.create({ url });
}

// Event delegation for item clicks
historyList.addEventListener('click', handleItemClick);
historyList.addEventListener('keydown', async (e) => {
  const isOpenKey = e.key === 'Enter' || e.key === ' ';
  if (!isOpenKey) return;
  const item = e.target.closest('.item');
  if (!item) return;
  e.preventDefault();
  await openHistoryItem(item);
});

markAllReadBtn.addEventListener('click', async () => {
  historyList.querySelectorAll('.item.unread').forEach(el => {
    el.classList.remove('unread');
    el.classList.add('read');
  });
  markAllReadBtn.classList.remove('visible');
  chrome.action.setBadgeText({ text: '' });

  const { feedMode = 'selected', readAllBeforeByMode = {} } = await chrome.storage.local.get(['feedMode', 'readAllBeforeByMode']);
  const mode = normalizeFeedMode(feedMode);
  const visibleWatchUrls = Array.from(document.querySelectorAll('.item.watch-item')).map(el => el.dataset.url).filter(Boolean);
  await markWatchUrlsViewed(visibleWatchUrls);
  await chrome.storage.local.set({
    readAllBeforeByMode: {
      ...readAllBeforeByMode,
      [mode]: new Date().toISOString()
    }
  });
  showButtonConfirm(markAllReadBtn);
  clearScrollPosition();
  await loadHistory();
});

const settingGroups = Array.from(settingsPanel.querySelectorAll('.setting-group'));
function ensureDefaultSettingsGroupOpen() {
  if (settingGroups.some(group => group.open)) return;
  const generalGroup = settingsPanel.querySelector('[data-setting-group="general"]');
  if (generalGroup) generalGroup.open = true;
}

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  if (settingsPanel.classList.contains('open')) ensureDefaultSettingsGroupOpen();
});

settingGroups.forEach(group => {
  group.addEventListener('toggle', () => {
    if (!group.open) return;
    settingGroups.forEach(otherGroup => {
      if (otherGroup !== group) otherGroup.open = false;
    });
  });
});

document.getElementById('copyLogs').addEventListener('click', function() {
  const log = window.__popupPerf && window.__popupPerf.snapshot ? window.__popupPerf.snapshot().join('\n') : _dbuf.join('\n');
  navigator.clipboard.writeText(log).then(() => {
    this.textContent = '成功';
    setTimeout(() => { this.textContent = '拷贝'; }, 1500);
  });
});


if (addWatchRuleBtn) {
  addWatchRuleBtn.addEventListener('click', async () => {
    const source = watchSourceEl.value.trim();
    const author = watchAuthorEl.value.trim();
    const keywords = splitWatchKeywords(watchKeywordsEl.value);
    if (!source && !author && keywords.length === 0) return;
    const { watchRules = [] } = await chrome.storage.local.get('watchRules');
    const nextRules = mergeWatchRuleInput(watchRules, { source, author, keywords });
    watchKeywordsEl.value = '';
    await saveWatchRules(nextRules, { scrollToEnd: true });
  });
}

if (watchRulesList) {
  watchRulesList.addEventListener('click', async (e) => {
    const keywordRemoveBtn = e.target.closest('.watch-keyword-remove');
    if (keywordRemoveBtn) {
      const card = keywordRemoveBtn.closest('.watch-rule-card');
      const ruleId = card?.dataset.ruleId;
      const keywordIndex = Number(keywordRemoveBtn.dataset.keywordIndex);
      if (!ruleId || !Number.isInteger(keywordIndex)) return;
      const { watchRules = [] } = await chrome.storage.local.get('watchRules');
      await saveWatchRules(removeWatchRuleKeyword(watchRules, ruleId, keywordIndex));
      return;
    }

    const button = e.target.closest('.watch-rule-btn');
    if (!button) return;
    const card = button.closest('.watch-rule-card');
    const ruleId = card?.dataset.ruleId;
    if (!ruleId) return;
    const { watchRules = [] } = await chrome.storage.local.get('watchRules');
    const rules = normalizeWatchRules(watchRules);
    const action = button.dataset.action;
    const nextRules = action === 'delete'
      ? rules.filter(rule => rule.id !== ruleId)
      : rules.map(rule => rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule);
    await saveWatchRules(nextRules);
  });
}

enabledEl.addEventListener('change', () => saveConfig());
intervalEl.addEventListener('change', () => saveConfig());
feedModeEl.addEventListener('change', async () => {
  const feedbackStartedAt = Date.now();
  const nextFeedMode = normalizeFeedMode(feedModeEl.value);
  const previousFeedMode = normalizeFeedMode(readPopupCache()?.feedMode || 'selected');

  clearButtonFeedback(pollBtn);
  pollBtn.classList.add('is-loading');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'feedModeChanged', feedMode: nextFeedMode });
    if (!response || response.ok === false) throw new Error(response?.error || 'feed mode update failed');
    const { failCount = 0 } = await chrome.storage.local.get('failCount');
    clearScrollPosition();
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
openPositionModeEl.addEventListener('change', () => saveConfig({ notifyBackground: false }));
historyDaysEl.addEventListener('change', () => {
  clearScrollPosition();
  saveConfig({ notifyBackground: false });
});

historyList.addEventListener('scroll', () => {
  const data = {
    feedMode: feedModeEl.value,
    historyDays: Number(historyDaysEl.value)
  };
  scheduleScrollPositionWrite(data);
}, { passive: true });

pollBtn.addEventListener('click', async () => {
  const feedbackStartedAt = Date.now();
  clearButtonFeedback(pollBtn);
  pollBtn.classList.add('is-loading');
  pollBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'pollNow' });
    if (!response || response.ok === false) throw new Error(response?.error || 'manual poll failed');
    const { failCount = 0 } = await chrome.storage.local.get('failCount');
    clearScrollPosition();
    await loadHistory();
    showButtonResult(pollBtn, failCount === 0 ? 'is-result-accent' : 'is-result-danger', Date.now() - feedbackStartedAt);
  } catch (e) {
    showButtonResult(pollBtn, 'is-result-danger', Date.now() - feedbackStartedAt);
  }
  pollBtn.disabled = false;
});

// Keep cold start on the skeleton; only use cached content after this browser session has warmed.
(async function init() {
  logPerf('init-start');
  const storageDataPromise = chrome.storage.local.get([
    'enabled', 'interval', 'feedMode', 'theme', 'fontFamily', 'fontSize', 'openPositionMode', 'historyDays',
    'history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'watchRules'
  ]);
  const cachedData = await readWarmPopupCache();
  logPerf(cachedData ? 'cache-hit' : 'cache-miss');
  if (cachedData) {
    applyConfig(cachedData);
    await waitForNextPaint();
    renderHistory(cachedData, { updateBadge: false, applyInitialPosition: true });
    logPerf('render-cache');
  }

  const storageData = await storageDataPromise;
  logPerf('storage-ready');
  const reconciled = reconcileCachedReadIds(storageData, cachedData);
  const data = reconciled.data;
  await migrateReadAllBefore(data);
  applyConfig(data);
  if (data.theme && data.theme !== normalizeTheme(data.theme)) {
    chrome.storage.local.set({ theme: 'dark' });
  }
  if (data.fontFamily && data.fontFamily !== normalizeFontFamily(data.fontFamily)) {
    chrome.storage.local.set({ fontFamily: 'system' });
  }
  await waitForNextPaint();
  renderHistory(data, { applyInitialPosition: true });
  logPerf('render-storage');
  cacheLoadedPopupData(data);
  markPopupSessionWarm();
  if (reconciled.changed) chrome.storage.local.set({ readIds: data.readIds });
})();
