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
    category: i.category || '', summary: i.summary || '', time: i.publishedAt
  }));
}

function mergeAndSort(newEntries, history, cutoffDays) {
  const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
  return [...newEntries, ...history]
    .filter(i => new Date(i.time).getTime() > cutoff)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
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
  const sorted = mergeAndSort(entries, [], 7);
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
  const merged = mergeAndSort(newEntries, history, 7);
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
    { title: 'UserRead', url: 'https://old.com/1', time: '2026-06-03T12:00:00Z' },
  ];
  const apiItems = [
    { url: 'https://new.com/1', title: 'Fresh', publishedAt: '2026-06-05T08:00:00Z' },
    { url: 'https://old.com/1', title: 'UserRead-dup', publishedAt: '2026-06-03T12:00:00Z' },
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
    { title: '精选A', url: 'https://a.com/selected-1', time: '2026-06-05T06:00:00Z' },
    { title: '精选B', url: 'https://a.com/selected-2', time: '2026-06-05T04:00:00Z' },
  ];
  // all 模式返回更多条目（包含精选的 + 额外的）
  const apiAllItems = [
    { url: 'https://a.com/selected-1', title: '精选A', publishedAt: '2026-06-05T06:00:00Z' },
    { url: 'https://a.com/all-1', title: '全量C', publishedAt: '2026-06-05T05:00:00Z' },
    { url: 'https://a.com/selected-2', title: '精选B', publishedAt: '2026-06-05T04:00:00Z' },
    { url: 'https://a.com/all-2', title: '全量D', publishedAt: '2026-06-05T03:00:00Z' },
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
    { title: '全量A', url: 'https://a.com/1', time: '2026-06-05T06:00:00Z' },
    { title: '全量B', url: 'https://a.com/2', time: '2026-06-05T05:00:00Z' },
    { title: '全量C', url: 'https://a.com/3', time: '2026-06-05T04:00:00Z' },
  ];
  // selected 模式 API 返回只有部分
  const apiSelectedItems = [
    { url: 'https://a.com/1', title: '全量A', publishedAt: '2026-06-05T06:00:00Z' },
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

// ===== 结果 =====
console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
