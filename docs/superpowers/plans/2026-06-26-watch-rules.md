# Watch Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable special-watch rules that highlight and repeatedly notify important AI HOT items until viewed.

**Architecture:** Keep the extension dependency-free by adding focused pure helper functions to `background.js` and mirroring small display helpers in `popup.js`. Store user rules in `watchRules`, notification state in `watchNotifyState`, and annotate matched `history` entries with optional watch metadata.

**Tech Stack:** Chrome Extension Manifest V3, native JavaScript, `chrome.storage.local`, `chrome.notifications`, existing Node test scripts.

---

## File Structure

- `background.js`: Add watch-rule normalization, matching, notification-state scheduling, alarm checks, and viewed-state message handling.
- `popup.html`: Add special-watch settings controls, a top watch section, and highlighting styles.
- `popup.js`: Add watch-rule CRUD, watch section rendering, and viewed-state synchronization.
- `test.js`: Add pure tests for rule matching and notification scheduling.
- `test-notification.js`: Add mock tests for watch notifications, max-per-cycle behavior, and viewed suppression.
- `manifest.json`: Bump version after implementation per repository release rule.

### Task 1: Pure Watch Logic Tests

**Files:**
- Modify: `test.js`

- [ ] **Step 1: Add tests for watch matching and schedule calculation**

Add tests that assert:
- source/author/keyword combo matches `公众号：数字生命卡兹克` with `Claude Code` in title.
- empty rule does not match.
- comma-separated keywords match any keyword.
- next reminder schedule is immediate, 2 minutes, 5 minutes, 2 hours, then 24 hours.
- viewed state suppresses reminders.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js`
Expected: FAIL because helper functions are not implemented/exported in the copied test logic.

### Task 2: Background Watch Helpers

**Files:**
- Modify: `background.js`
- Modify: `test.js`

- [ ] **Step 1: Implement watch helper functions**

Add functions for:
- `normalizeWatchRules(rules)`
- `splitWatchKeywords(value)`
- `parseSourceParts(source)`
- `matchWatchRules(item, rules)`
- `getNextWatchNotifyAt(firstMatchedAt, notifyCount)`
- `isWatchViewed(state)`
- `buildWatchStateForItem(existingState, item, ruleIds, now)`

- [ ] **Step 2: Mirror pure helper logic in `test.js`**

Keep test script self-contained by adding equivalent pure helper logic where existing tests use copied functions.

- [ ] **Step 3: Run tests**

Run: `node test.js`
Expected: PASS.

### Task 3: Background Notification Flow

**Files:**
- Modify: `background.js`
- Modify: `test-notification.js`

- [ ] **Step 1: Add failing notification tests**

Add tests that assert:
- special-watch items get `特别关注` notifications.
- a poll cycle sends at most 3 watch notifications.
- ordinary notification excludes watch items.
- viewed watch state prevents repeat notification.

- [ ] **Step 2: Implement notification flow**

Update `showNotification(items)` and alarm flow to:
- read `watchRules` and `watchNotifyState`.
- annotate matched history entries.
- send due watch notifications first, max 3 per cycle.
- send normal notification only for non-watch items.
- schedule/check repeat reminders using existing alarm wakeups.

- [ ] **Step 3: Add viewed message handler**

Handle `markWatchViewed` runtime message and notification clicks by writing `viewedAt` for the URL.

- [ ] **Step 4: Run notification tests**

Run: `node test-notification.js`
Expected: PASS.

### Task 4: Popup UI and State

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 1: Add settings and top section markup**

Add:
- `watchRulesList`
- source/author/keywords inputs
- add-rule button
- unread special-watch items pinned inside `historyList` without duplicate rows

- [ ] **Step 2: Add styles**

Add styles for watch rule cards, watch section, star badge, and main-list watch label.

- [ ] **Step 3: Implement popup rule CRUD**

Load/save `watchRules`; add, edit, toggle, and delete rules.

- [ ] **Step 4: Render pinned watch items**

Pin unread matched items at the top of the main list, avoid duplicate rendering, restore read items to their time-sorted position, and keep the compact `重点` label in the main history list.

- [ ] **Step 5: Mark viewed from popup actions**

When clicking a watched item or clicking mark-all-read, send `markWatchViewed` with affected URLs.

### Task 5: Final Validation and Release Prep

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Bump extension version**

Increment `manifest.json` version from current patch version to the next patch version.

- [ ] **Step 2: Run tests**

Run:
- `node test.js`
- `node test-notification.js`
- `node test-popup-ui.js`

Expected: all PASS.

- [ ] **Step 3: Package**

Run: `bash pack.sh`
Expected: creates `aihot-notifier.zip`.

- [ ] **Step 4: Review diff**

Run: `git diff --stat` and `git diff --check`.
Expected: no whitespace errors; changed files match this plan.

## Self-Review

- Spec coverage: rules, UI, notifications, repeat reminders, viewed suppression, storage compatibility, tests, and version bump are covered.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: field names match the design spec: `watchRules`, `watchNotifyState`, `watchMatched`, `watchRuleIds`, `watchMatchedAt`, `viewedAt`.
