# Global History Cache and Feed Projection Design

## Problem

The extension currently stores only the latest feed-mode result in `history`. Switching from `all` to `selected` replaces a large all-feed history with the much smaller selected response. Switching back to `all` then rediscovers the discarded entries page by page and gives them a new `discoveredAt`, so previously read entries become unread again.

The same rebuild amplifies popup work. Every continuation page rewrites the growing history array, and every storage change makes the popup reread storage, recompute the full render signature, rebuild the full list, and rewrite its warm cache. A 2,000-plus item feed therefore produces repeated 100/200/300-item full renders instead of an immediate cached switch followed by coalesced refreshes.

## Goals

- Preserve item identity, `discoveredAt`, read state, and watch state across feed-mode switches.
- Make switching back to `all` display the locally cached corpus immediately.
- Keep `history` as one bounded, durable source of truth instead of creating per-mode copies or a second identity ledger.
- Apply the same feed projection to popup rendering, unread counts, badge state, unread positioning, and watch behavior.
- Reduce popup work during progressive all-feed continuation without introducing incremental DOM complexity.
- Preserve the existing API, storage schema, and Manifest V3 service-worker model where practical.

## Non-goals

- Reconstructing discovery timestamps already destroyed by an older version.
- Persisting unlimited history outside the existing retention window.
- Adding a database, dependency, virtualized list, or a second per-mode history store.
- Changing API endpoints, polling intervals, notification policy, or the meaning of the global read watermark.

## Chosen Model

`chrome.storage.local.history` becomes the canonical history for every feed mode. It contains the retained union of items learned from `all` and `selected` requests. `feedMode` controls two things only:

1. the API query used for subsequent refreshes;
2. the visible projection consumed by the popup and background badge.

The shared projection rule is:

```js
function isVisibleInFeedMode(item, feedMode) {
  return feedMode === 'all' || item.selected === true;
}
```

The popup never treats the selected response as a replacement history. In selected mode it filters the canonical history through this predicate. In all mode it displays the full retained canonical history.

## Canonical Identity and Upsert

Every fetched item is normalized and upserted into canonical history. The operation returns one retained record per identity and sorts the result by the existing item-time rule.

Identity matching follows this order:

1. Winner selection first looks for the same normalized exact API `id`; an exact-ID winner matches only that ID.
2. If no exact-ID winner exists, permalink or original URL aliases may select one ID-less legacy winner as fallback.
3. Two records with different non-empty IDs must not be merged merely because their URLs collide.
4. After winner selection, a separate cleanup phase may absorb one ID-less legacy duplicate when exactly one such candidate owns one of the winner's aliases. This cleanup also runs when the exact-ID winner already existed.
5. If several ID-less candidates share an alias, or an alias also belongs to a different non-empty ID, the alias is ambiguous and no fallback merge occurs.
6. When a safe legacy merge occurs, the API-ID record is the winner, all absorbed ID-less duplicates are removed, and the earliest valid `discoveredAt` across the winner and absorbed records is retained.

For an existing identity, upsert:

- preserves the earliest valid `discoveredAt`;
- refreshes server-owned fields such as title, summary, source, author, timestamps, links, and ranking data;
- preserves and migrates local-only state represented outside the API response;
- classifies watch changes through the existing watch pipeline without treating every field refresh as a newly discovered item;
- applies selected membership using the rules below.

For a genuinely new identity, upsert assigns the current poll discovery time once. Later pages, restarts, or feed switches must retain that value.

Upsert returns `inserted`, `updated`, and `newlyMatched` classifications. Ordinary and watch new-item behavior applies only to `inserted` items. To preserve current policy, an existing `updated` item that newly matches a rule updates its rendered match metadata but does not create notification state, send a notification, or become eligible for a reminder. A later genuinely new item is unaffected. An unchanged watch match preserves its state and never resends a first-item notification.

Notification behavior is fixed by call path:

