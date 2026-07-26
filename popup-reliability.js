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
    let sequence = 0;

    async function switchFeedMode(nextMode, previousMode, context) {
      const requestId = ++sequence;
      deps.setDisabled(true);
      try {
        await deps.enqueue(async () => {
          const response = await deps.sendChange(nextMode);
          if (requestId !== sequence) return;
          if (!response || response.ok === false) throw new Error(response?.error || 'feed mode update failed');
          const failCount = await deps.getFailCount();
          if (requestId !== sequence) return;
          deps.clearScrollPosition();
          deps.persist(nextMode);
          deps.onSuccess(failCount, context);
        });
      } catch (_e) {
        if (requestId === sequence) {
          await deps.rollback(previousMode);
          deps.onFailure(context);
        }
      } finally {
        if (requestId === sequence) deps.setDisabled(false);
      }
    }

    return { switchFeedMode };
  }

  function createPopupStorageChangeHandler(deps) {
    const updateContinuationStatus = deps.updateContinuationStatus || (continuation => {
      deps.showStatus(getAllFeedContinuationStatusMessage(continuation));
    });
    return function handleStorageChange(changes, areaName) {
      if (areaName !== 'local') return;
      if (changes.history) {
        deps.refreshHistory();
        return;
      }
      if (changes.allFeedContinuation) {
        updateContinuationStatus(changes.allFeedContinuation.newValue);
      }
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
    createPopupStorageChangeHandler,
    getAllFeedContinuationStatusMessage,
    createAllFeedContinuationStatusController,
    getSafeHttpsUrl,
    openHttpsUrl
  };
});
