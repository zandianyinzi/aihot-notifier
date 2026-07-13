# Popup Hover Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace row-wide hover brightening in the popup tweet list with a right-side hover rail, tune theme accents toward the comfortable category palette, and preserve read/unread content tone.

**Architecture:** This is a CSS-first change in `popup.html`, guarded by static UI constraints in `test-popup-ui.js`. Theme tokens define the accent/rail palette; item state rules compose left and right `box-shadow` rails without JavaScript hover state.

**Tech Stack:** Manifest V3 Chrome/Edge extension, native HTML/CSS/JavaScript, Node-based test scripts, shell packaging via `pack.sh`.

---

## File Structure

- Modify `popup.html`
  - Theme token blocks (`[data-theme="dark"]`, `[data-theme="green-dark"]`, `[data-theme="chrome-dark"]`, `[data-theme="slate-night"]`) define tuned `--accent`, matching `--accent-soft`, and new `--rail` / `--rail-strong` tokens.
  - Item CSS rules remove background/text hover brightening and compose hover/read/watch rails.
- Modify `test-popup-ui.js`
  - Update static token assertions for new accent values and per-theme rail tokens.
  - Add assertions that hover uses right rail only, unread hover combines left/right rails, watch unread hover combines strong rails, and read hover text brightening is removed.
- Modify `manifest.json`
  - Bump version from the current release version to the next patch version, following repository release rules.
- Generated output `aihot-notifier.zip`
  - Recreated by `bash pack.sh` during release validation; do not commit the zip unless repository policy changes.

## Chosen Color Tokens

Use these exact values to keep accents close to the existing category palette's low-glare, readable quality:

| Theme | `--accent` / `--rail` | `--accent-soft` | `--rail-strong` | Rationale |
| --- | --- | --- | --- | --- |
| `dark` | `#d6a06f` | `rgba(214,160,111,0.12)` | `#b57a52` | Softer amber/copper; less warning-like than the current orange. |
| `green-dark` | `#8fb2b8` | `rgba(143,178,184,0.14)` | `#6f969d` | Preserve the already-comfortable grey-teal accent; add deeper strong rail. |
| `chrome-dark` | `#7daed2` | `rgba(125,174,210,0.14)` | `#5f8dac` | Mist blue; less generic system-blue, still readable on dark chrome. |
| `slate-night` | `#68aaa5` | `rgba(104,170,165,0.13)` | `#4d8782` | Calmer sea-glass teal; less bright than the current cyan-teal. |

---

### Task 1: Add failing UI constraints for hover rails and accent tokens

**Files:**
- Modify: `test-popup-ui.js:127-139`
- Modify: `test-popup-ui.js:157-172`
- Modify: `test-popup-ui.js:329-331`

- [ ] **Step 1: Update theme token structure assertions**

Replace the assertion at `test-popup-ui.js:138`:

```js
assert(!varNames.includes('--rail') && !varNames.includes('--rail-strong') && !varNames.includes('--rule-rail'), `${themeName} 主题不定义 rail 机制特例`);
```

with:

```js
assert(varNames.includes('--rail') && varNames.includes('--rail-strong'), `${themeName} 主题定义 rail 与 rail-strong 语义 token`);
assert(!varNames.includes('--rule-rail'), `${themeName} 主题不使用旧 rule-rail token`);
```

- [ ] **Step 2: Update exact accent expectations and add rail expectations**

Replace the accent assertions around `test-popup-ui.js:157-172` with the following block, preserving the surrounding theme assertions:

```js
assert(hasDeclaration(themeCssByName['dark'] || '', '--bg', '#101010'), '墨夜背景使用更稳深黑');
assert(hasDeclaration(themeCssByName['dark'] || '', '--accent', '#d6a06f'), '墨夜强调色使用低刺激杏铜');
assert(hasDeclaration(themeCssByName['dark'] || '', '--accent-soft', 'rgba(214,160,111,0.12)'), '墨夜强调轻染跟随杏铜');
assert(hasDeclaration(themeCssByName['dark'] || '', '--rail', '#d6a06f'), '墨夜普通 rail 使用舒适内容信号色');
assert(hasDeclaration(themeCssByName['dark'] || '', '--rail-strong', '#b57a52'), '墨夜 strong rail 使用更深沉同色系');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--bg', '#0c0f10'), '暗森背景使用更深邃的冷黑底色');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--border-light', '#2a3033'), '暗森轻边界更清晰且偏冷');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--accent', '#8fb2b8'), '暗森强调色保留舒服冷调蓝绿灰');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--rail', '#8fb2b8'), '暗森普通 rail 沿用冷调蓝绿灰');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--rail-strong', '#6f969d'), '暗森 strong rail 使用更深蓝绿灰');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--state-ok', '#8fbea8'), '暗森成功态与主题强调色轻微分离');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--accent', '#7daed2'), '铬墨强调色使用柔和雾蓝');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--accent-soft', 'rgba(125,174,210,0.14)'), '铬墨强调轻染跟随雾蓝');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--rail', '#7daed2'), '铬墨普通 rail 使用雾蓝内容信号色');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--rail-strong', '#5f8dac'), '铬墨 strong rail 使用更深雾蓝');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--border', '#303641'), '铬墨边框使用稳定冷灰');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--color-scheme', 'dark'), '石青使用 dark color-scheme');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg', '#0b1418'), '石青背景使用更独立的青黑底色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-sub', '#111c21'), '石青次级背景使用青黑面板色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-hover', '#19262c'), '石青 hover 保持低噪声青黑层级');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--text', '#f0f6fc'), '石青主文字保持高可读性');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--text-2', '#9da8b1'), '石青次级文字层级更清晰');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--border', '#2d3c43'), '石青边框使用青灰边界');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--accent', '#68aaa5'), '石青交互强调使用沉稳海玻璃青');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--accent-soft', 'rgba(104,170,165,0.13)'), '石青强调轻染跟随海玻璃青');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--rail', '#68aaa5'), '石青普通 rail 使用海玻璃内容信号色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--rail-strong', '#4d8782'), '石青 strong rail 使用更深海玻璃青');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--cat-products', '#5f9fd3'), '石青产品分类色降低硬蓝感');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--cat-paper', '#55aa72'), '石青论文分类色降低模板绿感');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--cat-tips', '#df6f68'), '石青观点分类色降低硬红感');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--hot', '#ff7a45'), '石青保留 AI HOT 签名热度色');
```

- [ ] **Step 3: Add hover rail assertions near the existing item rail assertions**

Insert this block before the current unread rail assertions at `test-popup-ui.js:329`:

```js
const itemHoverRule = popupHtml.match(/\.item:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemHoverRule, 'box-shadow', /inset calc\(-1 \* var\(--hairline\)\) 0 0 var\(--rail, var\(--accent\)\)/), '条目 hover 只使用右侧 rail 表示鼠标位置');
assert(!/background\s*:/.test(itemHoverRule), '条目 hover 不再改变背景');

const itemUnreadHoverRule = popupHtml.match(/\.item\.unread:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemUnreadHoverRule, 'background', /var\(--bg-unread\)/), '未读条目 hover 保持未读背景');
assert(/box-shadow\s*:\s*inset var\(--hairline\) 0 0 var\(--rail, var\(--accent\)\),\s*inset calc\(-1 \* var\(--hairline\)\) 0 0 var\(--rail, var\(--accent\)\)/i.test(itemUnreadHoverRule), '未读条目 hover 同时显示左侧未读 rail 与右侧 hover rail');

const watchUnreadHoverRule = popupHtml.match(/\.item\.watch-item\.unread:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(/box-shadow\s*:\s*inset var\(--hairline\) 0 0 var\(--rail-strong, var\(--accent\)\),\s*inset calc\(-1 \* var\(--hairline\)\) 0 0 var\(--rail-strong, var\(--accent\)\)/i.test(watchUnreadHoverRule), '特关未读 hover 左右两侧都使用 strong rail');

assert(!/\.item\.read:hover \.item-title,\s*\.item\.read:hover \.item-summary,\s*\.item\.read:hover \.item-meta\s*{/i.test(popupHtml), '已读条目 hover 不再提亮标题摘要与元信息');
```

- [ ] **Step 4: Run the UI test and verify it fails for the new constraints**

Run:

```powershell
node test-popup-ui.js
```

Expected: FAIL. The failure output should include some of these messages because implementation has not happened yet:

```text
✗ dark 主题定义 rail 与 rail-strong 语义 token
✗ 墨夜强调色使用低刺激杏铜
✗ 条目 hover 只使用右侧 rail 表示鼠标位置
✗ 条目 hover 不再改变背景
✗ 已读条目 hover 不再提亮标题摘要与元信息
```

