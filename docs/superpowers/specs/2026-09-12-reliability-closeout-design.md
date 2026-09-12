# Reliability Closeout Design

## Goal

Raise the extension from a reliable prototype to a production-ready MV3 extension by closing the audited data-integrity, request-lifecycle, accessibility, feedback, and storage-boundary gaps without changing permissions or the public product model.

## Scope

The work is split into three independently testable batches:

1. Background reliability: pagination completeness, automatic `all` continuation, request deadlines, and timestamp validation.
2. Popup experience: visible status feedback, keyboard focus management, accessible rule controls, and mutation rollback.
3. Data governance and maintenance: bounded history/text storage and alignment of the reliability design documentation with the temporary legacy fingerprint dependency.

## Background behavior

- V1 pagination must not infer global ordering from a page's last item. Cutoff short-circuiting is disabled unless an explicit capability says the API guarantees monotonic order. A cutoff termination is incomplete and must not advance fingerprint or `lastItemsPollAt`.
- Automatic `all` polls fetch the first page set, persist an `allFeedContinuation` when the page budget is reached, and use the existing continuation alarm to resume later. Continuations are fenced by mode/generation and are cancelled or settled when a newer source switch wins.
- Fingerprint and item requests use an `AbortController` deadline. A timeout is a normal API failure with backoff, and mutation operations remain responsive after the request settles.
- V1 items require a parseable `publishedAt`, `indexedAt`, or equivalent normalized time. Invalid items are skipped and counted; valid items retain their existing discovery semantics.

## Popup behavior

- The settings trigger exposes `aria-expanded` and `aria-controls`. A closed settings panel is `inert`; focus returns to the trigger when closing and moves to the first group heading when opening.
- Status feedback remains an `aria-live` region and also renders in a fixed-height visible status row so failures such as refresh, source switch, load, and rule-save errors are understandable without a screen reader.
- Opening a history item is optimistic for mobile popup lifetime, but a failed tab creation rolls back the visual and durable read state.
- Configuration writes capture the previous control values and restore them on storage failure.
- Rule delete and keyword delete controls have explicit accessible names and at least a 24px hit area.

## Storage limits

- Canonical history is capped at 2500 retained entries after time filtering.
- Stored title is capped at 500 characters, summary at 3000, and source at 300.
- When the cap is exceeded, oldest entries are removed first while retaining read/watch state only for surviving canonical aliases.

## Compatibility and release constraints

- Keep Manifest V3, current permissions, current storage keys, feed modes, and HTTPS URL policy.
- Do not upgrade the manifest version or generate a release zip.
- Legacy `/api/public/fingerprint` remains a temporary change-detection dependency until a v1 replacement exists; documentation must say so explicitly.

## Testing

Every behavior change starts with a failing Node test. Regression coverage must include unordered pages, automatic all continuation and recovery, request timeout behavior, invalid timestamps, storage trimming, closed-panel focus/inert state, visible failure feedback, failed tab creation rollback, failed config persistence rollback, and accessible rule controls. Existing suites and `node test-e2e.js` must remain green.
