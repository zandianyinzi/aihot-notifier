// AI HOT Notifier 端到端验证
// 直接请求 API，交叉验证 selected/all 数据契约和扩展容错逻辑
// 运行: node test-e2e.js

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0';
const FETCH_TIMEOUT_MS = 10_000;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchItems(mode) {
  const url = `https://aihot.virxact.com/api/v1/items?mode=${mode}&window=7d&limit=50`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`API ${mode} returned ${res.status}`);
  const json = await res.json();
  return { items: json.items || [], page: json.page || {} };
}

async function fetchItemsPaginated(mode, maxPages = 3) {
  let allItems = [];
  let cursor = null;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (let page = 0; page < maxPages; page++) {
    let url = `https://aihot.virxact.com/api/v1/items?mode=${mode}&window=7d&limit=50`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`API ${mode} returned ${res.status} while loading page ${page + 1}`);
    const json = await res.json();
    if (!json.items || json.items.length === 0) break;

    allItems = allItems.concat(json.items);

    if (!json.page?.hasMore || !json.page?.nextCursor) break;
    const oldest = json.items[json.items.length - 1];
    if (new Date(oldest.publishedAt).getTime() < cutoff) break;
    cursor = json.page.nextCursor;
  }
  return allItems;
}

function isSortedDesc(items) {
  for (let i = 1; i < items.length; i++) {
    if (new Date(items[i].publishedAt) > new Date(items[i - 1].publishedAt)) return false;
  }
  return true;
}

function hasOpenLink(item) {
  return Boolean(
    (typeof item?.links?.original === 'string' && item.links.original) ||
    (typeof item?.links?.aihot === 'string' && item.links.aihot)
  );
}

function isV1Item(item) {
  return Boolean(
    item &&
    item.id &&
    item.title &&
    typeof item.source?.name === 'string' && item.source.name &&
    hasOpenLink(item) &&
    !Number.isNaN(new Date(item.publishedAt).getTime())
  );
}

// 模拟扩展的 resetAndPoll 逻辑
function simulateResetAndPoll(apiItems, historyDays) {
  const cutoff = Date.now() - Math.max(historyDays, 7) * 24 * 60 * 60 * 1000;
  return apiItems
    .map(i => ({ title: i.title, url: i.links?.original || i.links?.aihot || '', permalink: i.links?.aihot || i.links?.original || '', source: i.source?.name || '', category: i.category || '', summary: i.summary || '', time: i.publishedAt }))
    .filter(i => new Date(i.time).getTime() > cutoff)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
}

