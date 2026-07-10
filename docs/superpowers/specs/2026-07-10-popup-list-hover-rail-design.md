# Popup List Hover Rail Design

Date: 2026-07-10

## Context

The popup tweet list currently uses the same background highlight for both read and unread items on hover. This makes read and unread items feel visually similar while the pointer is over them, weakening the distinction between item state and pointer focus.

## Goal

Separate visual meanings:

- Left rail: unread state.
- Right rail: current hover position.
- No background brightening on hover for either read or unread items.

## Design

### Item background

- Remove the shared hover background highlight from list items.
- Read items keep their normal background on hover.
- Unread items keep `--bg-unread` on hover.

### Rail semantics

- Unread items keep the existing left rail style.
- Hovered items show a right rail using the same visual language as the unread rail.
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

- Define `--rail` as the normal unread rail token, falling back to `--accent` if needed.
- Define `--rail-strong` per theme as a deeper, calmer version of that theme's rail/accent hue.
- Emphasis comes from tonal depth, not increased brightness, line width, glow, or warning colors.

## Non-goals

- Do not change item layout, spacing, click behavior, read/unread state logic, or storage behavior.
- Do not introduce new dependencies or JavaScript state for hover.
- Do not change the settings panel behavior.

## Validation

- Visually confirm read hover shows only the right rail and no background brightening.
- Visually confirm unread hover keeps unread background and shows both left and right rails.
- Run existing tests after implementation: `node test.js` and `node test-notification.js`.

