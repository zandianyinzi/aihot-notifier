# AI HOT v1 Migration and Reliability Implementation Plan

> 历史实施计划，保留当时步骤供追溯；复选框不是当前待办。当前 API 与状态规则见 [README](../../../README.md#技术说明)，旧 fingerprint 方案已退役。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the extension to AI HOT API v1 and make polling, persistence, links, and popup changes race-safe.

**Architecture:** `background.js` owns a v1-to-internal-item adapter and a single mutation queue. The popup consumes only the existing internal item format, queues its own user mutations, and receives explicit status feedback. Test fixtures model API v1 responses; the E2E test uses the actual v1 contract.

**Tech Stack:** Chrome Manifest V3, native JavaScript, Node.js test scripts, Chrome storage API.

---

### Task 1: Lock the API v1 contract with failing tests

**Files:**
- Modify: `test-background.js`
- Modify: `test.js`
- Modify: `test-e2e.js`

- [ ] **Step 1: Add v1 fixture assertions before implementation**

Add a fixture with `source: { name: 'Source' }`, `links: { original: 'https://example.com/original', aihot: 'https://aihot.virxact.com/items/1' }`, and `page: { hasMore: true, nextCursor: 'next' }`. Assert that a wished-for adapter produces string `source`, original `url`, AI HOT `permalink`, and recognizes `page.hasMore`.

- [ ] **Step 2: Run the targeted background test and verify RED**

Run: `node test-background.js`

Expected: failure because v1 response fields are not normalized and `hasMore` is not read.

- [ ] **Step 3: Replace legacy E2E helpers with v1 requests**

Use `https://aihot.virxact.com/api/v1/items?mode=${mode}&window=7d&limit=50`; read `json.items` and `json.page`. Assert v1 required fields (`source.name`, `links.original`, `links.aihot`) and remove the unconditional `assert(hasApiRef || true)`.

- [ ] **Step 4: Run E2E and confirm its requests are v1-only**

Run: `node test-e2e.js`

Expected: pass against the live v1 API with no `/api/public/` references.

### Task 2: Implement and harden the v1 adapter

**Files:**
- Modify: `background.js:1-215, 541-556`
- Modify: `test-background.js`

- [ ] **Step 1: Add failing malformed-input and link tests**

Add tests that a null item is skipped, a repeated/oversized cursor stops pagination safely, an invalid container rejects before persistence, and a non-HTTPS original link falls back to the HTTPS AI HOT link.

- [ ] **Step 2: Verify RED**

Run: `node test-background.js`

Expected: failures from null-item property access and absent URL validation.

- [ ] **Step 3: Add focused helpers**

Implement `getApiUrl(mode, window)`, `toInternalApiItem(item)`, `getSafeHttpsUrl(value)`, and `normalizeItemsPage(json)`. `toInternalApiItem` maps `originalTitle`, `source.name`, `links`, `attribution.{name,url}`, timestamps, and bounded text to the existing internal field names. `normalizeItemsPage` returns `{ items, hasNext, nextCursor }` only for valid v1 pages.

- [ ] **Step 4: Update v1 pagination and ETag handling**

Remove fingerprint probing and legacy `since` construction. Cache ETags by complete v1 first-page URL; send `If-None-Match` only for that same URL; treat 304 as unchanged. Use `page.hasMore` and `page.nextCursor`, and never reuse legacy state.

- [ ] **Step 5: Verify GREEN**

Run: `node test.js; node test-background.js; node test-e2e.js`

Expected: all pass, with production and test request URLs containing only `/api/v1/`.

### Task 3: Serialize background mutations and bound storage state

**Files:**
- Modify: `background.js:463-495, 580-808, 824-894`
- Modify: `test-background.js`

- [ ] **Step 1: Add failing concurrency and cleanup tests**

Use deferred mocked fetches to start two `pollNow` requests and an alarm while the first is pending. Assert one fetch/persist/notification sequence and no duplicate state. Seed an orphan `watchNotifyState` key and assert persistence removes it when its history item is absent.

- [ ] **Step 2: Verify RED**

Run: `node test-background.js`

Expected: duplicate requests or notifications and retained orphan state.

- [ ] **Step 3: Add a single mutation queue**

Implement `runExclusive(operation)` using one promise tail and `finally` release. Route alarm polling, manual polling, reset polling, and installation fetches through it. Preserve each message response promise. In `mergeAndPersistHistory`, construct the retained stable-key set and persist a pruned `watchNotifyState` with history-related writes.

- [ ] **Step 4: Verify GREEN**

Run: `node test-notification.js; node test-background.js`

Expected: no duplicate notifications, serialized reset/poll behavior, and orphan cleanup.

### Task 4: Make popup writes, links, and feedback reliable

**Files:**
- Modify: `popup.js:802-834, 914-976, 1001-1008`
- Modify: `popup.html:1129, 1177, 1256-1260`
- Modify: `test-popup-ui.js`

- [ ] **Step 1: Add failing popup assertions**

Assert named notification and watch-rule controls, an `aria-live` status element, serialized watch-rule persistence, disabled/stale-safe feed switching, and a `safeOpenItem` path that opens only HTTPS links before marking read.

- [ ] **Step 2: Verify RED**

Run: `node test-popup-ui.js`

Expected: required selectors and behavior helpers are absent.

- [ ] **Step 3: Implement minimal popup safeguards**

Add a popup mutation queue, source-switch request sequence, `safeOpenItem`, and `setStatus`. Await `chrome.tabs.create` before marking read; reject non-HTTPS URLs with live feedback. Add labels, empty-state cursor protection, and visible/assistive failure text without changing the established layout.

- [ ] **Step 4: Verify GREEN**

Run: `node test-popup-ui.js`

Expected: existing UI contract remains intact and new reliability/accessibility assertions pass.

### Task 5: Final compatibility review

**Files:**
- Modify: `README.md` only if its API or test instructions mention legacy behavior
- Verify: `background.js`, `popup.js`, all `test*.js`, `manifest.json`

- [ ] **Step 1: Run static migration checks**

Run: `rg -n '/api/public|title_en|hasNext' background.js popup.js test*.js`

Expected: no legacy request paths; any compatibility references are deliberate comments/tests only.

- [ ] **Step 2: Run the complete suite**

Run: `node test.js; node test-notification.js; node test-background.js; node test-popup-ui.js; node test-e2e.js`

Expected: every suite exits 0.

- [ ] **Step 3: Review the diff and package safety**

Run: `git diff --check; git diff -- background.js popup.js popup.html test.js test-background.js test-popup-ui.js test-e2e.js README.md`

Expected: no whitespace errors, no unintended UI regressions, and no package/version changes.