- [ ] **Step 5: Commit the failing test**

```powershell
git add test-popup-ui.js
git commit -m "test: cover popup hover rail design"
```

---

### Task 2: Implement theme accent and rail tokens

**Files:**
- Modify: `popup.html:8-162`

- [ ] **Step 1: Update the `dark` theme tokens**

In `[data-theme="dark"]`, replace the current accent block:

```css
      --accent: #ecb07f;
      --accent-soft: rgba(236,176,127,0.12);
```

with:

```css
      --accent: #d6a06f;
      --accent-soft: rgba(214,160,111,0.12);
      --rail: #d6a06f;
      --rail-strong: #b57a52;
```

- [ ] **Step 2: Update the `green-dark` theme tokens**

In `[data-theme="green-dark"]`, replace the current accent block:

```css
      --accent: #8fb2b8;
      --accent-soft: rgba(143,178,184,0.14);
```

with:

```css
      --accent: #8fb2b8;
      --accent-soft: rgba(143,178,184,0.14);
      --rail: #8fb2b8;
      --rail-strong: #6f969d;
```

- [ ] **Step 3: Update the `chrome-dark` theme tokens**

In `[data-theme="chrome-dark"]`, replace the current accent block:

```css
      --accent: #67a8dc;
      --accent-soft: rgba(103,168,220,0.14);
```

with:

```css
      --accent: #7daed2;
      --accent-soft: rgba(125,174,210,0.14);
      --rail: #7daed2;
      --rail-strong: #5f8dac;
```

- [ ] **Step 4: Update the `slate-night` theme tokens**

In `[data-theme="slate-night"]`, replace the current accent block:

```css
      --accent: #4bb6af;
      --accent-soft: rgba(75,182,175,0.13);
```

with:

```css
      --accent: #68aaa5;
      --accent-soft: rgba(104,170,165,0.13);
      --rail: #68aaa5;
      --rail-strong: #4d8782;
```

- [ ] **Step 5: Run the UI test and verify token assertions now pass but hover assertions still fail**

Run:

```powershell
node test-popup-ui.js
```

Expected: FAIL remains, but accent/rail-token failures should be gone. Remaining failures should focus on item hover CSS.

- [ ] **Step 6: Commit token implementation**

```powershell
git add popup.html
git commit -m "style: tune popup accent and rail tokens"
```

---

### Task 3: Implement right-side hover rail and stable content tone

**Files:**
- Modify: `popup.html:950-1060`

- [ ] **Step 1: Replace item state CSS rules**

Replace the current block from `.item {` through the `.item.read:hover ...` rule:

```css
    .item {
      display: flex;
      align-items: flex-start;
      padding: var(--item-pad, 12px) 18px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      transition: background 0.12s ease;
    }

    .item:last-child { border-bottom: none; }

    .item:hover {
      background: var(--bg-item-hover, var(--bg-hover));
    }

    .item.unread {
      background: var(--bg-unread);
      box-shadow: inset var(--hairline) 0 0 var(--rail, var(--accent));
    }

    .item.unread:hover {
      background: var(--bg-item-hover, var(--bg-hover));
    }

    .item.watch-item.unread {
      box-shadow: inset var(--hairline) 0 0 var(--rail-strong, var(--accent));
    }

    .item.read .item-title {
      color: var(--text-read);
    }

    .item.read .item-meta {
      color: var(--text-read);
    }

    .item.read .cat-tag {
      opacity: 0.45;
    }
```

with:

```css
    .item {
      display: flex;
      align-items: flex-start;
      padding: var(--item-pad, 12px) 18px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
    }

    .item:last-child { border-bottom: none; }

    .item:hover {
      box-shadow: inset calc(-1 * var(--hairline)) 0 0 var(--rail, var(--accent));
    }

    .item.unread {
      background: var(--bg-unread);
      box-shadow: inset var(--hairline) 0 0 var(--rail, var(--accent));
    }

    .item.unread:hover {
      background: var(--bg-unread);
      box-shadow:
        inset var(--hairline) 0 0 var(--rail, var(--accent)),
        inset calc(-1 * var(--hairline)) 0 0 var(--rail, var(--accent));
    }

    .item.watch-item.unread {
      box-shadow: inset var(--hairline) 0 0 var(--rail-strong, var(--accent));
    }

    .item.watch-item.unread:hover {
      box-shadow:
        inset var(--hairline) 0 0 var(--rail-strong, var(--accent)),
        inset calc(-1 * var(--hairline)) 0 0 var(--rail-strong, var(--accent));
    }

    .item.read .item-title {
      color: var(--text-read);
    }

    .item.read .item-meta {
      color: var(--text-read);
    }

    .item.read .cat-tag {
      opacity: 0.45;
    }
```

