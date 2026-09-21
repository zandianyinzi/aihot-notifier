(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PopupReliability = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function createMutationQueue() {
    let tail = Promise.resolve();
    return function enqueueMutation(operation) {
      const result = tail.then(operation);
      tail = result.catch(() => {});
      return result;
    };
  }

  function createPopupStatusController(render) {
    let errorMessage = '';
    let continuationMessage = '';

    function publish() {
      if (errorMessage) {
        render(errorMessage, 'error');
      } else {
        render(continuationMessage, continuationMessage ? 'continuation' : '');
      }
    }

    function show(message, options = {}) {
      if (options.source === 'continuation') {
        continuationMessage = String(message || '');
      } else {
        errorMessage = String(message || '');
      }
      publish();
    }

    return { show };
  }

  function createSettingsPanelController(deps) {
    const requestFrame = deps.requestFrame || (callback => requestAnimationFrame(callback));
    const panel = deps.panel;
    const trigger = deps.trigger;
    const groups = deps.groups || [];
    let focusEpoch = 0;
    let isOpen = panel.classList.contains('open');

    function collapseGroups() {
      groups.forEach(group => { group.open = false; });
    }

    function setOpen(nextOpen, options = {}) {
      const epoch = ++focusEpoch;
      const shouldFocus = options.focus !== false;
      isOpen = Boolean(nextOpen);
      panel.classList.toggle('open', isOpen);
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      panel.toggleAttribute('inert', !isOpen);
      if (isOpen) {
        collapseGroups();
        // Leave a rendering opportunity between opening the panel and focusing.
        if (shouldFocus) requestFrame(() => {
          if (epoch !== focusEpoch) return;
          requestFrame(() => {
            if (epoch !== focusEpoch) return;
            groups[0]?.querySelector('.setting-group-title')?.focus({ preventScroll: true });
          });
        });
      } else if (shouldFocus) {
        trigger.focus();
      }
    }

    function toggle(options = {}) {
      setOpen(!isOpen, options);
    }

    return { setOpen, toggle, collapseGroups };
  }

  function getSafeHttpsUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_e) {
      return '';
    }
  }

  async function openHttpsUrl(value, createTab, afterOpen) {
    const url = getSafeHttpsUrl(value);
    if (!url) return { ok: false, reason: 'unsafe-url' };
    try {
      await createTab({ url });
    } catch (_e) {
      return { ok: false, reason: 'tab-create-failed' };
    }
    await afterOpen(url);
    return { ok: true, url };
  }

  async function runOpenItemMutation(deps = {}) {
    if (deps.applyOptimistic) deps.applyOptimistic();
    let result;
    try {
      result = await deps.open();
    } catch (_e) {
      result = { ok: false, reason: 'tab-create-failed' };
    }
    if (result?.ok === false) {
      if (deps.rollback) deps.rollback();
      if (deps.onFailure) deps.onFailure(result.reason);
    } else if (result?.opened && result.readCommitted === false) {
      if (deps.onPersistenceFailure) deps.onPersistenceFailure(result.error || 'read-persist-failed');
    }
    return result || { ok: false, reason: 'tab-create-failed' };
  }

  function removeOptimisticReadAliases(currentReadIds, optimisticAliases, baselineReadIds) {
    const next = new Set(currentReadIds || []);
    const baseline = new Set(baselineReadIds || []);
    (optimisticAliases || []).forEach(alias => {
      if (alias && !baseline.has(alias)) next.delete(alias);
    });
    return next;
  }

  function createConfigMutationController(deps = {}) {
    let tail = Promise.resolve();
    let generation = 0;
    let committed = deps.getCommitted ? deps.getCommitted() : null;
    let pendingLocalIntent = null;

    function sameConfig(a, b) {
      if (!a || !b) return false;
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].every(key => a[key] === b[key]);
    }

    function save(nextConfig, options = {}) {
      const requestId = ++generation;
      pendingLocalIntent = nextConfig;
      const operation = tail.then(async () => {
        const previous = committed || (deps.getCommitted ? deps.getCommitted() : null);
        try {
          await deps.persist(nextConfig);
        } catch (error) {
          if (requestId === generation) {
            if (deps.apply && previous) deps.apply(previous);
          }
          throw error;
        }

        committed = nextConfig;
        if (deps.setCommitted) deps.setCommitted(nextConfig);
        if (requestId === generation && deps.apply) deps.apply(nextConfig);

        if (deps.notify && options.notifyBackground !== false) {
          let response;
          try {
            response = await deps.notify(nextConfig, options);
          } catch (error) {
            throw Object.assign(error, { committed: true });
          }
          if (response?.ok === false) {
            throw Object.assign(new Error(response.error || 'configChanged failed'), { committed: true });
          }
        }
        return { ok: true, config: nextConfig };
      });
      tail = operation.catch(() => {});
      return operation;
    }

    return {
      save,
      observeCommitted(config) {
        if (pendingLocalIntent && !sameConfig(config, pendingLocalIntent)) return false;
        if (pendingLocalIntent && sameConfig(config, pendingLocalIntent)) pendingLocalIntent = null;
        committed = config;
        if (deps.setCommitted) deps.setCommitted(config);
        return true;
      },
      getCommitted: () => committed
    };
  }

  function captureScrollAnchor(scroller, itemSelector = '.item') {
    if (!scroller) return null;
    const listTop = scroller.getBoundingClientRect().top;
    const items = Array.from(scroller.querySelectorAll(itemSelector));
    const anchorItem = items.find(item => item.getBoundingClientRect().bottom >= listTop);
    if (!anchorItem) return null;
    const anchorWasUnreadWatch = anchorItem.classList?.contains('unread') &&
      anchorItem.classList?.contains('watch-item');
    return {
      scrollTop: scroller.scrollTop,
      anchorKey: anchorItem.dataset?.key || '',
      anchorUrl: anchorItem.dataset?.url || '',
      offsetTop: anchorItem.getBoundingClientRect().top - listTop,
      ...(anchorWasUnreadWatch ? { anchorWasUnreadWatch: true } : {}),
      ...(anchorItem.dataset?.watchPinned === 'true' ? { anchorWasPinnedWatch: true } : {})
    };
  }

  function buildScrollPosition(scroller, context = {}, savedAt = Date.now()) {
    const anchor = captureScrollAnchor(scroller);
    return {
      ...context,
      scrollTop: Number.isFinite(anchor?.scrollTop) ? anchor.scrollTop : Math.max(Number(scroller?.scrollTop) || 0, 0),
      anchorKey: anchor?.anchorKey || '',
      anchorUrl: anchor?.anchorUrl || '',
      ...(Number.isFinite(anchor?.offsetTop) ? { offsetTop: anchor.offsetTop } : {}),
      ...(anchor?.anchorWasUnreadWatch ? { anchorWasUnreadWatch: true } : {}),
      ...(anchor?.anchorWasPinnedWatch ? { anchorWasPinnedWatch: true } : {}),
      savedAt
    };
  }

  function restoreScrollAnchor(scroller, anchor, options = {}) {
    if (!scroller || !anchor) return false;
    const fallbackScrollTop = Number.isFinite(anchor.scrollTop) ? Math.max(anchor.scrollTop, 0) : 0;
    const maxJump = Number.isFinite(options.maxJump) ? Math.max(options.maxJump, 0) : Infinity;
    const items = Array.from(scroller.querySelectorAll(options.itemSelector || '.item'));
    const anchorItem = anchor.anchorKey
      ? items.find(item => item.dataset?.key === anchor.anchorKey)
      : items.find(item => item.dataset?.url === anchor.anchorUrl);
    if (!anchorItem || (!anchor.anchorKey && !anchor.anchorUrl)) {
      scroller.scrollTop = fallbackScrollTop;
      return false;
    }

    if ((anchor.anchorWasUnreadWatch && !anchorItem.classList?.contains('unread')) ||
        (anchor.anchorWasPinnedWatch && anchorItem.dataset?.watchPinned !== 'true')) {
      scroller.scrollTop = fallbackScrollTop;
      return false;
    }

    const listTop = scroller.getBoundingClientRect().top;
    const currentOffset = anchorItem.getBoundingClientRect().top - listTop;
    const targetScrollTop = Math.max(scroller.scrollTop + currentOffset - anchor.offsetTop, 0);
    if (Math.abs(targetScrollTop - fallbackScrollTop) > maxJump) {
      scroller.scrollTop = fallbackScrollTop;
      return false;
    }

    scroller.scrollTop = targetScrollTop;
    return true;
  }

  function applyOptimisticReadState(items, markAllButton) {
    const changedItems = Array.from(items || []).filter(item => item.classList.contains('unread'));
    changedItems.forEach(item => {
      item.classList.remove('unread');
      item.classList.add('read');
    });
    // Don't hide button immediately - visibility will be removed by showButtonConfirm
    // after the confirmation animation completes, ensuring the user sees the feedback.

    return function rollbackOptimisticReadState() {
      changedItems.forEach(item => {
        item.classList.remove('read');
        item.classList.add('unread');
      });
      if (changedItems.length > 0) markAllButton?.classList.add('visible');
    };
  }

  async function runMarkAllReadMutation(deps) {
    let committed = false;
    try {
      const response = await deps.send();
      if (!response?.ok) throw new Error(response?.error || 'Failed to mark all read');
      committed = true;
      if (deps.onCommitted) deps.onCommitted(response);
      await deps.reload();
    } catch (error) {
      if (!committed && deps.rollback) deps.rollback();
      let recovered = false;
      try {
        await deps.reload();
        recovered = true;
      } catch (_reloadError) {
        // Keep the original operation error as the user-facing failure.
      }
      if (deps.onFailure) deps.onFailure({ committed, error, recovered });
    }
    return { committed };
  }

  function createSessionWatchPinTracker() {
    const pinnedKeys = new Set();

    function getPinnedItems(history, isUnread, getKey, options = {}) {
      const isWatchMatch = options.isWatchMatch || (item => item?.watchMatched);
      return (history || []).filter(item => {
        const key = getKey(item);
        if (!key) return false;
        if (!isWatchMatch(item)) {
          pinnedKeys.delete(key);
          return false;
        }
        const unread = isUnread(item);
        if (unread && options.persistUnread !== false) pinnedKeys.add(key);
        return unread || pinnedKeys.has(key);
      });
    }

    return { getPinnedItems };
  }

  function hasActiveWatchRuleMatch(item, rules) {
    if (!Array.isArray(item?.watchRuleIds)) return item?.watchMatched === true;
    const activeRuleIds = new Set(
      (Array.isArray(rules) ? rules : [])
        .filter(rule => rule?.enabled !== false)
        .map(rule => String(rule?.id || ''))
    );
    return item.watchRuleIds.some(ruleId => activeRuleIds.has(String(ruleId)));
  }

  function moveWatchRule(rules, ruleId, direction) {
    const next = Array.isArray(rules) ? rules.map(rule => ({ ...rule })) : [];
    const index = next.findIndex(rule => String(rule?.id || '') === String(ruleId || ''));
    const target = index + (direction < 0 ? -1 : 1);
    if (index < 0 || target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }

  function captureWatchRuleActionFocus(container, activeElement) {
    if (!container || !activeElement || !container.contains(activeElement)) return null;
    const button = typeof activeElement.closest === 'function'
      ? activeElement.closest('.watch-rule-btn')
      : null;
    const card = button?.closest('.watch-rule-card');
    const ruleId = card?.dataset?.ruleId;
    const action = button?.dataset?.action;
    return ruleId && action ? { ruleId, action } : null;
  }

  function restoreWatchRuleActionFocus(container, ruleId, action) {
    if (!container || !ruleId) return false;
    const card = Array.from(container.querySelectorAll('.watch-rule-card'))
      .find(element => String(element?.dataset?.ruleId || '') === String(ruleId));
    if (!card) return false;

    const focusableActions = new Set(['toggle', 'move-up', 'move-down']);
    const actionButton = focusableActions.has(action)
      ? card.querySelector(`[data-action="${action}"]:not(:disabled)`)
      : null;
    const target = actionButton ||
      card.querySelector('.watch-rule-move:not(:disabled)') ||
      card.querySelector('[data-action="toggle"]');
    if (!target || typeof target.focus !== 'function') return false;
    target.focus({ preventScroll: true });
    return true;
  }

  function sortWatchItemsByRulePriority(items, rules, getTime = item => new Date(item?.time || 0).getTime()) {
    const priorityByRuleId = new Map(
      (Array.isArray(rules) ? rules : [])
        .filter(rule => rule?.enabled !== false)
        .map((rule, index) => [String(rule?.id || ''), index])
    );
    return (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const priority = (Array.isArray(item?.watchRuleIds) ? item.watchRuleIds : [])
          .map(ruleId => priorityByRuleId.get(String(ruleId)))
          .filter(value => Number.isInteger(value))
          .reduce((best, value) => Math.min(best, value), Number.POSITIVE_INFINITY);
        return { item, index, priority, time: Number(getTime(item)) || 0 };
      })
      .sort((a, b) => a.priority - b.priority || b.time - a.time || a.index - b.index)
      .map(entry => entry.item);
  }

  function buildHistoryRenderSignature(history, historyDays, watchRules, isRead = () => false) {
    return JSON.stringify({
      historyDays,
      watchRuleOrder: (Array.isArray(watchRules) ? watchRules : [])
        .map(rule => `${rule?.id || ''}:${rule?.enabled !== false ? 1 : 0}`),
      items: (Array.isArray(history) ? history : []).map(item => [
        item?.url,
        item?.id || '',
        item?.permalink || '',
        item?.time,
        item?.title,
        item?.source || '',
        item?.category || '',
        item?.summary || '',
        item?.watchMatched ? '1' : '',
        Array.isArray(item?.watchRuleIds)
          ? [...new Set(item.watchRuleIds.map(ruleId => String(ruleId)))].sort()
          : null,
        item?.discoveredAt || '',
        isRead(item) ? 1 : 0
      ])
    });
  }

  function createFeedModeSwitchController(deps) {
    const normalizeMode = deps.normalizeFeedMode || (mode => mode === 'all' ? 'all' : 'selected');
    let committedMode = normalizeMode(deps.initialMode);
    let pendingMode = null;
    let switchRequestId = 0;

    function getState() {
      return { committedMode, pendingMode, switchRequestId };
    }

    function getDisplayMode() {
      return pendingMode || committedMode;
    }

    function observeCommittedMode(mode) {
      committedMode = normalizeMode(mode);
    }

    async function switchFeedMode(nextMode, context) {
      const mode = normalizeMode(nextMode);
      const requestId = ++switchRequestId;
      pendingMode = mode;
      deps.setDisabled(true);
      const optimisticLoad = Promise.resolve(deps.loadProjection(mode, {
        immediate: true,
        switchRequestId: requestId
      }));
      optimisticLoad.catch(() => {});
      try {
        const response = await deps.sendChange(mode);
        if (requestId !== switchRequestId) return;
        if (!response || response.ok === false) throw new Error(response?.error || 'feed mode update failed');
        committedMode = mode;
        pendingMode = null;
        await optimisticLoad.catch(() => {});
        if (requestId !== switchRequestId) return;
        await deps.loadProjection(mode, { immediate: true, switchRequestId: requestId });
        if (requestId !== switchRequestId) return;
        const failCount = await deps.getFailCount();
        if (requestId !== switchRequestId) return;
        deps.clearScrollPosition();
        deps.onSuccess(failCount, context, mode);
      } catch (_e) {
        if (requestId === switchRequestId) {
          let authoritativeMode = committedMode;
          try {
            authoritativeMode = normalizeMode(await deps.readCommittedMode());
          } catch (_readError) {
            // Keep the last observed durable mode if the authoritative read fails.
          }
          committedMode = authoritativeMode;
          pendingMode = null;
          await deps.loadProjection(authoritativeMode, { immediate: true, switchRequestId: requestId }).catch(() => {});
          if (requestId !== switchRequestId) return;
          await deps.rollback(authoritativeMode);
          deps.onFailure(context);
        }
      } finally {
        if (requestId === switchRequestId) deps.setDisabled(false);
      }
    }

    return { switchFeedMode, getState, getDisplayMode, observeCommittedMode };
  }

  const POPUP_LOAD_STORAGE_KEYS = new Set([
    'history',
    'feedMode',
    'readIds',
    'readAllBefore',
    'readAllBeforeByMode',
    'historyDays',
    'watchRules',
    'allFeedContinuation'
  ]);

  function hasRelevantPopupLoadChange(changes) {
    return Object.keys(changes || {}).some(key => POPUP_LOAD_STORAGE_KEYS.has(key));
  }

  function createLatestWinsLoadController(deps) {
    const normalizeMode = deps.normalizeFeedMode || (mode => mode === 'all' ? 'all' : 'selected');
    const setTimer = deps.setTimer || setTimeout;
    const clearTimer = deps.clearTimer || clearTimeout;
    const debounceMs = Number.isFinite(deps.debounceMs) ? deps.debounceMs : 40;
    let timerId = null;
    let loadVersion = 0;
    let pendingRenderIntent = null;

    function cancelTimer() {
      if (timerId === null) return;
      clearTimer(timerId);
      timerId = null;
    }

    function isCurrent(version, requestId) {
      return version === loadVersion && requestId === deps.getSwitchRequestId();
    }

    function getRenderIntent(mode, requestId, options) {
      const hasExplicitIntent = options.forceRender === true || Boolean(options.scrollAnchor);
      if (hasExplicitIntent) {
        pendingRenderIntent = {
          mode,
          requestId,
          forceRender: options.forceRender === true,
          scrollAnchor: options.scrollAnchor || null
        };
      } else if (pendingRenderIntent && (
        pendingRenderIntent.mode !== mode || pendingRenderIntent.requestId !== requestId
      )) {
        pendingRenderIntent = null;
      }

      if (pendingRenderIntent?.mode === mode && pendingRenderIntent.requestId === requestId) {
        return pendingRenderIntent;
      }
      return { forceRender: false, scrollAnchor: null };
    }

    async function loadProjection(mode, options = {}) {
      if (options.immediate) cancelTimer();
      const version = ++loadVersion;
      const requestId = options.switchRequestId === undefined
        ? deps.getSwitchRequestId()
        : options.switchRequestId;
      const normalizedMode = normalizeMode(mode);
      const renderIntent = getRenderIntent(normalizedMode, requestId, options);
      let data;
      try {
        data = await deps.read(normalizedMode);
      } catch (error) {
        if (pendingRenderIntent === renderIntent) pendingRenderIntent = null;
        throw error;
      }
      if (!isCurrent(version, requestId)) return { stale: true };
      const projected = {
        ...data,
        feedMode: normalizedMode,
        history: deps.projectHistory(data?.history || [], normalizedMode)
      };
      if (!isCurrent(version, requestId)) return { stale: true };
      let scrollAnchor = renderIntent.scrollAnchor;
      let applyInitialPosition = false;
      if (!scrollAnchor && deps.captureScrollAnchor) {
        scrollAnchor = deps.captureScrollAnchor();
        applyInitialPosition = !scrollAnchor;
      }
      deps.commit(projected, {
        applyInitialPosition,
        forceRender: renderIntent.forceRender,
        immediate: options.immediate === true,
        loadVersion: version,
        scrollAnchor,
        switchRequestId: requestId
      });
      if (pendingRenderIntent === renderIntent) pendingRenderIntent = null;
      return { stale: false, data: projected };
    }

    function scheduleLoad(changes, mode, requestId = deps.getSwitchRequestId()) {
      if (!hasRelevantPopupLoadChange(changes)) return false;
      cancelTimer();
      loadVersion++;
      timerId = setTimer(() => {
        timerId = null;
        loadProjection(mode, { switchRequestId: requestId }).catch(error => {
          if (deps.onError) deps.onError(error);
        });
      }, debounceMs);
      return true;
    }

    return { loadProjection, scheduleLoad, getVersion: () => loadVersion };
  }

  function createPopupInitializationController(deps) {
    async function initialize() {
      const initialLoadVersion = deps.getLoadVersion();
      const initialSwitchRequestId = deps.getSwitchState().switchRequestId;
      const isCurrent = () => {
        const switchState = deps.getSwitchState();
        return deps.getLoadVersion() === initialLoadVersion &&
          switchState.switchRequestId === initialSwitchRequestId &&
          switchState.pendingMode === null;
      };

      const committedModePromise = Promise.resolve(deps.readCommittedMode());
      const cachedDataPromise = Promise.resolve(deps.readWarmCache());
      const storageDataPromise = Promise.resolve(deps.readFullStorage());
      cachedDataPromise.catch(() => {});
      storageDataPromise.catch(() => {});
      const committedMode = deps.normalizeFeedMode(await committedModePromise);
      const cachedCandidate = await cachedDataPromise;
      const cachedData = cachedCandidate &&
        deps.normalizeFeedMode(cachedCandidate.feedMode) === committedMode
        ? cachedCandidate
        : null;
      if (deps.onCacheResolved) deps.onCacheResolved(cachedData);

      if (cachedData) {
        if (!isCurrent()) return { stale: true };
        deps.applyCache(cachedData, committedMode);
        await deps.waitForPaint();
        if (!isCurrent()) return { stale: true };
        deps.renderCache(cachedData, committedMode);
      }

      const storageData = await storageDataPromise;
      if (deps.onStorageResolved) deps.onStorageResolved(storageData);
      if (!isCurrent() || deps.normalizeFeedMode(storageData.feedMode) !== committedMode) {
        return { stale: true };
      }
      const preparedData = deps.prepareStorage(storageData, cachedData);
      if (!isCurrent()) return { stale: true };
      deps.applyStorage(preparedData, committedMode);
      // Cache-miss: let browser paint the skeleton before rendering heavy content.
      if (!cachedData) {
        await deps.waitForPaint();
        if (!isCurrent()) return { stale: true };
      }
      deps.renderStorage(preparedData, committedMode);
      return { stale: false, data: preparedData };
    }

    return { initialize };
  }

  function createPopupStorageChangeHandler(deps) {
    return function handleStorageChange(changes, areaName) {
      if (areaName !== 'local') return;
      if (!hasRelevantPopupLoadChange(changes)) return;
      const continuation = changes.allFeedContinuation?.newValue;
      if (changes.allFeedContinuation && deps.updateContinuationStatus) {
        deps.updateContinuationStatus(continuation);
      }
      const hasOtherRenderableChange = Object.keys(changes || {}).some(key =>
        key !== 'history' && key !== 'allFeedContinuation' && POPUP_LOAD_STORAGE_KEYS.has(key)
      );
      if (continuation?.active === true && !hasOtherRenderableChange) return;
      deps.scheduleLoad(changes, deps.getFeedMode(changes), deps.getSwitchRequestId());
    };
  }

  function getAllFeedContinuationStatusMessage(continuation) {
    const expiresAt = new Date(continuation?.expiresAt || 0).getTime();
    return continuation?.active === true && expiresAt > Date.now() ? '正在补充更多内容…' : '';
  }

  function createAllFeedContinuationStatusController(deps) {
    const now = deps.now || Date.now;
    const setTimer = deps.setTimer || setTimeout;
    const clearTimer = deps.clearTimer || clearTimeout;
    let timerId = null;
    let version = 0;

    function update(continuation) {
      version++;
      const currentVersion = version;
      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }

      const expiresAt = new Date(continuation?.expiresAt || 0).getTime();
      const message = continuation?.active === true && expiresAt > now() ? '正在补充更多内容…' : '';
      deps.showStatus(message);
      if (!message) return;

      timerId = setTimer(() => {
        if (currentVersion !== version) return;
        timerId = null;
        deps.showStatus('');
      }, expiresAt - now());
    }

    return { update };
  }

  return {
    createMutationQueue,
    createPopupStatusController,
    createSettingsPanelController,
    createFeedModeSwitchController,
    createLatestWinsLoadController,
    createPopupInitializationController,
    createPopupStorageChangeHandler,
    getAllFeedContinuationStatusMessage,
    createAllFeedContinuationStatusController,
    captureScrollAnchor,
    buildScrollPosition,
    restoreScrollAnchor,
    applyOptimisticReadState,
    runMarkAllReadMutation,
    createSessionWatchPinTracker,
    hasActiveWatchRuleMatch,
    moveWatchRule,
    captureWatchRuleActionFocus,
    restoreWatchRuleActionFocus,
    sortWatchItemsByRulePriority,
    buildHistoryRenderSignature,
    getSafeHttpsUrl,
    openHttpsUrl,
    runOpenItemMutation,
    removeOptimisticReadAliases,
    createConfigMutationController
  };
});
