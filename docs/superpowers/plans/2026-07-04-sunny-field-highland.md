# Sunny Field Sky Theme Implementation Note

> 历史主题方案：`clear-light` 已退役，当前主题见 [README](../../../README.md#功能)。本文仅用于追溯旧设计，不作为当前实施任务。

**Goal:** Replace the old `clear-light` Sunny Field theme with a cooler sky-blue/light-paper palette while preserving the theme key, display name, storage compatibility, and shared popup behavior.

**Outcome:** Implemented the sky-field direction. The palette reduces the previous green cast, uses blue-gray text and borders for long reading, keeps category colors distinct, and preserves the AI HOT orange only for hot-state emphasis.

## Files

- `popup.html` - updated `[data-theme="clear-light"]` tokens.
- `popup-boot.js` - synchronized the first-frame `clear-light` background.
- `popup.js` - synchronized the runtime `clear-light` background.
- `test-popup-ui.js` - updated static UI assertions for the new palette and background synchronization.

## Final `clear-light` Tokens

```css
--color-scheme: light;
--bg: #f7fbff;
--bg-sub: #fffefd;
--bg-hover: #eef6fb;
--bg-item-hover: #e7f0f6;
--bg-unread: #fbfdff;
--border: #d6e2ea;
--border-light: #e7eef3;
--text: #202833;
--text-2: #53606a;
--text-3: #68747c;
--text-unread: #1b2530;
--text-unread-2: #485763;
--text-unread-3: #62717a;
--text-read: #727c83;
--text-read-hover: #3f4d57;
--accent: #4f86a8;
--accent-soft: rgba(79,134,168,0.12);
--scrollbar: #cbd8e1;
--hot: #d86f2f;
--hot-soft: rgba(216,111,47,0.12);
--state-ok: #2f7d46;
--state-ok-soft: rgba(47,125,70,0.14);
--state-ok-softer: rgba(47,125,70,0.08);
--state-fail: #c2413a;
--state-fail-soft: rgba(194,65,58,0.14);
--state-fail-softer: rgba(194,65,58,0.08);
--cat-model: #6f65b7;
--cat-products: #3277a7;
--cat-industry: #996b24;
--cat-paper: #357a52;
--cat-tips: #a9573f;
--cat-default: #6b747b;
--shadow: 0 1px 2px rgba(32,40,51,0.07);
```

Both first-frame and runtime theme background maps use:

```js
'clear-light': '#f7fbff'
```

## Verification

- [x] `node test-popup-ui.js`
- [x] `node test.js`
- [x] `node test-notification.js`
- [x] `node test-background.js`

`node test-e2e.js` was not required for this change because no API URL, pagination, date-window, or feed assumptions changed.
