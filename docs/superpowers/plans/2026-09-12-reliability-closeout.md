# Reliability Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audited background reliability, popup accessibility/feedback, and storage-boundary gaps while preserving the current extension contract.

**Architecture:** Extend the existing background queue, generation fencing, continuation alarm, and popup reliability helpers in place. Keep network normalization and durable writes in their current ownership boundaries; add only focused helpers and tests where a boundary is currently missing.

**Tech Stack:** Manifest V3, native JavaScript/HTML/CSS, Chrome storage/alarms/notifications APIs, Node.js test scripts.

**Spec:** `docs/superpowers/specs/2026-09-12-reliability-closeout-design.md`

## Global Constraints

- Keep Manifest V3, current permissions, current storage keys, feed modes, and HTTPS URL policy.
- Do not upgrade the manifest version or generate a release zip.
- Legacy `/api/public/fingerprint` remains a temporary change-detection dependency until a v1 replacement exists.
- Every behavior change starts with a failing Node test.
- Existing suites and `node test-e2e.js` must remain green.

### Task 1: Pagination and Automatic Continuation

**Files:**
- Modify: `background.js`
- Test: `test-background.js`

**Interfaces:** Preserve `fetchItems({ mode, cutoff, maxPages, baseUrl })` return metadata. Add no public API. Automatic polling may reuse `getActiveAllContinuationStatus`, `continueAllFeed`, and `commitAllContinuationMutation`.

- [ ] **Step 1: Write failing tests** for an unordered page where a later cursor still contains an in-window item, and for automatic `all` polling that persists a continuation after its page budget.
- [ ] **Step 2: Run `node test-background.js` and verify the new tests fail for the early cutoff and missing continuation behavior.
- [ ] **Step 3: Implement the smallest change: disable cutoff short-circuiting by default, mark cutoff termination incomplete, and make automatic `all` polling persist and schedule a fenced continuation.
- [ ] **Step 4: Run `node test-background.js` and the focused existing pagination tests.
- [ ] **Step 5: Commit with `fix: preserve complete all-feed pagination`.

### Task 2: Request Deadlines and Timestamp Validation

**Files:**
- Modify: `background.js`
- Test: `test-background.js`, `test.js`

**Interfaces:** Keep normalized item shape and failure/backoff semantics. Add a shared request deadline constant and injectable timeout behavior only where tests require it.

- [ ] **Step 1: Write failing tests** for a never-settling fingerprint/items request and items with missing or invalid normalized timestamps.
- [ ] **Step 2: Run the focused tests and verify timeout/invalid-item failures.
- [ ] **Step 3: Add AbortController deadlines to both request paths and reject or skip invalid timestamps during normalization.
- [ ] **Step 4: Run `node test.js` and `node test-background.js`.
- [ ] **Step 5: Commit with `fix: bound polling requests and reject invalid timestamps`.

### Task 3: Popup Accessibility and Visible Feedback

**Files:**
- Modify: `popup.html`, `popup.js`
- Test: `test-popup-ui.js`, `test-popup-reliability.js`

**Interfaces:** Preserve existing `showPopupStatus()` callers and popup reliability helpers. Add fixed status-row markup/classes and focus state handling without changing list rendering contracts.

- [ ] **Step 1: Write failing tests** for `aria-expanded`/`aria-controls`, closed-panel `inert`, visible status styling, and accessible delete controls.
- [ ] **Step 2: Run focused popup tests and verify failures.
- [ ] **Step 3: Implement panel state/focus management, visible status rendering, and labels/hit areas.
- [ ] **Step 4: Run `node test-popup-ui.js` and `node test-popup-reliability.js`.
- [ ] **Step 5: Commit with `fix: expose popup state and keyboard feedback`.

### Task 4: Popup Mutation Rollback

**Files:**
- Modify: `popup.js`, `popup-reliability.js`
- Test: `test-popup-reliability.js`, `test-popup-ui.js`

**Interfaces:** Extend `openHttpsUrl` or a focused helper to expose successful tab creation before durable read commit. Preserve mobile-safe behavior with an explicit rollback path.