| Call path | `notify` | Inserted normal item | Inserted watch item | Updated/newly matched item |
| --- | --- | --- | --- | --- |
| Scheduled automatic poll | `true` | Immediate existing aggregate notification | Immediate existing watch notification within the cycle budget; retained state drives later reminders | No notification and no new reminder state |
| Manual poll | `false` | Silent | Create unviewed watch state; the normal reminder scheduler may notify later | No notification and no new reminder state |
| Source switch | `false` | Silent | Create unviewed watch state; the normal reminder scheduler may notify later | No notification and no new reminder state |
| All-feed continuation or recovery | `false` | Silent | Create unviewed watch state; the normal reminder scheduler may notify later | No notification and no new reminder state |

Rule edits do not retroactively create reminder state for already retained items. The table changes no notification timing relative to the current implementation.

When identity convergence changes the canonical key, the same serialized mutation migrates local aliases:

- if any absorbed alias is present in `readIds`, the canonical ID is added before obsolete aliases are bounded or removed;
- watch states from absorbed aliases are merged under the canonical ID by recomputing `ruleIds` from the canonical item and current rules, taking the earliest valid `firstMatchedAt`, earliest non-empty `viewedAt`, maximum `notifyCount`, and latest valid `lastNotifiedAt`, then deriving `nextNotifyAt` through the existing reminder schedule from the merged count and last-notified time; a viewed state has no next reminder;
- obsolete alias keys are removed only after the canonical state is durable;
- aliases belonging to a different non-empty ID are never migrated.

## Selected Membership

Selected membership is stored on the canonical item as strict boolean `selected`.

- Any item returned by a `selected` request is written with `selected: true`, even if the response omits or misstates that field.
- Normalization preserves whether the API `selected` field was present separately from its boolean value. An item returned by an `all` request changes membership only when the field is present; explicit `false` downgrades it, while a missing field preserves its prior membership.
- A selected request may downgrade a previously selected item to `selected: false` by absence only when the request represents an authoritative complete snapshot for the requested retention window.
- A failed, malformed, rate-limited, cancelled, stale-generation, or truncated selected request must not downgrade any absent item.
- Progressive all-feed pages do not infer non-membership from absence.

An authoritative complete selected snapshot must satisfy all of these conditions:

- every page was fetched synchronously through a normal `hasMore: false` termination;
- no page exceeded the configured page bound, repeated or lost a cursor, or returned an invalid container;
- no item was skipped because its identity or membership could not be normalized;
- the API contract guarantees cursor pagination represents one consistent snapshot.

If the final condition is not guaranteed by the deployed API contract, absence-based downgrade remains disabled. Returned selected items are still promoted to `selected: true`; explicit membership values observed in all mode may still update individual items.

The current deployed contract does not document snapshot-consistent cursors, so production sets `SUPPORTS_CONSISTENT_SELECTED_SNAPSHOT = false`. A valid selected result that reaches the page bound is a successful switch and promotes every returned item, but it does not downgrade absent items. The capability may be enabled only after the official API contract guarantees a consistent cursor snapshot; tests exercise both capability values.

The complete selected snapshot and its membership changes are committed atomically with `feedMode`. Until that commit succeeds, the old mode, canonical history, continuation, and membership remain authoritative.

## Refresh and Source Switching

All history mutations continue through the existing background mutation queue.

A source switch has separate popup and durable phases:

1. The popup records `committedMode`, sets `pendingMode` and a monotonic `switchRequestId`, then immediately reads canonical history and renders it with `pendingMode` as an optimistic projection. It does not wait for the network and does not persist `feedMode` itself.
2. The background fetches and validates the target mode while the previously committed mode remains authoritative in storage.
3. While a switch is pending, every popup load projects with `pendingMode`, even if continuation or read-state changes arrive for `committedMode`.
4. On success for the current `switchRequestId`, the background atomically commits the merged canonical history and target mode; the popup promotes `pendingMode` to `committedMode`, clears pending state, and reconciles the view.
5. On failure for the current `switchRequestId`, the popup clears pending state and restores the authoritative mode freshly read from storage. Rollback changes only the control, projection, and matching warm cache; it never writes `feedMode`.
6. A completion for an older request ID has no popup side effects.

