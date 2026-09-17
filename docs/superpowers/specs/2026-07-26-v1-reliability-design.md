# AI HOT v1 Migration and Reliability Design

> 历史迁移设计。当前轮询直接使用 v1 items 的 ETag，不再请求 legacy fingerprint；现役合同见 [README](../../../README.md#技术说明)。

## Goal

Keep the extension working after the AI HOT legacy public API sunset while eliminating the refresh and state races found in the audit.

## Chosen approach

Use a single background-owned adapter that maps API v1 responses into the extension's existing internal item shape. The popup continues to render only that internal shape. This limits the migration boundary to the service worker and preserves stored-history compatibility.

The adapter will request `/api/v1/items` with `mode`, `window`, and `limit`; map `source.name`, `links.original`, `links.aihot`, and `page.{hasMore,nextCursor}`; and retain only a bounded local history window. Canonical history is merged across source modes rather than replaced on a mode switch. Item links open `links.original` when it is an HTTPS URL and otherwise fall back to `links.aihot`.

## Polling and persistence

Every mutating refresh path (alarm, manual refresh, content-source reset, and initial load) will use one background queue. The queue prevents duplicate notifications and lost storage updates. V1 ETags are held per complete request URL and reused only for that same URL. The legacy fingerprint endpoint remains a temporary change probe; items data always comes from the paginated v1 endpoint.

Network input is normalized before persistence: response containers, item objects, text length, timestamps, cursors, and URLs are validated. Invalid individual items are skipped; invalid page containers fail the request without modifying history. Persisting history removes orphaned `watchNotifyState` entries, enforces a 2500-entry cap and 500/300/3000 title/source/summary limits, and keeps managed JSON below a 6 MiB UTF-8 budget with one smaller-history quota retry.

## Popup behavior

The popup will serialize watch-rule changes and content-source changes, prevent stale source-switch completions from overwriting newer choices, validate URLs before opening them, and mark an item read only after opening succeeds. It will expose short live-region failure feedback and programmatic labels for the audited controls.

## Testing and acceptance criteria

Tests are added before each production change. They cover v1 field and pagination mapping, ETag/304 behavior, malformed payloads, unsupported links, orphan state cleanup, concurrent refreshes, stale source changes, and watch-rule writes. All existing Node suites plus the updated v1 E2E contract suite must pass. The old `/api/public/*` endpoints must be absent from production and test requests.

### Reliability storage policy
Canonical history is bounded to 2,500 newest entries; text fields are normalized and managed JSON stays within a 6 MiB UTF-8 budget. Quota failures retry once with a smaller history before state or fingerprint changes are committed.

