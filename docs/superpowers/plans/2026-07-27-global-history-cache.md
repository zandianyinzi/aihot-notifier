# Global History Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve discovery/read/watch state across feed switches and make source changes render from local canonical history before network refresh completes.

**Architecture:** `history` remains the one bounded canonical store. A small UMD module supplies the identical feed projection to the service worker, popup, and Node tests; background-owned upsert and mutation handlers merge API records and local state atomically; popup reliability controllers own optimistic mode and coalesced latest-wins rendering. Source-switch fetches run outside the storage queue but commit through a background generation check.

**Tech Stack:** Chrome/Edge Manifest V3, native JavaScript, `chrome.storage.local`, Node.js standalone test scripts.

---

### Task 1: Establish the shared feed projection contract

**Files:**
- Create: `feed-state.js`
- Create: `test-feed-state.js`
- Modify: `background.js:1-45,900-930`
- Modify: `popup.html:1154-1156`
- Modify: `popup.js:630-720,787-795`
- Modify: `pack.sh:5-15`
- Modify: `test-popup-ui.js:80-90,600-620`

- [ ] **Step 1: Write the failing projection tests**

Create `test-feed-state.js` with real pure-function assertions:

```js
const assert = require('assert');
const { normalizeFeedMode, isVisibleInFeedMode, projectHistory } = require('./feed-state.js');

const history = [
  { id: 'selected', selected: true },
  { id: 'all-only', selected: false },
  { id: 'legacy' }
];

assert.strictEqual(normalizeFeedMode('all'), 'all');
assert.strictEqual(normalizeFeedMode('unexpected'), 'selected');
assert.strictEqual(isVisibleInFeedMode(history[0], 'selected'), true);
assert.strictEqual(isVisibleInFeedMode(history[1], 'selected'), false);
assert.deepStrictEqual(projectHistory(history, 'selected').map(item => item.id), ['selected']);
assert.deepStrictEqual(projectHistory(history, 'all').map(item => item.id), ['selected', 'all-only', 'legacy']);
console.log('结果: 6 passed, 0 failed');
```

Add popup UI assertions that `feed-state.js` loads before `popup.js`, and packaging assertions that it is included.

- [ ] **Step 2: Run tests and verify RED**

Run: `node test-feed-state.js; node test-popup-ui.js`

Expected: `MODULE_NOT_FOUND` for `feed-state.js` and popup/package contract failures.

- [ ] **Step 3: Implement the minimal shared UMD module**

Create a dependency-free UMD export with exactly these APIs:

```js
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
```

Load it with `importScripts('feed-state.js')` in the service worker and a script tag before popup reliability/application scripts. In Node, resolve it with `require('./feed-state.js')`. Replace local mode normalization and pre-render/badge filtering with this contract. Add `feed-state.js` to `pack.sh`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node test-feed-state.js; node test-popup-ui.js; node test.js`

Expected: all suites exit 0 and selected projection contains only strict `selected: true` items.

Commit: `feat: share feed projection contract`

### Task 2: Add canonical identity upsert and local-state migration

**Files:**
- Modify: `background.js:75-190,251-285,430-640`
- Modify: `test-background.js:180-295,780-1065`
- Modify: `test-notification.js`

- [ ] **Step 1: Add failing canonical upsert regressions**

Use real background message flows and mocked v1 pages. Seed two non-empty IDs with one colliding URL and assert exact ID retains its discovery. Seed one ID-less URL record and assert the API-ID response absorbs it; seed two ID-less candidates and assert neither is absorbed. Assert refreshed server fields retain the earliest discovery, all-mode explicit `selected: false` downgrades membership, a missing field preserves membership, and selected-mode response forces membership. Seed the legacy URL in `readIds` and two watch aliases with different progress, then assert the canonical ID becomes read and owns the deterministically merged watch state.

Add notification assertions for the specified path matrix: only inserted items participate in immediate scheduled notifications; updated/newly-matched retained items never create a first notification or reminder state.

- [ ] **Step 2: Run tests and verify RED**

Run: `node test-background.js; node test-notification.js`

Expected: failures show destructive replacement/append-only dedupe, URL collision, membership-presence, and alias-state migration gaps.

- [ ] **Step 3: Preserve membership presence during normalization**

Make `normalizeV1Item` return a transient `selectedPresent` flag alongside normalized `selected`. Ensure `toHistoryEntry` persists only the strict boolean canonical membership and never leaks the transient flag.

- [ ] **Step 4: Implement deterministic canonical upsert helpers**

Add small helpers with these interfaces:

```js
function getIdentityAliases(item) {
  return [item?.permalink, item?.url].filter(Boolean);
}