The background independently owns source-switch ordering. On message arrival it increments `sourceSwitchGeneration` before starting network work and captures that generation for the request. Source-switch network fetches run outside the storage mutation queue. When a fetch finishes, its commit enters the mutation queue, rejects itself unless it still owns the latest generation, rereads canonical history, membership, watch rules/state, and read IDs, performs the merge, checks the generation again, and issues one storage commit. Popup request IDs are presentation guards only and are not trusted for durable ordering. A worker termination cancels in-memory requests and leaves the last durable mode authoritative.

Pending source-switch requests do not invalidate the committed all-feed continuation. A failed or superseded request leaves that continuation running. A successful commit advances the committed feed-mode generation and deactivates the old continuation in the same write, so a cursor response that finishes afterward fails its normal generation/identity checks.

Within the successful background phase:

1. For `all`, fetch and validate the first page without modifying storage. For `selected`, synchronously fetch through its configured bound so completeness is known before membership changes are considered.
2. Upsert fetched items into the current canonical history and apply only membership changes proven by that response.
3. Trim the merged canonical history by the existing bounded retention rule.
4. Prune watch state against the trimmed canonical history, not the target-mode projection.
5. Atomically store canonical history, migrated `readIds`, target `feedMode`, continuation state, watch state, and poll metadata.
6. Update the badge from the target-mode projection.
7. Start continuation only for a truncated `all` result and only after the first-page commit succeeds. Selected mode never commits a partial snapshot as complete, although returned items from a valid truncated result may still be promoted without absence-based downgrade.

If the initial target request fails, nothing about the active mode, history, membership, watch state, or active all-feed continuation changes.

Switching from selected back to all therefore exposes cached all-mode entries as soon as local storage is read. Network refresh then upserts changes in the background; it does not clear the list or make cached identities new again.

## All-feed Continuation

Continuation state remains responsible for cursor, retry metadata, continuation identity, and generation fencing. It is no longer responsible for preserving discovery identity.

Each valid continuation page:

- rereads the current canonical history inside the serialized mutation;
- upserts the page into canonical history;
- retains existing `discoveredAt` for every known identity, with no 2,000-entry cap;
- advances the cursor only if the continuation identity, expected cursor, mode, and generation still match;
- prunes expired canonical items and orphan watch state together;
- commits the page and next continuation state atomically.

A stale response from an older cursor, generation, continuation, or feed mode cannot write history or membership. Retry scheduling and terminal cleanup must not discard canonical state. Service-worker restart recovery uses persisted canonical history and continuation metadata, so identity state does not depend on transient in-memory maps.

`allFeedContinuation.discoveredAtByAlias` becomes unnecessary and is omitted from newly created continuation state. During upgrade only, an already-active legacy continuation may use its persisted exact-ID or unambiguous alias entries as a one-time discovery fallback for identities absent from canonical history. The index is removed when that legacy continuation completes, fails, or is superseded; it is never regenerated.

## Read and Watch Semantics

The existing global `readAllBefore` watermark remains shared across modes. Feed switching never changes it. An item is unread only when its retained discovery/reference time is later than the watermark and none of its read aliases is present.

Because canonical upsert preserves `discoveredAt`, an old item rediscovered in another mode remains read. Only a genuinely new identity discovered after the watermark becomes unread.

`watchNotifyState` is associated with canonical item aliases and is pruned only after canonical retention cleanup. Hiding an all-only item in selected mode does not delete its `viewedAt`, match time, notification count, or reminder state. Watch notification and reminder candidates are restricted to the committed active-mode projection, while storage retention always uses canonical history.