- [ ] **Step 2: Remove read hover text brightening**

Delete this block from `popup.html`:

```css
    .item.read:hover .item-title,
    .item.read:hover .item-summary,
    .item.read:hover .item-meta {
      color: var(--text-read-hover, var(--text-read));
    }
```

Do not remove the `--text-read-hover` tokens in this task; keeping unused theme tokens avoids broad token-structure churn.

- [ ] **Step 3: Run UI test and verify it passes**

Run:

```powershell
node test-popup-ui.js
```

Expected: PASS, ending with zero failed assertions.

- [ ] **Step 4: Commit hover implementation**

```powershell
git add popup.html test-popup-ui.js
git commit -m "style: replace popup hover highlight with rail"
```

---

### Task 4: Run repository regression tests

**Files:**
- No source changes expected.

- [ ] **Step 1: Run core logic tests**

Run:

```powershell
node test.js
```

Expected: PASS with zero failed assertions.

- [ ] **Step 2: Run notification tests**

Run:

```powershell
node test-notification.js
```

Expected: PASS with zero failed assertions.

- [ ] **Step 3: Run popup UI static tests again**

Run:

```powershell
node test-popup-ui.js
```

Expected: PASS with zero failed assertions.

- [ ] **Step 4: Check git status**

Run:

```powershell
git status --short
```

Expected: no unexpected source changes. It is acceptable for untracked local artifacts that existed before the task, such as `.superpowers/`, `github-theme-preview.html`, or `aihot-notifier.zip`, to remain uncommitted.

---

### Task 5: Bump extension version and package

**Files:**
- Modify: `manifest.json`
- Generated: `aihot-notifier.zip`

- [ ] **Step 1: Inspect current manifest version**

Run:

```powershell
Get-Content -Raw manifest.json
```

Expected: JSON containing the current `"version"`. If it is still `"1.0.7"`, bump to `"1.0.8"`; if another patch version is present, increment the patch version by one.

- [ ] **Step 2: Bump the manifest version**

If current version is `1.0.7`, replace:

```json
  "version": "1.0.7",
```

with:

```json
  "version": "1.0.8",
```

- [ ] **Step 3: Run required tests after the version bump**

Run:

```powershell
node test.js
node test-notification.js
node test-popup-ui.js
```

Expected: all three commands pass with zero failed assertions.

- [ ] **Step 4: Package the extension**

Run:

```powershell
bash pack.sh
```

Expected: `aihot-notifier.zip` is regenerated successfully. The zip should remain uncommitted unless repository policy explicitly asks to commit generated distribution artifacts.

- [ ] **Step 5: Commit the version bump**

```powershell
git add manifest.json
git commit -m "chore: bump version for hover rail polish"
```

---

### Task 6: Final audit

**Files:**
- No source changes expected unless an audit issue is found.

- [ ] **Step 1: Review committed diff**

Run:

```powershell
git log --oneline -6
git diff HEAD~4..HEAD -- popup.html test-popup-ui.js manifest.json docs/superpowers/specs/2026-07-10-popup-list-hover-rail-design.md
```

Expected: the diff only includes the approved spec, tests, CSS token/rule changes, and manifest version bump.

- [ ] **Step 2: Verify final test evidence**

Run:

```powershell
node test.js
node test-notification.js
node test-popup-ui.js
```

Expected: all pass.

- [ ] **Step 3: Report summary**

Prepare a short completion summary including:

```text
Summary:
- Tuned four theme accents/rail tokens toward the comfortable category palette.
- Replaced item background/text hover brightening with a right-side hover rail.
- Added static UI tests for rail semantics and accent tokens.
- Bumped manifest version and regenerated package.

Tests:
- node test.js
- node test-notification.js
- node test-popup-ui.js
- bash pack.sh
```
