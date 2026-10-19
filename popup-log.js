(function () {
  if (window.__popupPerf && window.__popupPerf.log) return;

  const startedAt = performance.now();
  const manifest = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
  const state = {
    sessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt,
    version: manifest ? manifest.version : 'unknown',
    logs: []
  };

  function serializeEntry(phase, fields = {}) {
    const entry = {
      sid: state.sessionId,
      ver: state.version,
      t: Number((performance.now() - startedAt).toFixed(2)),
      phase
    };

    Object.keys(fields).forEach(key => {
      if (fields[key] !== undefined) entry[key] = fields[key];
    });

    return `[POPUP][perf] ${JSON.stringify(entry)}`;
  }

  // Fixed-size ring buffer: keep the newest entries so long sessions do not grow memory.
  const MAX_LOG_ENTRIES = 500;

  function log(phase, fields = {}) {
    const line = serializeEntry(phase, fields);
    state.logs.push(line);
    if (state.logs.length > MAX_LOG_ENTRIES) state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
    console.log(line);
    return line;
  }

  state.log = log;
  state.snapshot = () => state.logs.slice();
  window.__popupPerf = state;
  window.__popupPerfLog = log;
})();
