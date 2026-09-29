const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const localRequire = createRequire(path.join(__dirname, 'background.js'));
const clone = value => structuredClone(value);
const now = new Date().toISOString();
const ago = hours => new Date(Date.now() - hours * 3600000).toISOString();
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 12; index++) await tick(); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 1500);
    })]);
  } finally { clearTimeout(timer); }
}
const rule = { id: 'watch-x', source: 'X', author: '', keywords: [], enabled: true };
function apiItem(id, extra = {}) {
  return { id, title: id, source: { name: 'X' }, selected: true,
    links: { original: `https://example.com/${id}`, aihot: `https://aihot.news/items/${id}` },
    publishedAt: now, ...extra };
}
function entry(id, extra = {}) {
  return { id, title: id, source: 'X', selected: true, url: `https://example.com/${id}`,
    time: ago(9), discoveredAt: ago(9), watchMatched: true, watchRuleIds: ['watch-x'], ...extra };
}
function dueState() {
  return { ruleIds: ['watch-x'], firstMatchedAt: ago(9), notifyCount: 1,
    lastNotifiedAt: ago(9), nextNotifyAt: ago(1), viewedAt: '' };
}
function response(items = [], extra = {}) {
  return { ok: true, status: 200, headers: { get: name => name.toLowerCase() === 'etag' ? 'W/"head"' : '' },
    json: async () => ({ items, page: { hasMore: false, nextCursor: null }, ...extra }) };
}

// Load the production worker unchanged. Only browser APIs and HTTP responses are simulated.
function fixture(options = {}) {
  const listeners = {};
  const notifications = [];
  const tabs = [];
  const writes = [];
  const errors = [];
  const data = { canonicalHistoryVersion: 1, apiNormalizationVersion: 1, enabled: true,
    interval: 5, feedMode: 'all', historyDays: 1, history: [], readIds: [], readAllBefore: '',
    readAllBeforeByMode: {}, watchRules: [], watchNotifyState: {}, failCount: 0,
    lastCheck: ago(1), lastItemsPollAt: ago(1), ...clone(options.state || {}) };
  const control = { badge: '', failBadge: false, ...options.control };
  const chrome = {
    storage: {
      local: {
        get: async keys => {
          const result = clone(typeof keys === 'string' ? { [keys]: data[keys] }
            : Array.isArray(keys) ? Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])) : data);
          if (options.getHook) await options.getHook(keys, result);
          return result;
        },
        set: async values => {
          if (options.setHook) await options.setHook(values);
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(data[key]) !== JSON.stringify(value)) changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
            data[key] = clone(value);
          }
          writes.push(clone(values));
          if (Object.keys(changes).length) queueMicrotask(() => listeners.storage?.(changes, 'local'));
        }
      },
      onChanged: { addListener: handler => { listeners.storage = handler; } }
    },
    notifications: {
      create: async (id, notification) => {
        if (options.notificationHook) await options.notificationHook(id, notification);
        notifications.push({ id, ...notification });
        return id;
      },
      onClicked: { addListener: handler => { listeners.click = handler; } },
      onClosed: { addListener: handler => { listeners.close = handler; } }
    },
    action: {
      setBadgeText: async ({ text }) => {
        if (control.failBadge) throw new Error('injected badge failure');
        if (options.badgeHook) await options.badgeHook(text);
        control.badge = text;
      },
      setBadgeBackgroundColor: async () => {}
    },
    tabs: { create: async tab => {
      if (options.tabHook) await options.tabHook(tab);
      tabs.push(tab);
      return { id: tabs.length };
    } },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener: handler => { listeners.alarm = handler; } } },
    runtime: {
      onInstalled: { addListener: handler => { listeners.install = handler; } },
      onStartup: { addListener: handler => { listeners.startup = handler; } },
      onMessage: { addListener: handler => { listeners.message = handler; } }
    }
  };
  const context = vm.createContext({ require: localRequire, module: { exports: {} }, chrome,
    TextEncoder, URL, AbortController, setTimeout, clearTimeout, __AIHOT_TEST_PAGE_DELAY_MS: 0,
    console: { log() {}, warn: (...args) => errors.push(args.map(String).join(' ')), error: (...args) => errors.push(args.map(String).join(' ')) },
    fetch: options.fetchHook || (async () => response(options.items || [])) });
  vm.runInContext(source, context, { filename: 'background.js' });
  return { data, control, notifications, tabs, writes, errors, context, chrome,
    poll: () => within(listeners.alarm({ name: 'aihot-poll' }), 'poll'),
    send: message => within(new Promise(resolve => listeners.message(message, {}, resolve)), message.type),
    click: id => within(listeners.click(id), 'notification click') };
}