function findAliasCandidates(history, item) {
  const aliases = new Set(getIdentityAliases(item));
  return history
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => getIdentityAliases(candidate).some(alias => aliases.has(alias)))
    .map(({ index }) => index);
}

function findLegacyDuplicates(history, item, winnerIndex) {
  const candidates = findAliasCandidates(history, item)
    .filter(index => index !== winnerIndex && !history[index].id);
  const conflictingId = findAliasCandidates(history, item)
    .some(index => index !== winnerIndex && Boolean(history[index].id));
  return !conflictingId && candidates.length === 1 ? candidates : [];
}

function earliestIso(values) {
  return values.filter(value => Number.isFinite(new Date(value || 0).getTime()))
    .sort((a, b) => new Date(a) - new Date(b))[0] || '';
}

function latestIso(values) {
  return values.filter(value => Number.isFinite(new Date(value || 0).getTime()))
    .sort((a, b) => new Date(b) - new Date(a))[0] || '';
}

function findCanonicalMatch(history, item) {
  const exactIndex = item.id ? history.findIndex(candidate => candidate.id === item.id) : -1;
  if (exactIndex >= 0) return { index: exactIndex, legacyIndexes: findLegacyDuplicates(history, item, exactIndex) };
  const candidates = findAliasCandidates(history, item);
  return candidates.length === 1 && !history[candidates[0]].id
    ? { index: candidates[0], legacyIndexes: [] }
    : { index: -1, legacyIndexes: [] };
}

function mergeCanonicalItem(existing, incoming, { mode, discoveredAt }) {
  const knownDiscovery = [existing?.discoveredAt, incoming.discoveredAt]
    .filter(value => Number.isFinite(new Date(value || 0).getTime()))
    .sort((a, b) => new Date(a) - new Date(b))[0] || discoveredAt;
  const selected = mode === 'selected'
    ? true
    : incoming.selectedPresent ? incoming.selected === true : existing?.selected === true;
  const { selectedPresent, ...serverFields } = incoming;
  return { ...existing, ...serverFields, discoveredAt: knownDiscovery, selected };
}

function mergeWatchStates(states, item, watchRules) {
  const valid = states.filter(Boolean);
  const firstMatchedAt = earliestIso(valid.map(state => state.firstMatchedAt));
  const viewedAt = earliestIso(valid.map(state => state.viewedAt));
  const notifyCount = Math.max(0, ...valid.map(state => Number(state.notifyCount || 0)));
  const lastNotifiedAt = latestIso(valid.map(state => state.lastNotifiedAt));
  return {
    ruleIds: matchWatchRules(item, watchRules).map(rule => rule.id),
    firstMatchedAt,
    viewedAt,
    notifyCount,
    lastNotifiedAt,
    nextNotifyAt: viewedAt ? '' : getNextWatchNotifyAt(firstMatchedAt, notifyCount, lastNotifiedAt)
  };
}
```

Implement `upsertCanonicalItems(state, items, options)` to return new `history`, `readIds`, `watchNotifyState`, `inserted`, `updated`, and `newlyMatched` values. `options` includes `mode`, `discoveredAt`, `completeSelectedSnapshot`, and `notify`. The helper removes only safely absorbed ID-less duplicates, migrates `readIds`, recomputes watch rule IDs, and retains notification progress. It never merges different non-empty IDs through URL aliases.

- [ ] **Step 5: Route persistence and notifications through upsert classifications**

Replace `filterNewApiItems` in persistence paths. Send normal/watch notifications only for `inserted` classifications according to `notify`; keep `updated/newlyMatched` silent. Project reminder candidates through the committed feed mode, but retain hidden watch state. Trim canonical history first, then prune watch state against retained canonical aliases. Keep mark-all-read global: it marks retained watch states at or before the watermark viewed even when their items are hidden, without suppressing later matches.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node test-background.js; node test-notification.js; node test.js`

Expected: all suites exit 0; identity, membership, read migration, watch migration, and notification matrix assertions pass.

Commit: `feat: upsert canonical feed history`

### Task 3: Make polling and continuation preserve canonical history

**Files:**
- Modify: `background.js:600-930,950-1160`
- Modify: `test-background.js:295-780,930-1140`

