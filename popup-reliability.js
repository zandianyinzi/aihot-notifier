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
          await deps.loadHistory();
          if (requestId !== sequence) return;
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

  return {
    createMutationQueue,
    createFeedModeSwitchController,
    getSafeHttpsUrl,
    openHttpsUrl
  };
});