test('an old empty badge snapshot cannot overwrite a later unread item', { timeout: 3000 }, async () => {
  const entered = deferred();
  const release = deferred();
  let held = false;
  const f = fixture({ items: [apiItem('new')], getHook: async keys => {
    if (!held && Array.isArray(keys) && keys.includes('readAllBeforeByMode')) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  } });
  await settle();
  const oldBadge = f.context.updateBadge();
  await within(entered.promise, 'old badge snapshot');
  const poll = f.poll();
  // A serialized badge updater may block the poll; release before awaiting either.
  await settle();
  release.resolve();
  await within(Promise.all([oldBadge, poll]), 'concurrent badge updates');
  await settle();
  assert.equal(f.notifications.length, 1);
  assert.equal(f.control.badge, '1');
});

test('a delayed unread badge write cannot overwrite a committed read', { timeout: 3000 }, async () => {
  const entered = deferred();
  const release = deferred();
  let held = false;
  const f = fixture({ state: { history: [entry('read-me')] }, badgeHook: async text => {
    if (!held && text === '1') { held = true; entered.resolve(); await release.promise; }
  } });
  await settle();
  const oldBadge = f.context.updateBadge();
  await within(entered.promise, 'old badge write');
  const read = f.send({ type: 'markItemsRead', ids: ['read-me'] });
  await settle();
  release.resolve();
  await within(Promise.all([oldBadge, read]), 'badge and read completion');
  await settle();
  assert.ok(f.data.readIds.includes('read-me'));
  assert.equal(f.control.badge, '');
});

test('a successful 200 poll still delivers an overdue watch reminder', { timeout: 3000 }, async () => {
  const f = fixture({ state: { history: [entry('old')], watchRules: [rule], watchNotifyState: { old: dueState() } } });
  await f.poll();
  assert.deepEqual(f.notifications.map(item => item.message), ['old']);
  assert.equal(f.data.watchNotifyState.old.notifyCount, 2);
});

test('new watch notices and old reminders share a three-notice cycle budget', { timeout: 3000 }, async () => {
  const f = fixture({ items: [apiItem('new-a'), apiItem('new-b')], state: {
    history: [entry('old-a'), entry('old-b')], watchRules: [rule],
    watchNotifyState: { 'old-a': dueState(), 'old-b': dueState() }
  } });
  await f.poll();
  assert.equal(f.notifications.length, 3);
  assert.equal(f.notifications.filter(item => item.message.startsWith('new-')).length, 2);
  assert.equal(f.notifications.filter(item => item.message.startsWith('old-')).length, 1);
});

test('partial watch delivery retains progress and never repeats A in the same cycle', { timeout: 3000 }, async () => {
  let attempts = 0;
  const f = fixture({ items: [apiItem('watch-a'), apiItem('watch-b')], state: { watchRules: [rule] },
    notificationHook: async () => { if (++attempts === 2) throw new Error('second notification failed'); } });
  const before = f.data.lastItemsPollAt;
  await f.poll();
  const deliveredA = f.notifications.filter(item => item.message === 'watch-a').length;
  assert.deepEqual({ deliveredA, persistedA: f.data.watchNotifyState['watch-a'].notifyCount, failCount: f.data.failCount },
    { deliveredA: 1, persistedA: 1, failCount: 0 });
  assert.notEqual(f.data.lastItemsPollAt, before);
  assert.ok(Object.values(f.data.apiFingerprintEtags || {}).includes('W/"head"'));
});

