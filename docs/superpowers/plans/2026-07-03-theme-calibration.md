# Theme Semantic Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved five-theme semantic calibration and shared popup UI refinements for AI HOT Notifier.

**Architecture:** Keep the implementation dependency-free and localized. Update static UI assertions first in `test-popup-ui.js`, then update CSS tokens and shared component styles in `popup.html`, synchronize first-paint theme backgrounds in `popup-boot.js` and `popup.js`, refresh README theme wording, bump the extension patch version, and package.

**Tech Stack:** Chrome Extension Manifest V3, native HTML/CSS/JavaScript, Node-based static test scripts, `bash pack.sh`.

---

## File Structure

- `test-popup-ui.js`: Static regression coverage for calibrated theme tokens, Hot rail behavior, subdued labels, and updated README wording.
- `popup.html`: Theme CSS variables and shared UI styles for list rows, labels, date badge, settings controls, and watch-rule cards.
- `popup-boot.js`: First-frame background map matching calibrated theme backgrounds.
- `popup.js`: Runtime theme background map matching calibrated theme backgrounds.
- `README.md`: User-facing theme count and theme-state wording.
- `manifest.json`: Patch version bump after implementation.

### Task 1: Static UI Tests for Theme Calibration

**Files:**
- Modify: `test-popup-ui.js`

- [ ] **Step 1: Replace old Dawn Mist and Slate Night token assertions with calibrated token assertions**

In `test-popup-ui.js`, update the `[晨雾/石青主题]` block so it asserts:

```js
assert(/'clear-light': '#f6f8fb'/.test(popupBootJs) && /'slate-night': '#0d1117'/.test(popupBootJs), 'boot 阶段同步校准后的晨雾和石青首帧背景');
assert(hasDeclaration(themeCssByName['clear-light'] || '', '--bg', '#f6f8fb'), '晨雾背景使用清晨雾白');
assert(hasDeclaration(themeCssByName['clear-light'] || '', '--bg-sub', '#ffffff'), '晨雾面板使用纸面白');
assert(hasDeclaration(themeCssByName['clear-light'] || '', '--bg-hover', '#edf3f8'), '晨雾 hover 使用浅蓝灰');
assert(hasDeclaration(themeCssByName['clear-light'] || '', '--border', '#d7e0ea'), '晨雾边框使用轻雪蓝灰');
assert(hasDeclaration(themeCssByName['clear-light'] || '', '--accent', '#5f86a8'), '晨雾交互强调使用沉稳霜蓝');
assert(hasDeclaration(themeCssByName['clear-light'] || '', '--bg-unread', '#edf5fb'), '晨雾未读背景使用淡雪蓝底色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--border', '#343b46'), '石青边框降低噪声');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-hover', '#1f2630'), '石青 hover 降低噪声');
```

Add calibrated assertions for the other three themes:

```js
assert(hasDeclaration(themeCssByName['dark'] || '', '--bg', '#101010'), '墨夜背景使用更稳深黑');
assert(hasDeclaration(themeCssByName['dark'] || '', '--accent', '#ff7a3d'), '墨夜热点强调更集中');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--bg', '#0f1411'), '暗森背景使用低刺激森黑');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--accent', '#8fbca8'), '暗森强调色转向柔和森绿');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--accent', '#8ab4f8'), '铬墨强调色贴近浏览器蓝');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--border', '#303641'), '铬墨边框使用稳定冷灰');
```

- [ ] **Step 2: Add static assertions for Hot rail and subdued labels**

Add assertions after the watch badge assertions:

```js
assert(/\.item\.unread\s*{[\s\S]*box-shadow:\s*inset 2px 0 0 color-mix\(in srgb, var\(--accent\) 62%, transparent\)/i.test(popupHtml), '未读条目使用 Hot rail 热度轨道');
assert(/\.item\.watch-item\.unread\s*{[\s\S]*box-shadow:\s*inset 2px 0 0 var\(--accent\)/i.test(popupHtml), '未读特关条目使用更明确的 Hot rail');
assert(/\.cat-tag\.cat-model\s*{[\s\S]*color-mix\(in srgb, var\(--cat-model\) 9%, transparent\)/i.test(popupHtml), '分类标签背景更克制');
assert(/\.date-label\s*{[\s\S]*background:\s*var\(--bg-sub\)/i.test(popupHtml), '日期浮标使用面板背景降低按钮感');
assert(/\.watch-rule-card\s*{[\s\S]*background:\s*color-mix\(in srgb, var\(--bg\) 76%, var\(--bg-sub\)\)/i.test(popupHtml), '特关规则卡片减少灰盒堆叠感');
```

- [ ] **Step 3: Add README assertion for five themes**

Add near the packaging/readme assertions:

```js
assert(/支持五套主题（墨夜\/暗森\/铬墨\/晨雾\/石青）/.test(readme), 'README 描述五套主题');
```

If `readme` is not currently loaded, add at the top:

```js
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
```

- [ ] **Step 4: Run UI test to verify RED**

Run:

```bash
node test-popup-ui.js
```

Expected: FAIL with assertions for calibrated tokens or Hot rail because production CSS has not been updated yet.

### Task 2: Calibrate Theme Tokens and First-Paint Backgrounds

**Files:**
- Modify: `popup.html`
- Modify: `popup-boot.js`
- Modify: `popup.js`

- [ ] **Step 1: Update `popup.html` theme CSS variables**

Update the five `[data-theme="..."]` blocks to these calibrated values while preserving existing variable names:

```css
[data-theme="dark"] {
  --color-scheme: dark;
  --bg: #101010;
  --bg-sub: #171717;
  --bg-hover: #202020;
  --bg-item-hover: #202020;
  --bg-unread: #171717;
  --border: #2a2a2a;
  --border-light: #222222;
  --text: #f2f2ee;
  --text-2: #b7b5ad;
  --text-3: #85837b;
  --text-unread: #f6f5ef;
  --text-unread-2: #c7c5bd;
  --text-unread-3: #96938b;
  --text-read: #77756e;
  --text-read-hover: #a5a29a;
  --accent: #ff7a3d;
  --accent-soft: rgba(255,122,61,0.10);
  --state-ok: #3ccf7a;
  --state-ok-soft: rgba(60,207,122,0.22);
  --state-ok-softer: rgba(60,207,122,0.12);
  --state-fail: #ef6461;
  --state-fail-soft: rgba(239,100,97,0.22);
  --state-fail-softer: rgba(239,100,97,0.12);
  --cat-model: #b39cff;
  --cat-products: #77b7ff;
  --cat-industry: #f2c45a;
  --cat-paper: #62d69f;
  --cat-tips: #ff8a82;
  --cat-default: #7f8389;
  --shadow: 0 1px 3px rgba(0,0,0,0.32);
}
```

Use equivalent calibrated blocks for `green-dark`, `chrome-dark`, `clear-light`, and `slate-night` following the approved spec token values, preserving `--hot` where already present for light/slate themes.

- [ ] **Step 2: Update first-paint background maps**

In both `popup-boot.js` and `popup.js`, set:

```js
const themeBackgrounds = {
  'dark': '#101010',
  'green-dark': '#0f1411',
  'chrome-dark': '#111317',
  'clear-light': '#f6f8fb',
  'slate-night': '#0d1117'
};
```

Keep `clear-light` as the only light `colorScheme`.

- [ ] **Step 3: Run UI test to verify token GREEN for theme assertions**

Run:

```bash
node test-popup-ui.js
```

Expected: remaining failures only in shared UI assertions if Task 3 is not implemented yet.

### Task 3: Shared Popup UI Refinements

**Files:**
- Modify: `popup.html`

- [ ] **Step 1: Update list Hot rail, label, date, and watch card CSS**

Apply these targeted CSS changes:

```css
.item.unread {
  background: var(--bg-unread);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 62%, transparent);
}

.item.watch-item.unread {
  box-shadow: inset 2px 0 0 var(--accent);
}

.cat-tag.cat-model { color: var(--cat-model); background: color-mix(in srgb, var(--cat-model) 9%, transparent); }
.cat-tag.cat-products { color: var(--cat-products); background: color-mix(in srgb, var(--cat-products) 9%, transparent); }
.cat-tag.cat-industry { color: var(--cat-industry); background: color-mix(in srgb, var(--cat-industry) 9%, transparent); }
.cat-tag.cat-paper { color: var(--cat-paper); background: color-mix(in srgb, var(--cat-paper) 9%, transparent); }
.cat-tag.cat-tips { color: var(--cat-tips); background: color-mix(in srgb, var(--cat-tips) 9%, transparent); }
.cat-tag.cat-default { color: var(--cat-default); background: color-mix(in srgb, var(--cat-default) 9%, transparent); }

.watch-badge {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.watch-rule-card {
  background: color-mix(in srgb, var(--bg) 76%, var(--bg-sub));
}
```

Keep existing layout properties, dimensions, and rule-card first-line behavior unchanged.

- [ ] **Step 2: Run UI test to verify GREEN**

Run:

```bash
node test-popup-ui.js
```

Expected: PASS.

### Task 4: Documentation and Version

**Files:**
- Modify: `README.md`
- Modify: `manifest.json`

- [ ] **Step 1: Update README theme description**

Replace:

```md
- 支持三套深色主题（墨夜/暗森/铬墨）
```

With:

```md
- 支持五套主题（墨夜/暗森/铬墨/晨雾/石青）
```

- [ ] **Step 2: Bump manifest version**

Change `manifest.json` version from `1.0.7` to `1.0.8`.

- [ ] **Step 3: Run UI test to verify docs/version side effects**

Run:

```bash
node test-popup-ui.js
```

Expected: PASS.

### Task 5: Full Verification and Packaging

**Files:**
- Generated: `aihot-notifier.zip`

- [ ] **Step 1: Run full test suite**

Run:

```bash
node test.js
node test-notification.js
node test-popup-ui.js
```

Expected: all PASS.

- [ ] **Step 2: Package extension**

Run:

```bash
bash pack.sh
```

Expected: `aihot-notifier.zip` is generated in the worktree root.

- [ ] **Step 3: Review diff hygiene**

Run:

```bash
git diff --check
git diff --stat
```

Expected: no whitespace errors; changed files are `test-popup-ui.js`, `popup.html`, `popup-boot.js`, `popup.js`, `README.md`, `manifest.json`, plan file, and generated package if the repo tracks it in this worktree.

## Self-Review

- Spec coverage: theme positioning maps to token changes; Hot rail, subdued labels, date badge, settings/watch-card polish, README wording, version bump, tests, and packaging are covered.
- Placeholder scan: no unresolved placeholder instructions remain.
- Type consistency: theme keys remain `dark`, `green-dark`, `chrome-dark`, `clear-light`, and `slate-night`; storage compatibility is preserved.