The popup, background badge, mark-all-read button visibility, first-unread positioning, and visible unread total all consume the same `isVisibleInFeedMode` predicate. Mark-all-read advances the global watermark and marks every retained watch state with `firstMatchedAt <= watermark` viewed, including entries hidden by the current projection. A watch match created after the watermark remains unviewed. Mark-all-read does not alter membership or delete hidden state.

Popup writes that intersect canonical state no longer race the background queue. Read-alias changes, watch viewed changes, watch-rule changes, and mark-all-read are sent to background mutation handlers. The background rereads current canonical/read/watch state inside the queued mutation before merging and committing it. Popup fallback paths may update ephemeral UI or cache only; they do not directly overwrite durable `readIds`, `watchNotifyState`, `watchRules`, or `feedMode`.

## Popup Loading and Rendering

The popup reads canonical history but renders only the active feed projection. The projection is applied before unread counting, signature generation, DOM rendering, and scroll positioning.

Changes to `history`, `feedMode`, `readIds`, `readAllBefore`, `historyDays`, and continuation status are coalesced through a short trailing debounce. Multiple continuation commits within the interval trigger one load. A source-switch interaction or completion requests an immediate load and cancels the pending debounced load.

Every asynchronous `loadHistory()` receives a monotonically increasing request version and captures the active switch request ID. After storage and warm-cache reads finish, only the latest load for the current switch state may update DOM, continuation status, render signatures, popup cache, or reconcile/write any read aliases. Older in-flight loads exit before all side effects.

The background is the sole badge writer. Popup rendering, including an optimistic pending-mode projection, never calls `chrome.action.setBadgeText`. The badge changes only after durable history, mode, or read mutations and is calculated from that committed projection. A pending or failed source switch therefore cannot expose an optimistic badge count.

The warm popup cache stores the current projected history together with its normalized `feedMode`, rather than blindly duplicating canonical history. A cache is renderable only when its mode matches the desired mode. During an optimistic switch to a mode without a matching warm cache, the popup reads canonical history from local storage before rendering. Cache reconciliation may merge read aliases, but it cannot replace newer canonical items or write a stale mode back to storage.

This design deliberately keeps full-list rendering for a committed snapshot. Coalescing, projection-before-render, render-signature skipping, and latest-wins ordering address the observed repeated work without expanding scope to virtualization or incremental DOM reconciliation.

## Storage and Migration

The current `history` value is adopted as canonical on upgrade. A small top-level `canonicalHistoryVersion` marker makes this migration one-time and idempotent:

- if the marker is absent and the stored `feedMode` is `selected`, every currently stored history item is marked `selected: true`, because the legacy single-slot model proves that the whole stored set came from selected mode;
- if the marker is absent and the stored mode is `all`, existing explicit membership is normalized without assuming missing values are selected;
- the normalized history and marker are committed together through the background mutation queue before normal polling;
- once the marker exists, startup never bulk-promotes history again.

Entries already discarded by an older source switch cannot have their original `discoveredAt` reconstructed safely. Published or indexed time is not a valid substitute because newly discovered old content would incorrectly be marked read. Therefore:

- the upgrade preserves every identity present at deployment time;
- from deployment onward, source switching never destructively discards retained identities;
- users whose all-only history was previously lost may see one final all-feed rebuild and may need one final mark-all-read action;
- the implementation does not guess historical discovery times.

Retention cleanup continues to bound storage. Cleanup first trims canonical history, then removes watch-state aliases that no retained canonical item owns. Hidden selected/all projections do not affect cleanup.

## Failure and Concurrency Rules