function clickedFixture(options = {}) {
  return fixture({ ...options, state: { history: [entry('watched')], watchRules: [rule],
    watchNotifyState: { watched: dueState() },
    notificationUrlMap: { 'aihot-watch-click': 'https://example.com/watched' },
    notificationStateKeyMap: { 'aihot-watch-click': 'watched' }, ...options.state } });
}

test('failed tab creation retains watch reminder state and notification mappings', { timeout: 3000 }, async () => {
  const f = clickedFixture({ tabHook: async () => { throw new Error('tab failed'); } });
  await f.click('aihot-watch-click').catch(() => {});
  assert.equal(f.tabs.length, 0);
  assert.equal(f.data.watchNotifyState.watched.viewedAt, '');
  assert.equal(f.data.notificationUrlMap['aihot-watch-click'], 'https://example.com/watched');
  assert.equal(f.data.notificationStateKeyMap['aihot-watch-click'], 'watched');
});

test('badge failure does not prevent a watch notification opening successfully', { timeout: 3000 }, async () => {
  const f = clickedFixture({ control: { failBadge: true } });
  await f.click('aihot-watch-click').catch(() => {});
  assert.equal(f.tabs.length, 1);
  assert.ok(f.data.watchNotifyState.watched.viewedAt);
  assert.equal(f.data.notificationUrlMap['aihot-watch-click'], undefined);
});

for (const kind of ['markItemsRead', 'saveWatchRules', 'markWatchViewed', 'openItem']) {
  test(`${kind} reports its durable commit despite badge failure`, { timeout: 3000 }, async () => {
    const f = clickedFixture({ control: { failBadge: true } });
    const messages = {
      markItemsRead: { type: kind, ids: ['watched'] },
      saveWatchRules: { type: kind, watchRules: [{ ...rule, enabled: false }] },
      markWatchViewed: { type: kind, urls: ['watched'] },
      openItem: { type: kind, url: 'https://example.com/watched', ids: ['watched'] }
    };
    const result = await f.send(messages[kind]);
    // Verify the durable effect before checking the reported result.
    if (kind === 'saveWatchRules') assert.equal(f.data.watchRules[0].enabled, false);
    if (kind === 'markItemsRead' || kind === 'openItem') assert.ok(f.data.readIds.includes('watched'));
    if (kind === 'markWatchViewed' || kind === 'openItem') assert.ok(f.data.watchNotifyState.watched.viewedAt);
    assert.equal(result.ok, true);
    if (kind === 'openItem') {
      assert.equal(f.tabs.length, 1);
      assert.equal(result.readCommitted, true);
    }
  });
}

test('truncated selected switches commit neither ETag nor full-poll watermark', { timeout: 3000 }, async () => {
  const requests = [];
  const f = fixture({ fetchHook: async (url, request) => {
    const page = Number(new URL(url).searchParams.get('cursor') || '1');
    const conditional = request?.headers?.['If-None-Match'];
    requests.push({ page, conditional });
    if (conditional) return { ...response(), ok: false, status: 304 };
    return response([apiItem(`page-${page}`)], { page: { hasMore: page < 4, nextCursor: page < 4 ? String(page + 1) : null } });
  } });
  const before = f.data.lastItemsPollAt;
  assert.equal((await f.send({ type: 'feedModeChanged', feedMode: 'selected' })).ok, true);
  await settle();
  assert.equal(f.data.history.length, 3);
  assert.equal(f.data.lastItemsPollAt, before);
  assert.deepEqual(f.data.apiFingerprintEtags || {}, {});
  requests.length = 0;
  assert.equal((await f.send({ type: 'pollNow' })).ok, true);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => !request.conditional));
  assert.equal(f.data.lastItemsPollAt, before);
});