- [ ] **Step 1: Write failing tests** for tab creation failure restoring unread state and storage config failure restoring prior controls.
- [ ] **Step 2: Run focused tests and verify failures.
- [ ] **Step 3: Implement rollback and visible failure messages while keeping optimistic mobile behavior.
- [ ] **Step 4: Run popup suites and the full Node suite.
- [ ] **Step 5: Commit with `fix: rollback failed popup mutations`.

### Task 5: Storage Bounds and Documentation

**Files:**
- Modify: `background.js`, `docs/superpowers/specs/2026-07-26-v1-reliability-design.md`
- Test: `test.js`, `test-background.js`

**Interfaces:** Keep existing storage keys. Add deterministic truncation constants/helpers applied before canonical history persistence.

- [ ] **Step 1: Write failing tests** for history count/text caps and orphan state cleanup after trimming.
- [ ] **Step 2: Run focused tests and verify failures.
- [ ] **Step 3: Add the caps, trim oldest entries, and document the temporary fingerprint strategy.
- [ ] **Step 4: Run all local suites and `node test-e2e.js`.
- [ ] **Step 5: Commit with `fix: bound canonical history storage`.

### Task 6: Whole-Branch Review and Verification

**Files:** No new production files.

- [ ] **Step 1: Review the implementation plan against the spec and task ledger.
- [ ] **Step 2: Run every required test command and inspect exit codes/output.
- [ ] **Step 3: Run a final diff and static audit for permissions, version, and generated artifacts.
- [ ] **Step 4: Commit only if verification is clean; otherwise fix through the task review loop.

## Concrete regression scenarios and implementation contracts

Task 1 uses literal pages and the real background message/alarm handlers. Its regression sequence is:
```js
// First page has an old tail; second page remains reachable.
page1 = { items: [recentItem, oldItem], page: { hasMore: true, nextCursor: 'later' } };
page2 = { items: [otherRecentItem], page: { hasMore: false, nextCursor: null } };
// Assert both recent IDs exist after pollNow; old tail must not suppress page2.
// For all: run initial alarm with 20 pages; trigger continuation alarm with 19
// more pages; assert cursor stays active; trigger again until hasMore=false.
```
Task 2 uses the real fetch boundary with controlled timers:
```js
fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});
// Advance controlled time 15000ms and assert poll failure plus queued read
// mutation completion. Repeat with headers resolved and response.json hanging.
// publishedAt='bad', indexedAt='2026-09-12T01:00:00.000Z' must normalize
// to the indexed timestamp; both invalid must increment skippedItems.
```
Task 3 tests real controller/handlers with focusable element fixtures, then validates browser rendering:
```js
settingsBtn.click();
// aria-expanded true; inert false; activeElement is first summary.
settingsBtn.click();
// aria-expanded false; inert true; activeElement is settingsBtn.
// Error region uses fixed height 28px and role=status; refresh failure
// produces readable text while history viewport remains same size.
```
Task 4 resolves navigation ownership in the background rather than persisting read state before navigation:
```js
// Message: { type: 'openItem', url, key }
// 1. Validate url is HTTPS.
// 2. await chrome.tabs.create({ url });
// 3. Queue markItemsRead and markWatchViewed together after success.
// Failure of step 2 must leave durable read/watch state untouched.
// Popup failure path restores only its optimistic DOM/cache projection.
// Concurrent markAllRead remains authoritative.
```
Task 5 uses deterministic count and UTF-8 budget:
```js
// 2501 entries -> 2500 newest retained; oldest excluded from notification.
// Chinese summaries exercise actual UTF-8 budget, not JS string length.
const encodedBytes = new TextEncoder().encode(JSON.stringify(managedData)).length;
// encodedBytes <= 6 * 1024 * 1024 after trimming.
// First quota rejection retries once with smaller history; second failure
// leaves original durable history/fingerprint metadata untouched.
```

The task briefs in the ignored work ledger provide exact execution details;
this plan and the design are the durable review record. Reports are local only.