- [ ] **Step 1: Add failing continuation and retention tests**

Add integration cases that seed 2,363 retained identities and assert records 2,001 and 2,363 keep their original `discoveredAt`, read aliases, and watch state through all-feed continuation. Assert each page upserts into the current canonical snapshot, stale cursor/generation responses cannot write, terminal failure retains committed pages, and retention cleanup removes only expired canonical entries plus their orphan watch aliases.

- [ ] **Step 2: Run the targeted suite and verify RED**

Run: `node test-background.js`

Expected: the >2,000 identity case fails because correctness depends on `discoveredAtByAlias`, and selected/all paths still shrink canonical history.

- [ ] **Step 3: Convert regular/manual/continuation persistence to canonical upsert**

For every mutation, reread `history`, `readIds`, `watchRules`, and `watchNotifyState` inside the queued commit and call `upsertCanonicalItems`. Persist `{ history, readIds, watchNotifyState }` together. Keep existing per-path `notify` values and continuation fencing.

- [ ] **Step 4: Retire the transient discovery index safely**

New continuation state contains only cursor/retry/id/expiry metadata. If startup finds an active legacy continuation with `discoveredAtByAlias`, consume exact-ID or unambiguous alias values only for identities missing from canonical history; clear that legacy map on completion, failure, or supersession and never regenerate it.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node test-background.js; node test-notification.js`

Expected: all suites exit 0; the 2,363-item case passes without a capped discovery map, and stale continuation paths remain fenced.

Commit: `fix: preserve canonical history during continuation`

### Task 4: Add one-time migration and latest-wins source-switch commits

**Files:**
- Modify: `background.js:20-45,1160-1250,1280-1345`
- Modify: `test-background.js:295-780,780-940`

- [ ] **Step 1: Add failing migration and source-switch concurrency tests**

Cover migration with marker-absent selected/all fixtures and repeat startup after the marker is stored. Cover switching with the 2,363 all-item/96 selected-item fixture, a deferred all first page, two deferred source messages resolved in reverse order, a failed latest switch with an active continuation, and a selected response that reaches the page bound. Assert one-time promotion, stable canonical count, cached all availability, latest-generation commit, continuation preservation, successful truncated selected switch, and no absence downgrade.

- [ ] **Step 2: Run tests and verify RED**

Run: `node test-background.js`

Expected: legacy migration is absent, selected switch shrinks history, and a slower older switch can serialize ahead of the newest intent.

- [ ] **Step 3: Implement the idempotent migration**

Add `CANONICAL_HISTORY_VERSION = 1` and `migrateCanonicalHistory()` through `runStateMutation`. Commit normalized history and `canonicalHistoryVersion` together before startup/install polling. Preserve a legacy active continuation fallback as specified in Task 3.

- [ ] **Step 4: Separate source-switch fetch from commit**

Increment background-owned `sourceSwitchGeneration` immediately when a `feedModeChanged` message arrives. Fetch outside `stateMutationQueue`; then queue a commit that checks generation, rereads canonical/read/watch/rule state, upserts, checks generation again, and writes history/read/watch/mode/continuation/poll metadata once. Successful mode commit advances `feedModeGeneration`; failure or supersession leaves the old continuation authoritative.

Set `SUPPORTS_CONSISTENT_SELECTED_SNAPSHOT = false`. Selected page-bound results succeed and promote returned items; absence downgrade stays disabled. Keep the helper branch testable for a future documented capability.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node test-background.js; node test-notification.js; node test.js`

Expected: all suites exit 0; canonical history never shrinks solely because of a selected switch, and only the latest background generation commits.

Commit: `fix: switch feed modes from canonical cache`

### Task 5: Implement optimistic popup switching and coalesced latest-wins loads

**Files:**
- Modify: `popup-reliability.js:1-90`
- Modify: `popup.js:140-205,320-375,630-815,970-1020`
- Modify: `test-popup-reliability.js`
- Modify: `test-popup-ui.js`
- Modify: `background.js:1290-1335`
- Modify: `test-background.js`

- [ ] **Step 1: Add failing controller tests**

Extend `test-popup-reliability.js` with deterministic fake timers and deferred reads. Assert the pending projection starts before `sendChange` resolves; storage changes continue using pending mode; only the latest request updates controls/cache/status; failure rereads committed mode without storage writes; relevant key bursts produce one load; immediate switch cancels the pending timer; and a stale load performs none of the observable commit callbacks.