test('quota fallback advertises only retained items and never restores trimmed history', { timeout: 3000 }, async () => {
  let quotaInjected = false;
  const f = fixture({ items: ['oldest', 'older', 'newer', 'newest'].map((id, index) =>
    apiItem(id, { source: { name: 'normal' }, publishedAt: ago(4 - index) })),
  setHook: async values => {
    if (!quotaInjected && values.history?.length > 2) {
      quotaInjected = true;
      throw new Error('QUOTA_BYTES: transient capacity limit');
    }
  } });
  await f.poll();
  await settle();
  assert.equal(quotaInjected, true);
  assert.deepEqual(f.data.history.map(item => item.id), ['newest', 'newer']);
  assert.equal(f.control.badge, '2');
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].title, 'AI HOT 有 2 条新内容');
  const retained = new Set(f.data.history.map(item => item.id));
  assert.ok(retained.has(f.notifications[0].message));
  assert.ok(f.data.lastItems.every(item => retained.has(item.id)));
  const firstReduced = f.writes.findIndex(write => write.history?.length === 2);
  assert.ok(firstReduced >= 0);
  assert.ok(f.writes.slice(firstReduced).every(write => !write.history || write.history.length <= 2));
});

test('ordinary notification failure is not recorded as an API failure', { timeout: 3000 }, async () => {
  const f = fixture({ items: [apiItem('normal', { source: { name: 'normal' } })],
    notificationHook: async () => { throw new Error('desktop notification rejected'); } });
  const before = f.data.lastItemsPollAt;
  await f.poll();
  await settle();
  assert.equal(f.data.history.length, 1);
  assert.equal(f.data.failCount, 0);
  assert.notEqual(f.data.lastItemsPollAt, before);
  assert.ok(Object.values(f.data.apiFingerprintEtags || {}).includes('W/"head"'));
  assert.equal(f.control.badge, '1');
});

test('committed unread badge updates before a slow notification completes', { timeout: 3000 }, async () => {
  const entered = deferred();
  const release = deferred();
  const f = fixture({ items: [apiItem('normal', { source: { name: 'normal' } })],
    notificationHook: async () => { entered.resolve(); await release.promise; } });
  const poll = f.poll();
  try {
    await within(entered.promise, 'notification started');
    await settle();
    assert.equal(f.data.history.length, 1);
    assert.equal(f.control.badge, '1');
  } finally {
    release.resolve();
    await poll;
  }
});

test('one badge failure retries once using fresh storage instead of its old snapshot', { timeout: 3000 }, async () => {
  const attemptedTexts = [];
  let badgeReads = 0;
  const f = fixture({ state: { history: [entry('retry-me')] },
    getHook: async keys => {
      if (Array.isArray(keys) && keys.includes('readAllBeforeByMode')) badgeReads++;
    },
    badgeHook: async text => {
      attemptedTexts.push(text);
      if (attemptedTexts.length === 1) {
        // Change the backing store without firing onChanged: recovery must come
        // from this updateBadge call, not from an incidental second invocation.
        f.data.readIds = ['retry-me'];
        throw new Error('transient badge failure');
      }
    }
  });
  await settle();
  await within(f.context.updateBadge(), 'badge retry');
  assert.deepEqual(attemptedTexts, ['1', '']);
  assert.equal(badgeReads, 2);
  assert.equal(f.control.badge, '');
});

