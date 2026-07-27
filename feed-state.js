(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FeedState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeFeedMode(mode) {
    return mode === 'all' ? 'all' : 'selected';
  }

  function isVisibleInFeedMode(item, mode) {
    return normalizeFeedMode(mode) === 'all' || item?.selected === true;
  }

  function projectHistory(history, mode) {
    return (history || []).filter(item => isVisibleInFeedMode(item, mode));
  }

  return { normalizeFeedMode, isVisibleInFeedMode, projectHistory };
});
