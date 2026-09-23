/**
 * Popup refresh/reopen regression tests. Run with: node test-popup-scroll.js
 * Executes the real popup script with in-memory Chrome APIs and fixed row geometry.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scrollKey = 'popupScrollPosition';
const popupSource = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');

function createElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    value: '',
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
    offsetTop: 0,
    children: [],
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value),
      toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
    },
    style: { setProperty() {}, removeProperty() {} },
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatch: type => listeners.get(type)?.({ isTrusted: true })
  };
}

function createPopup(savedStorage = new Map()) {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const list = getElement('historyList');
  list.scrollTo = ({ top, behavior }) => {
    list.scrollTop = top;
    list.lastScrollBehavior = behavior;
  };
  let items = [];
  Object.defineProperty(list, 'innerHTML', {
    set(html) {
      items = [...html.matchAll(/class="(item [^"]*)" data-key="([^"]*)" data-url="([^"]*)"(?: data-watch-pinned="([^"]*)")?/g)]
        .map(([, classes, key, url, watchPinned], index) => ({
          dataset: { key, url, watchPinned },
          offsetTop: index * 100 + list.offsetTop,
          classList: {
            active: new Set(classes.split(/\s+/)),
            contains(value) { return this.active.has(value); },
            add(...values) { values.forEach(value => this.active.add(value)); },
            remove(...values) { values.forEach(value => this.active.delete(value)); }
          },
          getBoundingClientRect: () => ({
            top: index * 100 - list.scrollTop,
            bottom: (index + 1) * 100 - list.scrollTop
          })
        }));
      list.scrollHeight = items.length * 100;
    }
  });
  list.querySelectorAll = selector => selector === '.item.unread'
    ? items.filter(item => item.classList.contains('unread'))
    : selector === '.item.is-jump-target' ? items.filter(item => item.classList.contains('is-jump-target')) : items;
  list.querySelector = selector => selector === '.item.unread'
    ? items.find(item => item.classList.contains('unread')) || null
    : null;
  getElement('feedMode').value = 'all';
  getElement('historyDays').value = '1';
  getElement('openPositionMode').value = 'free';
  const data = {
    enabled: true, interval: 5, theme: 'slate-night', fontFamily: 'noto-serif', fontSize: 'large',
    feedMode: 'all', historyDays: 1, openPositionMode: 'free', readIds: [],
    history: Array.from({ length: 10 }, (_, index) => ({
      id: `item-${index}`, url: `https://example.com/${index}`, title: `Item ${index}`,
      time: new Date(Date.now() - index * 60000).toISOString()
    }))
  };
  let booting = true;
  const timers = new Map();
  let timerId = 0;
  const chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      sendMessage: async () => ({ ok: true })
    },
    storage: {
      local: {
        // Hold initialization while tests drive the actual render/load entry points.
        get: async keys => {
          if (booting) return new Promise(() => {});
          const requested = Array.isArray(keys) ? keys : Object.keys(data);
          return Object.fromEntries(requested.filter(key => key in data).map(key => [key, data[key]]));
        }
      },
      onChanged: { addListener() {} }
    }
  };
  const sandbox = vm.createContext({
    console, URL, chrome, performance,
    window: {
      PopupReliability: require('./popup-reliability.js'),
      FeedState: require('./feed-state.js')
    },
    document: { getElementById: getElement, documentElement: createElement() },
    localStorage: {
      getItem: key => savedStorage.get(key) ?? null,
      setItem: (key, value) => savedStorage.set(key, value),
      removeItem: key => savedStorage.delete(key)
    },
    ResizeObserver: class { observe() {} },
    PerformanceObserver: class { observe() {} },
    requestAnimationFrame() {},
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(popupSource, sandbox, { filename: 'popup.js' });
  booting = false;
  sandbox.renderHistory(data);
  return {
    sandbox, data, list, chrome, savedStorage, getElement,
    save: () => sandbox.writeScrollPosition(data),
    refresh: () => getElement('pollNow').dispatch('click'),
    position: () => JSON.parse(savedStorage.get(scrollKey) || 'null'),
    flushTimers: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach(callback => callback());
    }
  };
}

test('refresh without new items preserves the saved position for reopening', async () => {
  const popup = createPopup();
  popup.list.scrollTop = 125;
  popup.save();
  await popup.refresh();
  const reopened = createPopup(popup.savedStorage);
  reopened.sandbox.applyInitialPosition(reopened.data);
  assert.equal(reopened.list.scrollTop, 125);
});

test('refresh keeps non-default font and size in the warm popup cache', async () => {
  const popup = createPopup();
  popup.sandbox.writePopupCache({
    enabled: true,
    interval: 5,
    theme: 'slate-night',
    fontFamily: 'noto-serif',
    fontSize: 'large',
    feedMode: 'all',
    historyDays: 1,
    history: popup.data.history
  });

  await popup.sandbox.loadHistory();

  const cached = popup.sandbox.readPopupCache();
  assert.equal(cached.fontFamily, 'noto-serif');
  assert.equal(cached.fontSize, 'large');
  assert.equal(cached.theme, 'slate-night');
  assert.equal(cached.interval, 5);
});

test('refresh saves immediately even while the scroll debounce and request are pending', async () => {
  const popup = createPopup();
  popup.list.scrollTop = 125;
  popup.list.dispatch('scroll');
  let finish;
  popup.chrome.runtime.sendMessage = () => new Promise(resolve => { finish = resolve; });
  const refresh = popup.refresh();
  const snapshot = popup.position();
  finish({ ok: true });
  await refresh;
  assert.equal(snapshot?.scrollTop, 125);
  assert.equal(snapshot?.anchorKey, 'item-1');
});

test('refresh persists the latest reading position after inserted items shift the list', async () => {
  const popup = createPopup();
  popup.list.scrollTop = 125;
  popup.save();
  let finish;
  popup.chrome.runtime.sendMessage = () => new Promise(resolve => { finish = resolve; });
  const refresh = popup.refresh();
  // The reader continues scrolling during the request. Commit must use this position.
  popup.list.scrollTop = 325;
  popup.list.dispatch('scroll');
  popup.data.history.unshift({
    id: 'new-item', url: 'https://example.com/new', title: 'New item', time: new Date().toISOString()
  });
  finish({ ok: true });
  await refresh;
  assert.equal(popup.list.scrollTop, 425);
  assert.equal(popup.position()?.scrollTop, 425);
  assert.equal(popup.position()?.anchorKey, 'item-3');
  assert.equal(popup.position()?.offsetTop, -25);
  popup.flushTimers();
  assert.equal(popup.position()?.scrollTop, 425, 'the pending scroll save keeps the refreshed position');
});

test('reopening follows the saved item when content above it changes', () => {
  const popup = createPopup();
  popup.list.scrollTop = 125;
  popup.save();
  popup.data.history.unshift({
    id: 'new-item', url: 'https://example.com/new', title: 'New item', time: new Date().toISOString()
  });
  const reopened = createPopup(popup.savedStorage);
  reopened.sandbox.renderHistory(popup.data, { applyInitialPosition: true });
  assert.equal(reopened.list.scrollTop, 225);
});

test('legacy positions and removed anchors fall back to the saved pixel offset', () => {
  const popup = createPopup();
  for (const anchor of [{}, { anchorKey: 'removed', anchorUrl: 'https://example.com/removed', offsetTop: -25 }]) {
    popup.savedStorage.set(scrollKey, JSON.stringify({
      feedMode: 'all', historyDays: 1, scrollTop: 125, savedAt: Date.now(), ...anchor
    }));
    popup.list.scrollTop = 0;
    assert.equal(popup.sandbox.restoreScrollPosition(popup.data), true);
    assert.equal(popup.list.scrollTop, 125);
  }
});

test('unread positioning and failed refresh keep their existing behavior', async () => {
  const popup = createPopup();
  popup.getElement('openPositionMode').value = 'unread';
  popup.list.scrollTop = 125;
  await popup.refresh();
  assert.equal(popup.position(), null);
  popup.getElement('openPositionMode').value = 'free';
  popup.save();
  popup.chrome.runtime.sendMessage = async () => ({ ok: false });
  await popup.refresh();
  assert.equal(popup.position()?.scrollTop, 125);
  assert.equal(popup.getElement('pollNow').disabled, false);
  assert.equal(popup.getElement('popupStatus').textContent, '刷新失败，请重试。');
});

test('unread jump locates the first unread once and does not advance on repeated clicks', () => {
  const popup = createPopup();
  popup.data.readIds = ['item-0', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9'];
  popup.sandbox.renderHistory(popup.data);

  popup.list.scrollTop = 500;
  assert.equal(popup.sandbox.jumpToUnread(), 'item-1');
  assert.equal(popup.list.scrollTop, 94);
  assert.equal(popup.list.lastScrollBehavior, 'auto');
  assert.equal(popup.sandbox.jumpToUnread(), null);
  assert.equal(popup.list.scrollTop, 94);
  assert.equal(popup.data.readIds.includes('item-1'), false);
});

test('unread jump uses instant scrolling', () => {
  const popup = createPopup();
  popup.data.readIds = ['item-0', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9'];
  popup.sandbox.renderHistory(popup.data);
  popup.list.scrollTop = 500;
  popup.sandbox.jumpToUnread();
  assert.equal(popup.list.lastScrollBehavior, 'auto');
});

test('unread navigator follows the first unread visibility', () => {
  const popup = createPopup();
  popup.data.readIds = ['item-0', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9'];
  popup.sandbox.renderHistory(popup.data);
  const button = popup.getElement('jumpToUnread');
  assert.equal(button.classList.contains('visible'), false);

  popup.list.scrollTop = 200;
  popup.list.dispatch('scroll');
  assert.equal(button.classList.contains('visible'), true);
  assert.equal(popup.sandbox.jumpToUnread(), 'item-1');
  assert.equal(button.classList.contains('visible'), false);
});

test('persisted unread watch anchors do not jump when they leave the pinned group', () => {
  const popup = createPopup();
  popup.data.history[8].watchMatched = true;
  popup.sandbox.renderHistory(popup.data);
  popup.list.scrollTop = 25;
  popup.save();
  assert.equal(popup.position().anchorKey, 'item-8');
  const reopened = createPopup(popup.savedStorage);
  reopened.sandbox.renderHistory({ ...popup.data, readIds: ['item-8'] }, { applyInitialPosition: true });
  assert.equal(reopened.list.scrollTop, 25);
});

test('refreshing after a watch item is read does not follow its old session pin on reopen', async () => {
  const popup = createPopup();
  popup.data.history[8].watchMatched = true;
  popup.sandbox.renderHistory(popup.data);
  popup.list.scrollTop = 25;
  popup.data.readIds = ['item-8'];
  popup.sandbox.renderHistory(popup.data);
  await popup.refresh();
  assert.equal(popup.position().anchorKey, 'item-8');
  const reopened = createPopup(popup.savedStorage);
  reopened.sandbox.renderHistory(popup.data, { applyInitialPosition: true });
  assert.equal(reopened.list.scrollTop, 25);
});