test('two badge failures reject and release the queue for a later successful update', { timeout: 3000 }, async () => {
  let attempts = 0;
  let fail = true;
  const f = fixture({ state: { history: [entry('recover-me')] }, badgeHook: async () => {
    attempts++;
    if (fail) throw new Error('persistent badge failure');
  } });
  await settle();
  await assert.rejects(within(f.context.updateBadge(), 'bounded badge failures'), /persistent badge failure/);
  assert.equal(attempts, 2);
  await settle();
  assert.equal(attempts, 2, 'a failed update must not schedule unbounded attempts');
  fail = false;
  await within(f.context.updateBadge(), 'badge queue recovery');
  assert.equal(attempts, 3);
  assert.equal(f.control.badge, '1');
});

test('quota trimming while saving watch progress prevents later notices for removed items', { timeout: 3000 }, async () => {
  let quotaInjected = false;
  const f = fixture({ state: { watchRules: [rule] },
    items: ['oldest', 'older', 'newer', 'newest'].map((id, index) => apiItem(id, { publishedAt: ago(4 - index) })),
    setHook: async values => {
      if (!quotaInjected && values.history?.length === 4 && values.watchNotifyState?.newest?.notifyCount === 1) {
        quotaInjected = true;
        throw new Error('QUOTA_BYTES: watch progress exceeded capacity');
      }
    }
  });
  await f.poll();
  await settle();
  assert.equal(quotaInjected, true);
  assert.deepEqual(f.data.history.map(item => item.id), ['newest', 'newer']);
  assert.deepEqual(f.notifications.map(item => item.message), ['newest', 'newer']);
  assert.deepEqual(Object.keys(f.data.watchNotifyState).sort(), ['newer', 'newest']);
  assert.equal(f.data.watchNotifyState.newest.notifyCount, 1);
  assert.equal(f.data.watchNotifyState.newer.notifyCount, 1);
  assert.equal(f.data.failCount, 0);
  const firstReduced = f.writes.findIndex(write => write.history?.length === 2);
  assert.ok(firstReduced >= 0);
  assert.ok(f.writes.slice(firstReduced).every(write => !write.history || write.history.length <= 2));
});

test('transient watch progress storage failure is recovered before the next poll', { timeout: 3000 }, async () => {
  let progressAttempts = 0;
  const f = fixture({ state: { watchRules: [rule] }, items: [apiItem('watch-a')],
    setHook: async values => {
      if (values.watchNotifyState?.['watch-a']?.notifyCount === 1 && ++progressAttempts === 1) {
        throw new Error('temporary storage write failure');
      }
    }
  });
  const before = f.data.lastItemsPollAt;
  await f.poll();
  const firstCycle = { durableCount: f.data.watchNotifyState['watch-a'].notifyCount,
    notifications: f.notifications.length, failCount: f.data.failCount };
  assert.notEqual(f.data.lastItemsPollAt, before);
  assert.equal(progressAttempts, 2);
  await f.poll();
  assert.deepEqual({ firstCycle, totalNotifications: f.notifications.length }, {
    firstCycle: { durableCount: 1, notifications: 1, failCount: 0 }, totalNotifications: 1
  });
  assert.equal(f.data.watchNotifyState['watch-a'].notifyCount, 1);
});

test('persistent watch progress storage failure has bounded retries without an API failure', { timeout: 3000 }, async () => {
  let progressAttempts = 0;
  const f = fixture({ state: { watchRules: [rule] }, items: [apiItem('watch-a')],
    setHook: async values => {
      if (values.watchNotifyState?.['watch-a']?.notifyCount === 1) {
        progressAttempts++;
        throw new Error('persistent storage write failure');
      }
    }
  });
  const before = f.data.lastItemsPollAt;
  await f.poll();
  await settle();
  assert.equal(f.notifications.length, 1);
  assert.equal(f.data.history.length, 1);
  assert.equal(f.data.watchNotifyState['watch-a'].notifyCount, 0);
  assert.equal(f.data.failCount, 0);
  assert.notEqual(f.data.lastItemsPollAt, before);
  assert.ok(Object.values(f.data.apiFingerprintEtags || {}).includes('W/"head"'));
  assert.equal(progressAttempts, 2);
});