Add UI/static assertions that popup code never writes `feedMode`, `readIds`, `watchNotifyState`, `watchRules`, or badge text directly.

- [ ] **Step 2: Run popup/background tests and verify RED**

Run: `node test-popup-reliability.js; node test-popup-ui.js; node test-background.js`

Expected: rollback writes storage, pending mode can revert during storage events, loads are not coalesced/versioned, and popup remains a badge/durable-state writer.

- [ ] **Step 3: Implement the popup source-switch state machine**

Extend `createFeedModeSwitchController` to own `{ committedMode, pendingMode, switchRequestId }`. Its dependency contract must provide `loadProjection(mode, { immediate: true })`, `readCommittedMode()`, and UI-only `commit/rollback` callbacks. Pending storage changes use `pendingMode`; stale completions do nothing.

- [ ] **Step 4: Implement coalesced latest-wins loading**

Add a reliability controller that listens to `history`, `feedMode`, `readIds`, `readAllBefore`, `historyDays`, and `allFeedContinuation`; trailing-debounces ordinary changes; cancels the timer for immediate switches; assigns a load version; and calls commit only when both load version and switch request ID are current. Apply `projectHistory` before signature calculation, unread count, DOM generation, cache write, and scroll targeting. Cache only `{ feedMode, projected history, read/config fields }` and reject mode mismatch.

- [ ] **Step 5: Route durable popup actions through background messages**

Add queued background messages for `markItemsRead`, `markWatchViewed`, `saveWatchRules`, and existing `markAllRead`. Each handler rereads and merges current state before one write and then updates the badge. Remove popup fallback writes to durable keys; failures keep optimistic UI/cache ephemeral and show status. Make background the sole `chrome.action.setBadgeText` writer.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node test-popup-reliability.js; node test-popup-ui.js; node test-background.js; node test-notification.js`

Expected: all suites exit 0; the list changes immediately from local projection, storage bursts coalesce, stale loads have no side effects, and pending/failed switches cannot change the committed badge.

Commit: `perf: render feed switches from canonical cache`

### Task 6: Lock the production-equivalent regression and complete review

**Files:**
- Modify: `test-background.js`
- Modify: `test-popup-reliability.js`
- Modify: `test-popup-ui.js`
- Verify: `feed-state.js`, `background.js`, `popup-reliability.js`, `popup.js`, `popup.html`, `pack.sh`, all `test*.js`

- [ ] **Step 1: Add the final end-to-end mocked regression**

Freeze time and model the reported sequence exactly: 2,363 all items, global mark-all-read, complete 96-item selected response, selected mark-all-read, then all first page plus 100-item continuation pages. Assert canonical history does not shrink because of switching, selected shows 96, all cached projection is available before the first response, identities 2,001/2,363 remain read, only genuinely new identities are unread, watch progress survives, and popup render/load counts are bounded rather than one full rebuild per page.

- [ ] **Step 2: Verify the regression fails without the feature and passes with it**

Run the new focused regression against `HEAD^` or temporarily revert the implementation files: it must fail for destructive history replacement. Restore the implementation and run `node test-background.js; node test-popup-reliability.js`; both must pass.

- [ ] **Step 3: Run the complete offline suite**

Run: `node test.js; node test-feed-state.js; node test-notification.js; node test-background.js; node test-popup-reliability.js; node test-popup-ui.js`

Expected: every suite exits 0 with no unhandled rejection or warning introduced by this change.

- [ ] **Step 4: Run the live API contract test**

Run: `node test-e2e.js`

Expected: exit 0 against `https://aihot.virxact.com`; failure is reported separately if network/API availability prevents verification.

- [ ] **Step 5: Run static and packaging safety checks**

Run: `git diff --check; rg -n "chrome\.action\.setBadgeText" popup.js popup-reliability.js; rg -n "discoveredAtByAlias" background.js; git status --short`

Expected: no whitespace errors; no popup badge writer; discovery map references exist only in one-time legacy migration/recovery; no manifest version change, zip, dependency manifest, or unrelated user-file modifications.

- [ ] **Step 6: Request final spec and code-quality reviews**

Give reviewers the design, this plan, base SHA, and final SHA. Resolve every Critical/Important finding, rerun affected tests, then repeat review until both reviewers approve.

- [ ] **Step 7: Commit final regression/review fixes**

Commit: `test: cover canonical feed switching regression`