- All durable storage mutations that affect history, membership, continuation, read/watch state, watch rules, or mode are serialized by the background mutation queue.
- A target-mode fetch failure leaves the previous committed mode and state intact.
- A stale background source-switch generation cannot overwrite a newer switch, even when its network request finishes later or came from another popup context.
- A stale continuation response cannot merge items, advance a cursor, or change membership.
- Badge calculation occurs from the same committed mode and canonical snapshot; it must not observe a mixed old-mode/new-history state.
- A storage write failure reports switch failure and leaves the previous durable state authoritative.
- Optional continuation failure stops or retries continuation according to current policy without rolling back already committed canonical pages.

## Test Strategy and Acceptance Criteria

Tests are written before production changes. Conflicting tests that currently require selected switching to replace history are changed to assert canonical retention.

Required regressions:

1. With time frozen so retention does not expire entries, start with 2,363 all-feed items, mark all read, switch to a complete 96-item selected snapshot, mark selected read, then switch to progressive all pages. Canonical count does not shrink because of the selected switch, selected projection contains only 96 items, switching back to all immediately exposes the cached corpus, and old identities remain read.
2. Progressive all pages preserve discovery time and read/watch state for old identities; only genuinely new identities are unread.
3. Identity preservation covers more than 2,000 records, including records 2,001 and 2,363, without a transient alias-index cap.
4. Exact ID wins over a colliding URL; only one unambiguous ID-less legacy candidate is absorbed; duplicate winner selection, earliest discovery, read alias, and merged watch fields are deterministic.
5. Selected responses force returned identities to `selected: true`. An all response with explicit `false` downgrades an item, while a missing field preserves membership. With the production capability disabled, even a complete selected result never downgrades by absence; capability-enabled tests allow only an authoritative complete snapshot to do so. Truncated, skipped-item, cursor-invalid, failed, stale, or malformed responses never downgrade absent items. A page-bound selected result still switches mode and promotes returned items.
6. Popup count, background badge, first-unread positioning, mark-all-read visibility, and watch candidates use the same active-mode projection.
7. Watch state for all-only hidden entries survives selected mode and remains attached after switching back.
8. An all continuation in flight cannot write after a successful selected switch. A failed selected switch preserves the active all mode, cursor, canonical history, and alarm.
9. Duplicate continuation alarms, retries, cursor races, terminal failures, and service-worker restart recovery do not regress canonical discovery or membership.
10. A source-switch state machine renders the requested cached projection before its network response, keeps using pending mode during unrelated storage changes, commits only the current popup request on success, and restores authoritative storage mode without writing it on failure.
11. Concurrent source switches from one or more popup contexts are ordered by background generation; only the newest request can commit after rereading state, while failed/superseded requests preserve the live committed continuation.
12. Popup storage bursts for every rendering key are coalesced, an immediate switch load cancels pending debounce, stale loads exit before every side effect, and the warm cache is rejected when its mode does not match.
13. Pending and failed source switches never alter the committed badge; background badge updates follow durable mode/history/read commits only.
14. Popup read/watch/rule mutations racing continuation are serialized and merged without losing canonical, read, or watch state.
15. The notification matrix is covered for inserted, updated, and newly matched items across scheduled, manual, source-switch, and continuation paths.
16. One-time migration promotes legacy selected-slot items exactly once, preserves all-mode membership, and consumes an active legacy continuation discovery index only as a bounded fallback.
17. Retention cleanup removes only expired canonical entries and prunes their orphan watch states in the same mutation.
18. Existing pure-logic, notification, background integration, and API contract suites continue to pass.

## Implementation Boundaries

The implementation should introduce small pure helpers for identity upsert and a single feed-projection contract used consistently in both extension contexts, then route existing background and popup consumers through them. It should remove ongoing correctness dependence on `discoveredAtByAlias`, update contradictory integration expectations, route intersecting popup mutations through background messages, and add focused migration, optimistic-switch, debounce, and latest-wins controller tests.

No manifest version bump, generated release package, external dependency, API contract change, or unrelated UI redesign is part of this work. Maintaining `pack.sh` so the new runtime source is included in a future package is required source maintenance, not a release operation.
