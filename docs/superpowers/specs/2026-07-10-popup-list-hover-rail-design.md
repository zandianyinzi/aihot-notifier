# Popup List Hover Rail Design

Date: 2026-07-10

## Context

The popup tweet list currently uses the same background highlight for both read and unread items on hover. This makes read and unread items feel visually similar while the pointer is over them, weakening the distinction between item state and pointer focus.

## Goal

Separate visual meanings:

- Left rail: unread state.
- Right rail: current hover position.
- No background brightening on hover for either read or unread items.
- No text brightening on hover; content tone remains determined by read/unread state.

## Design

### Item background and content tone

- Remove the shared hover background highlight from list items.
- Read items keep their normal background on hover.
- Unread items keep `--bg-unread` on hover.
- Remove read-item hover text brightening; title, summary, and metadata colors should not change just because the pointer is over the row.
- Content tone remains the read/unread signal; hover only marks pointer position.

### Rail semantics

- Unread items keep the existing left rail style.
- Hovered items show a right rail using the same visual language as the unread rail, without changing background or text color.
- For unread hovered items, both rails appear at once:
  - Left rail means unread.
  - Right rail means hovered.

### Watch item behavior

- Watch unread items use the stronger unread rail token.
- `--rail-strong` should stay in the same hue family as `--rail`, but be deeper and more grounded rather than brighter or more saturated.
- The stronger rail should not be wider, glowing, red/orange, or alarm-like.
- When a watch unread item is hovered, its right hover rail should use the same stronger style as its left unread rail.

## CSS-level direction

Use box-shadow composition rather than adding new DOM elements:

- Unread left rail: `inset var(--hairline) 0 0 var(--rail, var(--accent))`.
- Hover right rail: `inset calc(-1 * var(--hairline)) 0 0 var(--rail, var(--accent))`.
- Unread + hover: combine both shadows in one declaration.
- Watch unread + hover: combine both shadows using `--rail-strong` fallback, where `--rail-strong` is a deeper same-hue emphasis token rather than a brighter accent.

## Color token guidance

The category tag palette already has the desired reading comfort: clear hue, low glare, dark-background legibility, and only a light 9% tinted backing. Accent and rail colors should move toward that same content-palette quality rather than feeling like generic system highlights.

- Keep the existing category colors unchanged.
- Tune each theme's `--accent` toward a softer, low-glare content signal color that sits comfortably beside the category palette.
- Update `--accent-soft` to match the tuned accent hue.
- Define `--rail` as the normal unread rail token, using the tuned accent/content-signal hue.
- Define `--rail-strong` per theme as a deeper, denser, calmer version of that theme's rail/accent hue; it should remain visible on dark backgrounds.
- Emphasis comes from tonal depth and density, not increased brightness, line width, glow, or warning colors.

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

- Visually confirm read hover shows only the right rail and no background or text brightening.
- Visually confirm unread hover keeps unread background and shows both left and right rails.
- Run existing tests after implementation: `node test.js` and `node test-notification.js`.



