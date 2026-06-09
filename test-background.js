/**
 * 直接加载 background.js，验证 runtime message 到真实后台逻辑的关键路径。
 * 运行: node test-background.js
 */

let passed = 0;
let failed = 0;
let onMessageHandler = null;
let storageData = {};
let badgeText = null;
let fetchImpl = null;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function resetState(overrides = {}) {
  storageData = {
    enabled: true,
    interval: 5,
    lastCheck: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    feedMode: 'selected',
    history: [{ title: '旧内容', url: 'https://example.com/old', time: new Date().toISOString() }],
    historyDays: 1,
    readIds: [],
    readAllBefore: '',
    readAllBeforeByMode: {},
    failCount: 0,
    ...overrides
  };
  badgeText = null;
}

globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach(k => { if (k in storageData) result[k] = storageData[k]; });
          return Promise.resolve(result);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: storageData[keys] });
        }
        return Promise.resolve(storageData);
      },
      set: (obj) => {
        Object.assign(storageData, obj);
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  notifications: {
    create: () => Promise.resolve(),
    onClicked: { addListener: () => {} }
  },
  action: {
    setBadgeText: (opts) => { badgeText = opts.text; },
    setBadgeBackgroundColor: () => {}
  },
  alarms: {
    create: () => {},
    clear: () => Promise.resolve(),
    onAlarm: { addListener: () => {} }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (fn) => { onMessageHandler = fn; } }
  }
};

globalThis.fetch = (...args) => fetchImpl(...args);

require('./background.js');

function sendMessage(msg) {
  return new Promise((resolve) => {
    onMessageHandler(msg, {}, resolve);
  });
}

async function runTests() {
  console.log('\n[feedModeChanged失败]');
  resetState();
  const oldHistory = storageData.history;
  fetchImpl = () => Promise.resolve({ ok: false, status: 500 });

  const failedResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });

  assert(failedResponse.ok === false, '失败时返回 ok=false');
  assert(storageData.history === oldHistory, '失败时不覆盖旧 history');
  assert(storageData.feedMode === 'selected', '失败时不提交新 feedMode');
  assert(storageData.failCount === 1, '失败时递增 failCount');

  console.log('\n[feedModeChanged成功]');
  resetState();
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      items: [
        {
          title: '新内容',
          url: 'https://example.com/new',
          source: 'Test',
          category: 'industry',
          summary: 'summary',
          publishedAt: new Date().toISOString()
        }
      ],
      hasNext: false
    })
  });

  const successResponse = await sendMessage({ type: 'feedModeChanged', feedMode: 'all' });

  assert(successResponse.ok === true, '成功时返回 ok=true');
  assert(storageData.feedMode === 'all', '成功后提交新 feedMode');
  assert(storageData.history.length === 1 && storageData.history[0].title === '新内容', '成功后重建 history');
  assert(storageData.failCount === 0, '成功后清空 failCount');

  console.log('\n[pollNow失败]');
  resetState();
  fetchImpl = () => Promise.resolve({ ok: false, status: 503 });

  const pollResponse = await sendMessage({ type: 'pollNow' });

  assert(pollResponse.ok === false, '手动刷新失败返回 ok=false');
  assert(storageData.failCount === 1, '手动刷新失败递增 failCount');
  assert(badgeText === null || badgeText === '!', '手动刷新失败不误报未读数');

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
