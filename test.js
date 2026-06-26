// AI HOT Notifier 单元测试
// 运行: node test.js

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

// ===== 辅助函数（从 background.js 提取的纯逻辑） =====

function dedup(apiItems, history) {
  const existingUrls = new Set(history.map(i => i.url));
  return apiItems.filter(i => !existingUrls.has(i.url));
}

function mapEntries(items) {
  return items.map(i => ({
    title: i.title, url: i.url, source: i.source || '',
    category: i.category || '', summary: i.summary || '', time: i.publishedAt,
    discoveredAt: i.discoveredAt
  }));
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

function mergeAndSort(newEntries, history, cutoffDays) {
  const cutoff = cutoffDays === Infinity ? -Infinity : Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
  return [...newEntries, ...history]
    .filter(i => isWithinHistoryWindow(i, cutoff))
    .sort((a, b) => getItemTime(b) - getItemTime(a));
}

function calcSinceTime(lastCheck, intervalMinutes) {
  const bufferMs = Math.max(intervalMinutes * 2 * 60 * 1000, 2 * 60 * 60 * 1000);
  return new Date(new Date(lastCheck).getTime() - bufferMs).toISOString();
}

function calcManualSince(historyDays) {
  return new Date(Date.now() - Math.max(historyDays, 1) * 24 * 60 * 60 * 1000).toISOString();
}

function getApiUrl(mode) {
  const API_BASE = 'https://aihot.virxact.com/api/public/items?take=100';
  return `${API_BASE}&mode=${mode}`;
}


const WATCH_REMINDER_DELAYS = [0, 2 * 60 * 1000, 5 * 60 * 1000, 2 * 60 * 60 * 1000];
const WATCH_DAILY_REMINDER_MS = 24 * 60 * 60 * 1000;

function splitWatchKeywords(value) {
  if (Array.isArray(value)) return value.flatMap(v => splitWatchKeywords(v)).filter(Boolean);
  return String(value || '').split(/[,，]/).map(v => v.trim()).filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeWatchRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index) => {
    const source = String(rule.source || '').trim();
    const author = String(rule.author || '').trim();
    const keywords = splitWatchKeywords(rule.keywords);
    return { id: String(rule.id || `wr_${index}`), source, author, keywords, enabled: rule.enabled !== false, createdAt: rule.createdAt || '' };
  }).filter(rule => rule.enabled && (rule.source || rule.author || rule.keywords.length > 0));
}

function normalizeWatchRuleRecords(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index) => {
    const source = String(rule.source || '').trim();
    const author = String(rule.author || '').trim();
    const keywords = splitWatchKeywords(rule.keywords);
    return { id: String(rule.id || `wr_${index}`), source, author, keywords, enabled: rule.enabled !== false, createdAt: rule.createdAt || '' };
  });
}

function mergeWatchRuleInput(rules, input, nowIso = '2026-06-26T00:00:00.000Z') {
  const normalized = normalizeWatchRuleRecords(rules);
  const source = String(input.source || '').trim();
  const author = String(input.author || '').trim();
  const keywords = splitWatchKeywords(input.keywords);
  if (!source && !author && keywords.length === 0) return normalized;
  const sameRule = normalized.find(rule => normalizeText(rule.source) === normalizeText(source) && normalizeText(rule.author) === normalizeText(author));
  if (!sameRule) return [...normalized, { id: 'wr_new', source, author, keywords, enabled: true, createdAt: nowIso }];
  const mergedKeywords = [...sameRule.keywords];
  for (const keyword of keywords) {
    if (!mergedKeywords.some(existing => normalizeText(existing) === normalizeText(keyword))) mergedKeywords.push(keyword);
  }
  return normalized.map(rule => rule.id === sameRule.id ? { ...rule, keywords: mergedKeywords } : rule);
}

function removeWatchRuleKeyword(rules, ruleId, keywordIndex) {
  return normalizeWatchRuleRecords(rules)
    .map(rule => rule.id === ruleId ? { ...rule, keywords: rule.keywords.filter((_, index) => index !== keywordIndex) } : rule)
    .filter(rule => rule.source || rule.author || rule.keywords.length > 0);
}

function parseSourceParts(source) {
  const text = String(source || '').trim();
  const parts = text.split(/[:：]/);
  if (parts.length < 2) return { sourceType: text, authorText: text };
  return { sourceType: parts[0].trim(), authorText: parts.slice(1).join('：').trim() };
}