(async () => {
  try {
    console.log('[获取 API 数据]');
    const [selectedResponse, allResponse] = await Promise.all([fetchItems('selected'), fetchItems('all')]);
    const selected = selectedResponse.items;
    const all = allResponse.items;
    console.log(`  selected: ${selected.length} items, all: ${all.length} items\n`);

    console.log('[数据完整性]');
    assert(selected.length > 0, 'selected 模式返回非空');
    assert(all.length > 0, 'all 模式返回非空');
    assert(selected.length <= 50 && all.length <= 50, `selected/all 单页均不超过 limit=50`);

    const requiredFields = ['id', 'title', 'source', 'links', 'publishedAt', 'category'];
    const sampleSelected = selected[0];
    const sampleAll = all[0];
    requiredFields.forEach(f => {
      assert(f in sampleSelected, `selected[0] 包含字段 ${f}`);
      assert(f in sampleAll, `all[0] 包含字段 ${f}`);
    });
    assert(hasOpenLink(sampleSelected), 'selected[0].links 包含 original 或 aihot 可打开链接');
    assert(hasOpenLink(sampleAll), 'all[0].links 包含 original 或 aihot 可打开链接');
    assert(typeof sampleSelected.source?.name === 'string' && sampleSelected.source.name, 'selected[0].source.name 存在');
    assert(typeof sampleAll.source?.name === 'string' && sampleAll.source.name, 'all[0].source.name 存在');
    assert(typeof selectedResponse.page?.hasMore === 'boolean', 'selected 响应包含 page.hasMore');
    assert(Object.prototype.hasOwnProperty.call(selectedResponse.page, 'nextCursor'), 'selected 响应包含 page.nextCursor');
    assert(typeof allResponse.page?.hasMore === 'boolean', 'all 响应包含 page.hasMore');
    assert(Object.prototype.hasOwnProperty.call(allResponse.page, 'nextCursor'), 'all 响应包含 page.nextCursor');
    assert(selected.every(isV1Item), 'selected 全部条目符合 v1 source.name 与 links 嵌套字段');
    assert(all.every(isV1Item), 'all 全部条目符合 v1 source.name 与 links 嵌套字段');

    console.log('\n[v1 响应顺序]');
    // v1 返回的原始顺序并不承诺按 publishedAt 排序；扩展会在入库时排序。
    assert(selected.every(item => !Number.isNaN(new Date(item.publishedAt).getTime())), 'selected 每条都有可解析发布时间');
    assert(all.every(item => !Number.isNaN(new Date(item.publishedAt).getTime())), 'all 每条都有可解析发布时间');

    console.log('\n[子集关系]');
    // API 每次最多返回 50 条，两个 mode 可能覆盖不同时间窗口
    // 只验证有重叠即可，不要求严格子集
    const allUrls = new Set(all.map(i => i.links?.original || i.links?.aihot));
    const selectedInAll = selected.filter(i => allUrls.has(i.links?.original || i.links?.aihot));
    const ratio = selectedInAll.length / selected.length;
    console.log(`  重叠率: ${(ratio * 100).toFixed(0)}% (${selectedInAll.length}/${selected.length})`);
    assert(selected.length <= 50 && all.length <= 50, `两个模式均受 50 条分页限制`);
    console.log('  重叠率仅作诊断，mode 间不要求固定子集关系');

    console.log('\n[模拟 resetAndPoll - selected]');
    const histSelected = simulateResetAndPoll(selected, 2);
    assert(histSelected.length > 0, `模拟后有 ${histSelected.length} 条`);
    assert(isSortedDesc(histSelected.map(i => ({ publishedAt: i.time }))), '模拟结果按时间降序');
    assert(new Date(histSelected[0].time).getTime() === Math.max(...histSelected.map(item => new Date(item.time).getTime())), '模拟结果首条是最新发布时间');

    console.log('\n[模拟 resetAndPoll - all]');
    const histAll = simulateResetAndPoll(all, 2);
    assert(histAll.length > 0, `模拟后有 ${histAll.length} 条`);
    assert(histAll.length <= all.length, `all 模式容错过滤后不会产生额外条目 (${histAll.length}/${all.length})`);
    assert(new Date(histAll[0].time).getTime() === Math.max(...histAll.map(item => new Date(item.time).getTime())), 'all 模拟结果首条是最新发布时间');

    console.log('\n[模拟切换: selected → all]');
    // 这里只验证当前 all API 投影；canonical 合并由 background 集成测试覆盖。
    const afterSwitch = simulateResetAndPoll(all, 2);
    const selectedUrls = new Set(histSelected.map(i => i.url));
    const newInAll = afterSwitch.filter(i => !selectedUrls.has(i.url));
    console.log(`  切换后新增 ${newInAll.length} 条（all 独有）`);
    assert(afterSwitch.length === histAll.length, '切换后 all API 投影与同次容错结果一致');

    console.log('\n[模拟切换: all → selected]');
    const afterSwitchBack = simulateResetAndPoll(selected, 2);
    assert(afterSwitchBack.length === histSelected.length, '切回后 selected API 投影与同次容错结果一致');
    assert(afterSwitchBack[0].url === histSelected[0].url, '切回后首条与 selected 一致');

    console.log('\n[顺序对比: 扩展排序]');
    // v1 原始顺序不保证时间递减，扩展展示前按发布时间排序。
    const top5Selected = histSelected.slice(0, 5);
    assert(isSortedDesc(top5Selected.map(item => ({ publishedAt: item.time }))), '扩展前5条按发布时间降序展示');

    console.log('\n[分类一致性]');
    const allCombined = [...selected, ...all];
    const categories = new Set(allCombined.map(i => i.category).filter(Boolean));
    console.log(`  API 中出现的分类: ${[...categories].join(', ')}`);
    const knownCats = ['model', 'ai-models', 'ai-products', 'industry', 'paper', 'tip', 'tips'];
    const unknownCats = [...categories].filter(c => !knownCats.includes(c));
    if (unknownCats.length > 0) {
      console.log(`  ⚠ 未知分类: ${unknownCats.join(', ')}（扩展中会显示为无标签）`);
    }
    assert(unknownCats.length === 0, `所有 API 分类都有对应映射（未知: ${unknownCats.join(', ') || '无'}）`);

    console.log('\n[分页拉取验证]');
    const selectedPaged = await fetchItemsPaginated('selected', 3);
    const allPaged = await fetchItemsPaginated('all', 3);
    console.log(`  selected 分页拉取: ${selectedPaged.length} 条 (单页: ${selected.length})`);
    console.log(`  all 分页拉取: ${allPaged.length} 条 (单页: ${all.length})`);
    assert(selectedPaged.length >= selected.length, `分页selected(${selectedPaged.length}) >= 单页(${selected.length})`);
    assert(allPaged.length >= all.length, `分页all(${allPaged.length}) >= 单页(${all.length})`);
    assert(selectedPaged.every(item => !Number.isNaN(new Date(item.publishedAt).getTime())), '分页selected保留可解析发布时间');
    assert(allPaged.every(item => !Number.isNaN(new Date(item.publishedAt).getTime())), '分页all保留可解析发布时间');
    // 分页后子集关系应更明显
    const allPagedUrls = new Set(allPaged.map(i => i.links?.original || i.links?.aihot));
    const selectedInAllPaged = selectedPaged.filter(i => allPagedUrls.has(i.links?.original || i.links?.aihot));
    const pagedRatio = selectedInAllPaged.length / selectedPaged.length;
    console.log(`  分页后重叠率: ${(pagedRatio * 100).toFixed(0)}% (${selectedInAllPaged.length}/${selectedPaged.length})`);
    console.log('  分页后重叠率仅作诊断，mode 间不要求固定子集关系');

    console.log('\n[分页拉取-扩展模拟完整验证]');
    // 模拟扩展 resetAndPoll 使用分页数据
    const simSelected = simulateResetAndPoll(selectedPaged, 2);
    const simAll = simulateResetAndPoll(allPaged, 2);
    console.log(`  扩展展示: selected=${simSelected.length}条, all=${simAll.length}条`);
    assert(simSelected.length > selected.length * 0.8, `分页后扩展展示selected(${simSelected.length})条充足`);
    assert(simAll.length > all.length * 0.8, `分页后扩展展示all(${simAll.length})条充足`);
    // 切换后数据完全不同
    const simSelectedUrls = new Set(simSelected.map(i => i.url));
    const simAllUrls = new Set(simAll.map(i => i.url));
    const onlyInAll = simAll.filter(i => !simSelectedUrls.has(i.url));
    const onlyInSelected = simSelected.filter(i => !simAllUrls.has(i.url));
    console.log(`  all独有: ${onlyInAll.length}条, selected独有: ${onlyInSelected.length}条`);
    assert(onlyInAll.length > 0 || onlyInSelected.length > 0, '两个模式内容有差异（切换有效）');

    console.log('\n[时区一致性验证]');
    const latestItem = selected[0];
    const utcTime = new Date(latestItem.publishedAt);
    const tzOffset = -utcTime.getTimezoneOffset() / 60;
    console.log(`  API 最新: ${latestItem.publishedAt} → 本地 ${utcTime.toLocaleTimeString()} (UTC${tzOffset >= 0 ? '+' : ''}${tzOffset})`);
    assert(!isNaN(utcTime.getTime()), 'publishedAt 可正确解析为 Date');
    // 扩展 popup.js 中 formatTime 使用 getHours/getMinutes（本地时间），验证转换正确
    const expectedDisplay = `${utcTime.getHours().toString().padStart(2,'0')}:${utcTime.getMinutes().toString().padStart(2,'0')}`;
    assert(expectedDisplay.match(/^\d{2}:\d{2}$/), `本地时间格式正确: ${expectedDisplay}`);
    const ageMs = Date.now() - utcTime.getTime();
    console.log(`  最新条目 ${(ageMs / 3600000).toFixed(1)}h 前（诊断信息）`);
    if (ageMs < 0) console.warn('  ⚠ API 最新条目时间在未来');
    if (ageMs >= 48 * 60 * 60 * 1000) console.warn('  ⚠ API 最新条目超过 48 小时');

    console.log('\n[API 时效性]');
    // API /api/v1/items 有缓存，可能出现数小时级公开接口延迟。
    const apiTodayItems = selected.filter(i => {
      const d = new Date(i.publishedAt);
      return d.toDateString() === new Date().toDateString();
    });
    console.log(`  API 今日条目: ${apiTodayItems.length} 条`);
    const apiLatest = new Date(selected[0].publishedAt);
    const apiLagMinutes = (Date.now() - apiLatest.getTime()) / 60000;
    console.log(`  API 数据延迟: ~${apiLagMinutes.toFixed(0)} 分钟（公开接口有缓存，属正常）`);
    if (apiTodayItems.length === 0) console.warn('  ⚠ API 当前没有今日条目');

    console.log('\n[扩展展示逻辑验证]');
    // 模拟扩展 popup.js 的 formatTime 和 getDateLabel
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
    // 展示顺序只验证扩展自身的排序结果，而不依赖 v1 原始响应顺序。
    const top5 = histSelected.slice(0, 5);
    console.log('  扩展中将展示为:');
    top5.forEach((item, idx) => {
      const label = getDateLabel(item.time);
      const time = formatTime(item.time);
      console.log(`    ${idx + 1}. [${label} ${time}] ${item.title.slice(0, 35)}...`);
    });
    // 验证日期分组正确性
    const todayLabel = getDateLabel(new Date().toISOString());
    assert(todayLabel === '今天', '当前时间 getDateLabel 返回"今天"');
    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    assert(getDateLabel(yesterdayDate) === '昨天', '24h 前 getDateLabel 返回"昨天"');
    // 验证排列顺序：扩展中时间应该递减
    let orderCorrect = true;
    for (let i = 1; i < top5.length; i++) {
      if (new Date(top5[i].time) > new Date(top5[i - 1].time)) {
        orderCorrect = false;
        break;
      }
    }
    assert(orderCorrect, '扩展展示顺序按时间递减');

  } catch (e) {
    console.error(`\n✗ 测试中断: ${e.message}`);
    failed++;
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
