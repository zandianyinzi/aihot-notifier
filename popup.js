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

const FONT_FACE_MAP = {
  'noto-sans': 'Noto+Sans+SC:wght@300;400;500',
  'noto-serif': 'Noto+Serif+SC:wght@400;500',
  lxgw: 'LXGW+WenKai+TC:wght@300;400'
};

const VALID_THEMES = new Set(['dark', 'green-dark']);
const DEFAULT_HISTORY_DAYS = 2;

let cachedReadIds = new Set();
let fontLoadTimer = null;
let activeFontHref = '';

function getFontHref(font) {
  const fonts = [];
  if (FONT_FACE_MAP[font]) fonts.push(FONT_FACE_MAP[font]);
  if (fonts.length === 0) return '';
  return 'https://fonts.googleapis.com/css2?' + fonts.map(family => `family=${family}`).join('&') + '&display=swap';
}

function loadFontStylesheet(font) {
  const href = getFontHref(font);
  if (href === activeFontHref) return;

  activeFontHref = href;
  let link = document.getElementById('fontStylesheet');
  if (!href) {
    if (link) link.remove();
    return;
  }

  if (!link) {
    link = document.createElement('link');
    link.id = 'fontStylesheet';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = href;
}

function scheduleFontStylesheet(font) {
  clearTimeout(fontLoadTimer);
  const run = () => {
    fontLoadTimer = setTimeout(() => loadFontStylesheet(font), 0);
  };

  if (window.requestAnimationFrame) {
    requestAnimationFrame(run);
  } else {
    run();
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
  scheduleFontStylesheet(font);
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

function renderHistory(data) {
  const rawHistory = data.history || [];
  const readIds = data.readIds || [];
  const readAllBefore = getReadAllBeforeForMode(data);
  const historyDays = data.historyDays || DEFAULT_HISTORY_DAYS;

  cachedReadIds = new Set(readIds);
  const readAllBeforeTime = readAllBefore ? new Date(readAllBefore).getTime() : 0;

  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const history = rawHistory.filter(i => new Date(i.time).getTime() > cutoff);

  if (history.length === 0) {
    const tip = rawHistory.length > 0
      ? `当前${historyDays}天内无记录，记录会随轮询逐步积累`
      : '暂无内容，等待下一次推送';
    historyList.innerHTML = `<div class="empty-state">${tip}</div>`;
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
    updateBadgeFromData(history, cachedReadIds, readAllBeforeTime);
    return;
  }

  const unread = history.filter(i => !isReadFast(i, cachedReadIds, readAllBeforeTime)).length;
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
  updateBadgeFromData(history, cachedReadIds, readAllBeforeTime);
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

async function saveConfig() {
  const theme = themeEl.value;
  const fontFamily = fontFamilyEl.value;
  const fontSize = fontSizeEl.value;
  const historyDays = Number(historyDaysEl.value);
  const feedMode = feedModeEl.value;
  applyTheme(theme);
  applyFontFamily(fontFamily);
  applyFontSize(fontSize);
  await chrome.storage.local.set({
    enabled: enabledEl.checked,
    interval: Number(intervalEl.value),
    feedMode,
    theme,
    fontFamily,
    fontSize,
    historyDays
  });
  chrome.runtime.sendMessage({ type: 'configChanged' });
  loadHistory();
}

async function loadHistory() {
  const data = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'readAllBeforeByMode', 'historyDays', 'feedMode']);
  renderHistory(data);
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
  markAllReadBtn.classList.add('done');
  setTimeout(() => markAllReadBtn.classList.remove('done'), 1500);
  await loadHistory();
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

enabledEl.addEventListener('change', saveConfig);
intervalEl.addEventListener('change', saveConfig);
feedModeEl.addEventListener('change', async () => {
  await saveConfig();
  pollBtn.classList.remove('poll-ok', 'poll-fail');
  pollBtn.classList.add('spinning');
  try {
    await chrome.runtime.sendMessage({ type: 'feedModeChanged', feedMode: feedModeEl.value });
    const { failCount = 0 } = await chrome.storage.local.get('failCount');
    await loadHistory();
    pollBtn.classList.remove('spinning');
    pollBtn.classList.add(failCount === 0 ? 'poll-ok' : 'poll-fail');
  } catch (e) {
    pollBtn.classList.remove('spinning');
    pollBtn.classList.add('poll-fail');
  }
  setTimeout(() => pollBtn.classList.remove('poll-ok', 'poll-fail'), 3000);
});
themeEl.addEventListener('change', saveConfig);
fontFamilyEl.addEventListener('change', saveConfig);
fontSizeEl.addEventListener('change', saveConfig);
historyDaysEl.addEventListener('change', saveConfig);

pollBtn.addEventListener('click', async () => {
  pollBtn.classList.remove('poll-ok', 'poll-fail');
  pollBtn.classList.add('spinning');
  pollBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'pollNow' });
    const { failCount = 0 } = await chrome.storage.local.get('failCount');
    await loadHistory();
    pollBtn.classList.remove('spinning');
    pollBtn.classList.add(failCount === 0 ? 'poll-ok' : 'poll-fail');
  } catch (e) {
    pollBtn.classList.remove('spinning');
    pollBtn.classList.add('poll-fail');
  }
  pollBtn.disabled = false;
  setTimeout(() => pollBtn.classList.remove('poll-ok', 'poll-fail'), 3000);
});

// Single storage read on init
(async function init() {
  const data = await chrome.storage.local.get([
    'enabled', 'interval', 'feedMode', 'theme', 'fontFamily', 'fontSize', 'historyDays',
    'history', 'readIds', 'readAllBefore', 'readAllBeforeByMode'
  ]);
  await migrateReadAllBefore(data);
  applyConfig(data);
  if (data.theme && data.theme !== normalizeTheme(data.theme)) {
    chrome.storage.local.set({ theme: 'dark' });
  }
  renderHistory(data);
})();
