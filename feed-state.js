(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FeedState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_HISTORY_DAYS = 1;
  const MAX_HISTORY_DAYS = 7;

  function normalizeFeedMode(mode) {
    return mode === 'selected' ? 'selected' : 'all';
  }

  function normalizeHistoryDays(value) {
    const days = Number(value);
    return Math.min(Math.max(Number.isFinite(days) && days > 0 ? days : DEFAULT_HISTORY_DAYS, 1), MAX_HISTORY_DAYS);
  }

  function isVisibleInFeedMode(item, mode) {
    return normalizeFeedMode(mode) === 'all' || item?.selected === true;
  }

  function projectHistory(history, mode) {
    return (history || []).filter(item => isVisibleInFeedMode(item, mode));
  }

  return { normalizeFeedMode, normalizeHistoryDays, isVisibleInFeedMode, projectHistory };
});
