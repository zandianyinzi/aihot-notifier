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

function isRead(item, readIds, readAllBefore) {
  if (readIds.includes(item.url)) return true;
  if (readAllBefore && new Date(item.time) <= new Date(readAllBefore)) return true;
  return false;
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyFontSize(size) {
  document.documentElement.setAttribute('data-size', size);
}

function applyFontFamily(font) {
  document.documentElement.setAttribute('data-font', font);
}

async function loadConfig() {
  const data = await chrome.storage.local.get(['enabled', 'interval', 'feedMode', 'theme', 'fontFamily', 'fontSize', 'historyDays']);
  enabledEl.checked = data.enabled !== false;
  intervalEl.value = String(data.interval || 5);
  feedModeEl.value = data.feedMode || 'selected';
  const theme = data.theme || 'dark';
  themeEl.value = theme;
  applyTheme(theme);
  const font = data.fontFamily || 'noto-sans';
  fontFamilyEl.value = font;
  applyFontFamily(font);
  const size = data.fontSize || 'medium';
  fontSizeEl.value = size;
  applyFontSize(size);
  historyDaysEl.value = String(data.historyDays || 1);
}

async function saveConfig() {
  const theme = themeEl.value;
  const fontFamily = fontFamilyEl.value;
  const fontSize = fontSizeEl.value;
  const historyDays = Number(historyDaysEl.value);
  const feedMode = feedModeEl.value;
  await chrome.storage.local.set({
    enabled: enabledEl.checked,
    interval: Number(intervalEl.value),
    feedMode,
    theme,
    fontFamily,
    fontSize,
    historyDays
  });
  applyTheme(theme);
  applyFontFamily(fontFamily);
  applyFontSize(fontSize);
  chrome.runtime.sendMessage({ type: 'configChanged' });
  loadHistory();
}

async function loadHistory() {
  const { history: rawHistory = [], readIds = [], readAllBefore = '', historyDays = 1 } = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'historyDays']);
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const history = rawHistory.filter(i => new Date(i.time).getTime() > cutoff);

  if (history.length === 0) {
    const tip = rawHistory.length > 0
      ? `当前${historyDays}天内无记录，记录会随轮询逐步积累`
      : '暂无内容，等待下一次推送';
    historyList.innerHTML = `<div class="empty-state">${tip}</div>`;
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
    return;
  }

  const unread = history.filter(i => !isRead(i, readIds, readAllBefore)).length;
  if (unread > 0) {
    unreadCountEl.textContent = `${unread} 条未读`;
    unreadCountEl.classList.add('show');
    markAllReadBtn.classList.add('visible');
  } else {
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
  }

  // Group items by date
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
      const isUnread = !isRead(item, readIds, readAllBefore);
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


  document.querySelectorAll('.item').forEach(el => {
    el.addEventListener('click', async () => {
      const url = el.dataset.url;
      const { readIds = [] } = await chrome.storage.local.get('readIds');
      if (!readIds.includes(url)) {
        readIds.push(url);
        if (readIds.length > 100) readIds.splice(0, readIds.length - 100);
        await chrome.storage.local.set({ readIds });
      }
      el.classList.remove('unread');
      el.classList.add('read');
      updateBadge();
      updateUnreadDisplay();
      chrome.tabs.create({ url });
    });
  });

  updateBadge();
}

async function updateBadge() {
  const { history = [], readIds = [], readAllBefore = '', historyDays = 1 } = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore', 'historyDays']);
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const unread = history.filter(i => {
    if (new Date(i.time).getTime() <= cutoff) return false;
    return !isRead(i, readIds, readAllBefore);
  }).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff6b35' });
}

async function updateUnreadDisplay() {
  const { history = [], readIds = [], readAllBefore = '' } = await chrome.storage.local.get(['history', 'readIds', 'readAllBefore']);
  const unread = history.filter(i => !isRead(i, readIds, readAllBefore)).length;
  if (unread > 0) {
    unreadCountEl.textContent = `${unread} 条未读`;
    unreadCountEl.classList.add('show');
    markAllReadBtn.classList.add('visible');
  } else {
    unreadCountEl.classList.remove('show');
    markAllReadBtn.classList.remove('visible');
  }
}

markAllReadBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ readAllBefore: new Date().toISOString(), readIds: [] });
  markAllReadBtn.classList.add('done');
  setTimeout(() => markAllReadBtn.classList.remove('done'), 1500);
  await loadHistory();
  updateBadge();
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
    const { feedMode = 'selected' } = await chrome.storage.local.get('feedMode');
    await chrome.runtime.sendMessage({ type: 'feedModeChanged', feedMode });
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


loadConfig();
loadHistory();