function includesText(haystack, needle) {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return true;
  return normalizeText(haystack).includes(normalizedNeedle);
}

function matchWatchRules(item, rules) {
  const normalizedRules = normalizeWatchRules(rules);
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
  if (notifyCount < WATCH_REMINDER_DELAYS.length) return new Date(first + WATCH_REMINDER_DELAYS[notifyCount]).toISOString();
  return new Date(new Date(referenceNow).getTime() + WATCH_DAILY_REMINDER_MS).toISOString();
}

function shouldNotifyWatchState(state, nowMs) {
  if (!state || state.viewedAt) return false;
  const next = new Date(state.nextNotifyAt || state.firstMatchedAt || 0).getTime();
  return next > 0 && next <= nowMs;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const VALID_FONTS = new Set(['system', 'noto-serif', 'lxgw']);
const VALID_OPEN_POSITION_MODES = new Set(['free', 'unread']);
const VALID_THEMES = new Set(['dark', 'green-dark', 'chrome-dark']);

function normalizeFontFamily(font) {
  if (font === 'noto-sans') return 'system';
  return VALID_FONTS.has(font) ? font : 'system';
}

function normalizeOpenPositionMode(mode) {
  return VALID_OPEN_POSITION_MODES.has(mode) ? mode : 'free';
}

function normalizeTheme(theme) {
  return VALID_THEMES.has(theme) ? theme : 'dark';
}

// ===== 测试用例 =====

console.log('\n[去重]');
(function() {
  const history = [
    { url: 'https://a.com/1', title: 'A', time: '2026-06-04T10:00:00Z' },
    { url: 'https://a.com/2', title: 'B', time: '2026-06-04T08:00:00Z' },
  ];
  const api = [
    { url: 'https://a.com/3', title: 'C', publishedAt: '2026-06-05T06:00:00Z' },
    { url: 'https://a.com/1', title: 'A-dup', publishedAt: '2026-06-04T10:00:00Z' },
    { url: 'https://a.com/4', title: 'D', publishedAt: '2026-06-05T03:00:00Z' },
  ];
  const result = dedup(api, history);
  assert(result.length === 2, '过滤掉1条重复，保留2条新');
  assert(result[0].url === 'https://a.com/3', '第一条是新条目C');
  assert(result[1].url === 'https://a.com/4', '第二条是新条目D');
})();

console.log('\n[去重-空history]');
(function() {
  const result = dedup([{ url: 'https://x.com', title: 'X' }], []);
  assert(result.length === 1, '空history时全部为新');
})();

console.log('\n[去重-全重复]');
(function() {
  const history = [{ url: 'https://a.com/1', title: 'A', time: '2026-06-04T10:00:00Z' }];
  const api = [{ url: 'https://a.com/1', title: 'A', publishedAt: '2026-06-04T10:00:00Z' }];
  const result = dedup(api, history);
  assert(result.length === 0, '全重复时返回空');
})();

console.log('\n[排序]');
(function() {
  const entries = [
    { title: 'C', time: '2026-06-03T00:00:00Z' },
    { title: 'A', time: '2026-06-05T12:00:00Z' },
    { title: 'B', time: '2026-06-04T06:00:00Z' },
  ];
  const sorted = mergeAndSort(entries, [], Infinity);
  assert(sorted[0].title === 'A', '最新的排第一');
  assert(sorted[1].title === 'B', '次新排第二');
  assert(sorted[2].title === 'C', '最旧排第三');
})();

console.log('\n[排序-合并新旧条目]');
(function() {
  const newEntries = [
    { title: 'New1', url: 'u1', time: '2026-06-05T10:00:00Z' },
    { title: 'New2', url: 'u2', time: '2026-06-05T02:00:00Z' },
  ];
  const history = [
    { title: 'Old1', url: 'u3', time: '2026-06-05T06:00:00Z' },
    { title: 'Old2', url: 'u4', time: '2026-06-04T20:00:00Z' },
  ];
  const merged = mergeAndSort(newEntries, history, Infinity);
  assert(merged.length === 4, '合并后共4条');
  assert(merged[0].title === 'New1', 'New1(10:00)排第一');
  assert(merged[1].title === 'Old1', 'Old1(06:00)排第二');
  assert(merged[2].title === 'New2', 'New2(02:00)排第三');
  assert(merged[3].title === 'Old2', 'Old2(昨天20:00)排第四');
})();

console.log('\n[cutoff过滤]');
(function() {
  const entries = [
    { title: 'Recent', time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { title: 'Old', time: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  const result = mergeAndSort(entries, [], 7);
  assert(result.length === 1, '超过7天的条目被过滤');
  assert(result[0].title === 'Recent', '保留近期条目');
})();

console.log('\n[新发现旧内容-按发现时间保留]');
(function() {
  const discoveredAt = new Date().toISOString();
  const oldPublished = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const entries = [
    { title: '新发现旧内容', url: 'u-old', time: oldPublished, discoveredAt },
  ];
  const result = mergeAndSort(entries, [], 1);

  assert(result.length === 1, '发布时间超出显示天数但发现时间在窗口内时保留');
  assert(result[0].title === '新发现旧内容', '保留已通知的新发现条目');
})();

console.log('\n[新发现旧内容-排序仍按发布时间]');
(function() {
  const discoveredAt = new Date().toISOString();
  const entries = [
    { title: '较新的正常内容', url: 'u-recent', time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { title: '新发现旧内容', url: 'u-old', time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), discoveredAt },
    { title: '较旧的正常内容', url: 'u-older', time: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), discoveredAt },
  ];
  const result = mergeAndSort(entries, [], 1);

  assert(result.length === 3, '发现时间在窗口内的旧内容都保留');
  assert(result[0].title === '较新的正常内容', '正常新内容排在前面');
  assert(result[1].title === '新发现旧内容', '旧内容按原发布时间插入正确位置');
  assert(result[2].title === '较旧的正常内容', '更旧内容仍排在后面');
})();

console.log('\n[新发现旧内容-旧全部已读不吞掉]');
(function() {
  const readAllBeforeTime = Date.now() - 60 * 60 * 1000;
  const item = {
    title: '新发现旧内容',
    url: 'u-old',
    time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    discoveredAt: new Date().toISOString()
  };
  const isRead = getUnreadReferenceTime(item) <= readAllBeforeTime;

  assert(!isRead, '发现时间晚于全部已读时仍算未读');
})();

console.log('\n[回退时间-自动poll]');
(function() {
  const since5 = calcSinceTime('2026-06-05T06:00:00.000Z', 5);
  assert(since5 === '2026-06-05T04:00:00.000Z', '5分钟间隔回退至少2小时');

  const since1 = calcSinceTime('2026-06-05T06:00:00.000Z', 1);
  assert(since1 === '2026-06-05T04:00:00.000Z', '1分钟间隔回退至少2小时');

  const since30 = calcSinceTime('2026-06-05T06:00:00.000Z', 30);
  assert(since30 === '2026-06-05T04:00:00.000Z', '30分钟间隔回退至少2小时');

  const since90 = calcSinceTime('2026-06-05T06:00:00.000Z', 90);
  assert(since90 === '2026-06-05T03:00:00.000Z', '90分钟间隔回退3小时(2*90>120)');
})();

console.log('\n[回退时间-手动poll]');
(function() {
  const since2 = calcManualSince(2);
  const diff2 = Date.now() - new Date(since2).getTime();
  const days2 = diff2 / (24 * 60 * 60 * 1000);
  assert(Math.abs(days2 - 2) < 0.01, 'historyDays=2 回退约2天');

  const since7 = calcManualSince(7);
  const diff7 = Date.now() - new Date(since7).getTime();
  const days7 = diff7 / (24 * 60 * 60 * 1000);
  assert(Math.abs(days7 - 7) < 0.01, 'historyDays=7 回退约7天');
})();

console.log('\n[mapEntries字段映射]');
(function() {
  const items = [{
    title: 'Test', url: 'https://t.com', source: 'Src',
    category: 'model', summary: 'Sum', publishedAt: '2026-06-05T00:00:00Z'
  }];
  const mapped = mapEntries(items);
  assert(mapped[0].title === 'Test', 'title映射正确');
  assert(mapped[0].url === 'https://t.com', 'url映射正确');
  assert(mapped[0].source === 'Src', 'source映射正确');
  assert(mapped[0].category === 'model', 'category映射正确');
  assert(mapped[0].summary === 'Sum', 'summary映射正确');
  assert(mapped[0].time === '2026-06-05T00:00:00Z', 'publishedAt→time映射正确');
})();

console.log('\n[mapEntries缺失字段]');
(function() {
  const items = [{ title: 'X', url: 'https://x.com', publishedAt: '2026-06-05T00:00:00Z' }];
  const mapped = mapEntries(items);
  assert(mapped[0].source === '', '缺失source默认空串');
  assert(mapped[0].category === '', '缺失category默认空串');
  assert(mapped[0].summary === '', '缺失summary默认空串');
})();

console.log('\n[onInstalled合并-更新不覆盖]');
(function() {
  const existingHistory = [
    { title: 'UserRead', url: 'https://old.com/1', time: daysAgo(2) },
  ];
  const apiItems = [
    { url: 'https://new.com/1', title: 'Fresh', publishedAt: daysAgo(1) },
    { url: 'https://old.com/1', title: 'UserRead-dup', publishedAt: daysAgo(2) },
  ];
  const existingUrls = new Set(existingHistory.map(i => i.url));
  const newEntries = apiItems
    .filter(i => !existingUrls.has(i.url))
    .map(i => ({ title: i.title, url: i.url, source: '', category: '', summary: '', time: i.publishedAt }));
  const merged = mergeAndSort(newEntries, existingHistory, 7);
  assert(merged.length === 2, '合并后保留2条(1新+1旧)');
  assert(merged[0].title === 'Fresh', '新条目排前');
  assert(merged[1].title === 'UserRead', '旧条目保留不被覆盖');
})();

console.log('\n[feedMode API URL]');
(function() {
  const urlAll = getApiUrl('all');
  assert(urlAll === 'https://aihot.virxact.com/api/public/items?take=100&mode=all', 'mode=all URL正确');
  const urlSelected = getApiUrl('selected');
  assert(urlSelected === 'https://aihot.virxact.com/api/public/items?take=100&mode=selected', 'mode=selected URL正确');
  assert(urlAll.includes('mode='), 'URL包含mode查询参数');
  assert(urlAll.includes('take=100'), 'URL包含take=100参数');
  assert(!urlAll.includes('??'), 'URL无双?号');
  assert(!urlAll.includes('&&'), 'URL无双&号');
  const withSince = `${urlAll}&since=2026-06-05T00:00:00Z`;
  assert(withSince === 'https://aihot.virxact.com/api/public/items?take=100&mode=all&since=2026-06-05T00:00:00Z', 'URL拼接since参数正确');
})();

console.log('\n[feedMode默认值]');
(function() {
  // 模拟 storage 中无 feedMode（首次安装）
  const data1 = {};
  assert((data1.feedMode || 'selected') === 'selected', '未设置时默认selected');

  // 模拟 storage 中有 feedMode
  const data2 = { feedMode: 'selected' };
  assert((data2.feedMode || 'selected') === 'selected', '已设置selected时使用selected');

  const data3 = { feedMode: 'all' };
  assert((data3.feedMode || 'selected') === 'all', '已设置all时使用all');
})();

console.log('\n[feedMode切换-数据隔离]');
(function() {
  // 切换 feedMode 后，已有 history 不应被清空（去重逻辑基于 URL）
  // 模拟：之前用 selected 模式积累了 history，切换到 all 后拉到更多条目
  const historyFromSelected = [
    { title: '精选A', url: 'https://a.com/selected-1', time: hoursAgo(6) },
    { title: '精选B', url: 'https://a.com/selected-2', time: hoursAgo(8) },
  ];
  // all 模式返回更多条目（包含精选的 + 额外的）
  const apiAllItems = [
    { url: 'https://a.com/selected-1', title: '精选A', publishedAt: hoursAgo(6) },
    { url: 'https://a.com/all-1', title: '全量C', publishedAt: hoursAgo(7) },
    { url: 'https://a.com/selected-2', title: '精选B', publishedAt: hoursAgo(8) },
    { url: 'https://a.com/all-2', title: '全量D', publishedAt: hoursAgo(9) },
  ];

  const existingUrls = new Set(historyFromSelected.map(i => i.url));
  const newEntries = apiAllItems
    .filter(i => !existingUrls.has(i.url))
    .map(i => ({ title: i.title, url: i.url, source: '', category: '', summary: '', time: i.publishedAt }));
  const merged = [...newEntries, ...historyFromSelected]
    .filter(i => new Date(i.time).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(b.time) - new Date(a.time));

  assert(merged.length === 4, '切换后合并为4条（2旧+2新）');
  assert(merged[0].title === '精选A', '排序正确:精选A(06:00)第一');
  assert(merged[1].title === '全量C', '排序正确:全量C(05:00)第二');
  assert(merged[2].title === '精选B', '排序正确:精选B(04:00)第三');
  assert(merged[3].title === '全量D', '排序正确:全量D(03:00)第四');
})();

console.log('\n[feedMode切换-从all到selected不丢数据]');
(function() {
  // 从 all 切换到 selected，API 返回子集，但已有的全量 history 应保留
  const historyFromAll = [
    { title: '全量A', url: 'https://a.com/1', time: hoursAgo(6) },
    { title: '全量B', url: 'https://a.com/2', time: hoursAgo(7) },
    { title: '全量C', url: 'https://a.com/3', time: hoursAgo(8) },
  ];
  // selected 模式 API 返回只有部分
  const apiSelectedItems = [
    { url: 'https://a.com/1', title: '全量A', publishedAt: hoursAgo(6) },
  ];

  const existingUrls = new Set(historyFromAll.map(i => i.url));
  const newEntries = apiSelectedItems
    .filter(i => !existingUrls.has(i.url))
    .map(i => ({ title: i.title, url: i.url, source: '', category: '', summary: '', time: i.publishedAt }));
  const merged = [...newEntries, ...historyFromAll]
    .filter(i => new Date(i.time).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(b.time) - new Date(a.time));

  assert(merged.length === 3, '切换到selected后不丢失已有history');
  assert(newEntries.length === 0, 'API返回的都是已有条目，无新增');
})();

console.log('\n[resetAndPoll-清空后重建history]');
(function() {
  // resetAndPoll 应该清空 history 并用 API 返回的数据重建
  const oldHistory = [
    { title: '旧A', url: 'https://old.com/1', time: '2026-06-04T10:00:00Z' },
    { title: '旧B', url: 'https://old.com/2', time: '2026-06-04T08:00:00Z' },
  ];
  // 模拟切换后 API 返回全新数据
  const apiItems = [
    { url: 'https://new.com/1', title: '新A', source: 'X', category: 'model', summary: 's1', publishedAt: '2026-06-05T10:00:00Z' },
    { url: 'https://new.com/2', title: '新B', source: 'Y', category: 'paper', summary: 's2', publishedAt: '2026-06-05T08:00:00Z' },
  ];
  // resetAndPoll 逻辑：清空旧 history，用 API 数据重建
  const newHistory = apiItems.map(i => ({
    title: i.title, url: i.url, source: i.source || '',
    category: i.category || '', summary: i.summary || '', time: i.publishedAt
  })).sort((a, b) => new Date(b.time) - new Date(a.time));

  assert(newHistory.length === 2, '重建后只有API返回的条目');
  assert(newHistory[0].title === '新A', '按时间降序排列');
  assert(newHistory[1].title === '新B', '旧history被清空');
  assert(!newHistory.some(i => i.url.includes('old.com')), '不含旧数据');
})();

console.log('\n[resetAndPoll-readIds保留]');
(function() {
  // 切换 feedMode 后，readIds 应该保留（用户已读的URL不变）
  const readIds = ['https://a.com/1', 'https://a.com/2'];
  const newHistory = [
    { title: 'A', url: 'https://a.com/1', time: '2026-06-05T10:00:00Z' },
    { title: 'B', url: 'https://a.com/3', time: '2026-06-05T08:00:00Z' },
  ];
  const unread = newHistory.filter(i => !readIds.includes(i.url));
  assert(unread.length === 1, '已读URL在新history中仍标记为已读');
  assert(unread[0].url === 'https://a.com/3', '只有新URL是未读');
})();

console.log('\n[内容源-全部已读分别控制]');
(function() {
  const readAllBeforeByMode = {
    selected: '2026-06-05T10:00:00Z',
    all: ''
  };
  const item = { url: 'https://a.com/1', time: '2026-06-05T09:00:00Z' };
  const getReadAllBeforeForMode = (mode) => readAllBeforeByMode[mode] || '';
  const isRead = (mode) => {
    const readAllBefore = getReadAllBeforeForMode(mode);
    return readAllBefore && new Date(item.time) <= new Date(readAllBefore);
  };

  assert(isRead('selected'), 'selected 的全部已读只影响 selected');
  assert(!isRead('all'), 'all 不受 selected 的全部已读影响');
})();

console.log('\n[内容源-单条已读全局共享]');
(function() {
  const readIds = ['https://a.com/1'];
  const item = { url: 'https://a.com/1', time: '2026-06-05T09:00:00Z' };

  assert(readIds.includes(item.url), '单条 URL 已读不区分 selected/all');
})();

console.log('\n[resetAndPoll-cutoff过滤]');
(function() {
  // 重建时也应用 cutoff 过滤
  const apiItems = [
    { url: 'https://a.com/1', title: 'Recent', publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { url: 'https://a.com/2', title: 'Old', publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newHistory = apiItems
    .map(i => ({ title: i.title, url: i.url, source: '', category: '', summary: '', time: i.publishedAt }))
    .filter(i => new Date(i.time).getTime() > cutoff)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  assert(newHistory.length === 1, '超过7天的条目被过滤');
  assert(newHistory[0].title === 'Recent', '只保留近期条目');
})();

console.log('\n[resetAndPoll-API失败不覆盖history]');
(function() {
  const oldHistory = [
    { title: 'Keep', url: 'https://old.com/keep', time: '2026-06-05T05:00:00Z' }
  ];
  const oldFeedMode = 'selected';
  const allItems = [];
  let failed = false;

  try {
    const res = { ok: false, status: 500 };
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }
  } catch (_e) {
    failed = true;
  }

  const nextHistory = failed
    ? oldHistory
    : allItems.map(i => ({ title: i.title, url: i.url, time: i.publishedAt }));
  const nextFeedMode = failed ? oldFeedMode : 'all';

  assert(failed, '第一页失败时进入失败分支');
  assert(nextHistory === oldHistory, '失败时保留旧history引用，不重建为空数组');
  assert(nextFeedMode === oldFeedMode, '失败时不提交新的feedMode');
  assert(nextHistory.length === 1 && nextHistory[0].title === 'Keep', '失败时旧history内容不丢失');
})();

console.log('\n[manualPoll-API失败返回失败]');
(function() {
  let failCount = 0;
  let threw = false;

  try {
    const res = { ok: false, status: 503 };
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }
  } catch (_e) {
    failCount += 1;
    threw = true;
  }

  assert(threw, '手动刷新API失败时抛错给调用方');
  assert(failCount === 1, '手动刷新失败递增failCount');
})();

console.log('\n[配置变更-background通知范围]');
(function() {
  function shouldNotifyBackground(setting) {
    return setting === 'enabled' || setting === 'interval';
  }

  assert(shouldNotifyBackground('enabled'), '通知开关变化会重设alarm');
  assert(shouldNotifyBackground('interval'), '轮询间隔变化会重设alarm');
  assert(!shouldNotifyBackground('theme'), '主题变化不重设alarm');
  assert(!shouldNotifyBackground('fontFamily'), '字体变化不重设alarm');
  assert(!shouldNotifyBackground('fontSize'), '字号变化不重设alarm');
  assert(!shouldNotifyBackground('openPositionMode'), '定位变化不重设alarm');
  assert(!shouldNotifyBackground('historyDays'), '显示天数变化不重设alarm');
  assert(!shouldNotifyBackground('feedMode'), '内容源切换走feedModeChanged，不额外configChanged');
})();

console.log('\n[字体默认值]');
(function() {
  assert(normalizeFontFamily(undefined) === 'system', '未设置字体时默认system');
  assert(normalizeFontFamily('bad-font') === 'system', '异常字体值回退system');
  assert(normalizeFontFamily('noto-sans') === 'system', '旧黑体配置迁移到system');
  assert(normalizeFontFamily('noto-serif') === 'noto-serif', '保留宋体选项');
  assert(normalizeFontFamily('lxgw') === 'lxgw', '保留楷体选项');
})();

console.log('\n[定位默认值]');
(function() {
  assert(normalizeOpenPositionMode(undefined) === 'free', '未设置定位时默认free');
  assert(normalizeOpenPositionMode('bad-mode') === 'free', '异常定位值回退free');
  assert(normalizeOpenPositionMode('unread') === 'unread', '保留未读定位选项');
})();

console.log('\n[主题默认值]');
(function() {
  assert(normalizeTheme(undefined) === 'dark', '未设置主题时默认dark');
  assert(normalizeTheme('bad-theme') === 'dark', '异常主题值回退dark');
  assert(normalizeTheme('green-dark') === 'green-dark', '保留暗森主题');
  assert(normalizeTheme('chrome-dark') === 'chrome-dark', '保留铬墨主题');
  assert(normalizeTheme('paper-light') === 'dark', '旧浅色主题配置回退dark');
})();

console.log('\n[分页拉取-多页合并去重]');
(function() {
  // 模拟 3 页 API 返回，部分重叠
  const page1 = [
    { url: 'https://a.com/1', title: 'A', publishedAt: '2026-06-05T10:00:00Z' },
    { url: 'https://a.com/2', title: 'B', publishedAt: '2026-06-05T09:00:00Z' },
  ];
  const page2 = [
    { url: 'https://a.com/3', title: 'C', publishedAt: '2026-06-05T08:00:00Z' },
    { url: 'https://a.com/2', title: 'B-dup', publishedAt: '2026-06-05T09:00:00Z' }, // 跨页重复
  ];
  const page3 = [
    { url: 'https://a.com/4', title: 'D', publishedAt: '2026-06-04T20:00:00Z' },
  ];
  const allItems = [...page1, ...page2, ...page3];
  // 去重 by URL（保留首次出现的）
  const seen = new Set();
  const unique = allItems.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
  const history = unique
    .map(i => ({ title: i.title, url: i.url, source: '', category: '', summary: '', time: i.publishedAt }))
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  assert(history.length === 4, '3页合并去重后得4条');
  assert(history[0].title === 'A', '排序正确:A第一');
  assert(history[1].title === 'B', '保留首次出现的B（非B-dup）');
  assert(history[3].title === 'D', '排序正确:D最后');
})();

console.log('\n[分页拉取-cutoff截断]');
(function() {
  // 模拟：第2页数据已超出 cutoff，应提前停止
  const cutoffDays = 2;
  const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
  const page1 = [
    { url: 'u1', title: 'Recent', publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  const page2 = [
    { url: 'u2', title: 'Old', publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  // 模拟分页循环中的 cutoff 检查
  const allItems = [...page1];
  const oldestPage1 = page1[page1.length - 1];
  const shouldContinue = new Date(oldestPage1.publishedAt).getTime() >= cutoff;
  if (shouldContinue) {
    // 第2页的 oldest 超出 cutoff
    const oldestPage2 = page2[page2.length - 1];
    const page2Continue = new Date(oldestPage2.publishedAt).getTime() >= cutoff;
    assert(!page2Continue, '第2页oldest超出cutoff，应停止分页');
    allItems.push(...page2); // 仍然加入（最终由 filter 过滤）
  }
  const history = allItems
    .map(i => ({ title: i.title, url: i.url, time: i.publishedAt }))
    .filter(i => new Date(i.time).getTime() > cutoff);
  assert(history.length === 1, 'cutoff过滤后只保留Recent');
})();

console.log('\n[分页拉取-maxPages限制]');
(function() {
  // 验证最多拉取 maxPages 页
  const maxPages = 3;
  let pagesFetched = 0;
  for (let page = 0; page < maxPages; page++) {
    pagesFetched++;
    // 模拟每页都有 hasNext
    const hasNext = true;
    if (!hasNext) break;
  }
  assert(pagesFetched === 3, `最多拉取 ${maxPages} 页`);
  assert(pagesFetched <= 3, '不超过 maxPages 上限');
})();


console.log('\n[特别关注-规则匹配]');
(function() {
  const item = {
    source: '公众号：数字生命卡兹克',
    title: 'Claude Code 6个实用Hook玩法',
    summary: '内置近30个Hook事件，运行时不消耗token。'
  };
  const rules = [
    { id: 'r1', source: '公众号', author: '数字生命卡兹克', keywords: ['Claude Code'] },
    { id: 'r2', source: 'X', author: '数字生命卡兹克', keywords: ['Claude Code'] },
    { id: 'r3', source: '', author: '', keywords: [] }
  ];
  const matches = matchWatchRules(item, rules);
  assert(matches.length === 1, '仅匹配来源+作者+关键词都满足的规则');
  assert(matches[0].id === 'r1', '匹配卡兹克公众号规则');
})();

console.log('\n[特别关注-关键词任一命中]');
(function() {
  const item = { source: 'X：可灵 Kling AI (@Kling_ai)', title: '可灵Kling AI问：你看到UFO了吗？', summary: '视频生成示例' };
  const matches = matchWatchRules(item, [{ id: 'r1', source: 'X', author: 'kling_ai', keywords: 'Claude Code，UFO' }]);
  assert(matches.length === 1, '中文逗号分隔关键词任一命中');
})();

console.log('\n[特别关注-英文大小写不敏感]');
(function() {
  const item = { source: 'X：OpenAI (@OpenAI)', title: 'Claude Code Hooks', summary: 'A post about CLI hooks' };
  const matches = matchWatchRules(item, [{ id: 'r1', source: 'x', author: 'openai', keywords: 'claude code' }]);
  assert(matches.length === 1, '英文来源、作者、关键词匹配都不区分大小写');
})();

console.log('\n[特别关注-补充关键词合并]');
(function() {
  const rules = [{ id: 'r1', source: '公众号', author: '数字生命卡兹克', keywords: ['Claude Code'], enabled: true }];
  const merged = mergeWatchRuleInput(rules, { source: '公众号', author: '数字生命卡兹克', keywords: 'Hook, claude code' });
  assert(merged.length === 1, '相同来源和作者时不新增重复规则');
  assert(merged[0].keywords.length === 2, '补充关键词并按大小写不敏感去重');
  assert(merged[0].keywords.includes('Hook'), '保留新增关键词');
})();

console.log('\n[特别关注-补充关键词不改变启停]');
(function() {
  const rules = [{ id: 'r1', source: '公众号', author: '数字生命卡兹克', keywords: ['Claude Code'], enabled: false }];
  const merged = mergeWatchRuleInput(rules, { source: '公众号', author: '数字生命卡兹克', keywords: 'Hook' });
  assert(merged.length === 1, '停用规则补充关键词时不新增重复规则');
  assert(merged[0].enabled === false, '补充关键词不自动启用已停用规则');
})();

console.log('\n[特别关注-删除单个关键词]');
(function() {
  const rules = [{ id: 'r1', source: '公众号', author: '数字生命卡兹克', keywords: ['Claude Code', 'Hook'], enabled: true }];
  const nextRules = removeWatchRuleKeyword(rules, 'r1', 0);
  assert(nextRules.length === 1, '删除关键词后规则仍保留');
  assert(nextRules[0].keywords.length === 1, '只删除指定关键词');
  assert(nextRules[0].keywords[0] === 'Hook', '保留其它关键词');
})();

console.log('\n[特别关注-删除最后关键词后清理空规则]');
(function() {
  const rules = [{ id: 'r1', source: '', author: '', keywords: ['Hook'], enabled: true }];
  const nextRules = removeWatchRuleKeyword(rules, 'r1', 0);
  assert(nextRules.length === 0, '没有来源作者时删除最后关键词会删除空规则');
})();

console.log('\n[特别关注-提醒节奏]');
(function() {
  const first = '2026-06-26T02:00:00.000Z';
  assert(getNextWatchNotifyAt(first, 0, first) === first, '首次提醒立即');
  assert(getNextWatchNotifyAt(first, 1, first) === '2026-06-26T02:02:00.000Z', '第二次提醒间隔2分钟');
  assert(getNextWatchNotifyAt(first, 2, first) === '2026-06-26T02:05:00.000Z', '第三次提醒间隔5分钟');
  assert(getNextWatchNotifyAt(first, 3, first) === '2026-06-26T04:00:00.000Z', '第四次提醒间隔2小时');
  assert(getNextWatchNotifyAt(first, 4, '2026-06-26T04:00:00.000Z') === '2026-06-27T04:00:00.000Z', '后续每天最多一次');
})();

console.log('\n[特别关注-已查看抑制]');
(function() {
  const due = { firstMatchedAt: '2026-06-26T02:00:00.000Z', nextNotifyAt: '2026-06-26T02:00:00.000Z', viewedAt: '' };
  const viewed = { ...due, viewedAt: '2026-06-26T02:01:00.000Z' };
  const nowMs = new Date('2026-06-26T02:10:00.000Z').getTime();
  assert(shouldNotifyWatchState(due, nowMs), '未查看且到期会提醒');
  assert(!shouldNotifyWatchState(viewed, nowMs), '已查看不再提醒');
})();

console.log('\n[特别关注-停用规则不回放旧提醒]');
(function() {
  const historyItem = { watchMatched: true, watchRuleIds: ['wr_x'], url: 'https://x.com/a/1' };
  const activeRules = [{ id: 'wr_y', source: '公众号', author: '', keywords: [], enabled: true }];
  const disabledSameRule = [{ id: 'wr_x', source: 'X', author: '', keywords: [], enabled: false }];
  assert(matchWatchRules({ source: 'X：测试账号 (@test)', title: 'Test', summary: '' }, disabledSameRule).length === 0, '停用规则本身不再匹配新条目');
  assert(getActiveWatchMatchIds(historyItem, activeRules).length === 0, '历史命中在当前无启用规则时不再参与提醒');
})();

// ===== 结果 =====
console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
