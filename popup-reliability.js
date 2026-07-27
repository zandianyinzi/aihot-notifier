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

    function cancelTimer() {
      if (timerId === null) return;
      clearTimer(timerId);
      timerId = null;
    }

    function isCurrent(version, requestId) {
      return version === loadVersion && requestId === deps.getSwitchRequestId();
    }

    async function loadProjection(mode, options = {}) {
      if (options.immediate) cancelTimer();
      const version = ++loadVersion;
      const requestId = options.switchRequestId === undefined
        ? deps.getSwitchRequestId()
        : options.switchRequestId;
      const normalizedMode = normalizeMode(mode);
      const data = await deps.read(normalizedMode);
      if (!isCurrent(version, requestId)) return { stale: true };
      const projected = {
        ...data,
        feedMode: normalizedMode,
        history: deps.projectHistory(data?.history || [], normalizedMode)
      };
      if (!isCurrent(version, requestId)) return { stale: true };
      deps.commit(projected, {
        immediate: options.immediate === true,
        loadVersion: version,
        switchRequestId: requestId
      });
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
      await deps.waitForPaint();
      if (!isCurrent()) return { stale: true };
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
    createFeedModeSwitchController,
    createLatestWinsLoadController,
    createPopupInitializationController,
    createPopupStorageChangeHandler,
    getAllFeedContinuationStatusMessage,
    createAllFeedContinuationStatusController,
    getSafeHttpsUrl,
    openHttpsUrl
  };
});
