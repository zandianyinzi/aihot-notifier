# Popup List Hover Feedback Design

Date: 2026-07-10
Updated: 2026-07-21

## Context

The popup list is a dense reading surface for scanning AI HOT items. Earlier iterations used permanent unread rails and a right-side hover rail, but those signals made the list feel more like an alert console than a calm reading stream.

## Goal

Separate visual meanings:

- Unread state: unread background plus stronger title tone.
- Special-watch state: pinning and the compact watch label.
- Hover state: a subtle row-wide press-dark background.
- No permanent left rail and no right-side hover rail.
- No text brightening on hover; content tone remains determined by read/unread state.

## Design

### Item background and content tone

- Read items press darker on hover using `--bg-item-hover` mixed with black.
- Unread items keep their unread identity and press darker on hover using `--bg-unread` mixed with black.
- Remove read-item hover text brightening; title, summary, and metadata colors should not change just because the pointer is over the row.
- Content tone remains the read/unread signal; hover only marks pointer position through row background.

### State semantics

- Unread items do not show a permanent left color bar.
- Hovered items do not show a right color bar.
- The list should read as a calm feed, not a warning or monitoring surface.

### Watch item behavior

- Watch unread items use pinning and the compact watch label for salience.
- Watch unread items inherit the unread press-dark hover feedback.
- Do not add watch-specific hover rails, glows, wider borders, or alarm-like color treatment.

## CSS-level direction

Use background color only, without extra DOM elements:

- Read hover: `color-mix(in srgb, var(--bg-item-hover) 88%, #000)`.
- Unread hover: `color-mix(in srgb, var(--bg-unread) 84%, #000)`.
- Unread and watch unread static state: no `box-shadow` rail.
- Hover state: no `box-shadow` rail.

## Color token guidance

The category tag palette already has the desired reading comfort: clear hue, low glare, dark-background legibility, and only a light tinted backing. Accent colors should stay in that low-glare content-signal range rather than feeling like generic system highlights.

- Keep the existing category colors unchanged.
- Tune each theme's `--accent` toward a softer, low-glare content signal color that sits comfortably beside the category palette.
- Update `--accent-soft` to match the tuned accent hue.
- `--rail` and `--rail-strong` may remain as theme tokens for legacy tests or future use, but current list hover/unread state must not render rails.
- Emphasis comes from tonal depth, title weight, labels, and pinning, not line width, glow, or warning colors.

Recommended token direction for implementation:

| Theme | Accent direction |
| --- | --- |
| `dark` | Softer amber/copper, less warning-like than the current warm orange. |
| `green-dark` | Keep the comfortable grey-teal character; only adjust if needed for consistency. |
| `chrome-dark` | Softer mist blue, less generic system-blue. |
| `slate-night` | Deeper sea-glass teal, calmer than the current brighter cyan-teal. |

## Non-goals

- Do not change item layout, spacing, click behavior, read/unread state logic, or storage behavior.
- Do not introduce new dependencies or JavaScript state for hover.
- Do not change the settings panel behavior.

## Validation

- Visually confirm read hover uses only press-dark row background.
- Visually confirm unread and watch unread hover use press-dark row background and no left/right rail.
- Run existing tests after implementation: `node test.js`, `node test-notification.js`, and `node test-popup-ui.js`.



