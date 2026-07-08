/**
 * Popup UI 静态约束测试
 * 运行: node test-popup-ui.js
 */

const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function hasDeclaration(css, property, valuePattern) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = valuePattern instanceof RegExp
    ? valuePattern.source
    : valuePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*${value}\\s*(?:;|$)`, 'i').test(css);
}

function readDeclaration(css, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() || '';
}

function parseHexColor(value) {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const intValue = parseInt(match[1], 16);
  return [(intValue >> 16) & 255, (intValue >> 8) & 255, intValue & 255];
}

function relativeLuminance(rgb) {
  const channel = value => {
    value /= 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(foreground, background) {
  const foregroundRgb = parseHexColor(foreground);
  const backgroundRgb = parseHexColor(background);
  if (!foregroundRgb || !backgroundRgb) return 0;
  const foregroundLum = relativeLuminance(foregroundRgb);
  const backgroundLum = relativeLuminance(backgroundRgb);
  const lighter = Math.max(foregroundLum, backgroundLum);
  const darker = Math.min(foregroundLum, backgroundLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertThemeTokenContrast(themeName, tokenName, backgroundNames, minimumRatio) {
  const themeCss = themeCssByName[themeName] || '';
  const foreground = readDeclaration(themeCss, tokenName);
  const failing = backgroundNames.filter(backgroundName => {
    const background = readDeclaration(themeCss, backgroundName);
    return contrastRatio(foreground, background) < minimumRatio;
  });
  assert(
    failing.length === 0,
    `${themeName} ${tokenName} 在小字号常用背景上的对比度不低于 ${minimumRatio}:1`
  );
}

const popupHtml = fs.readFileSync('popup.html', 'utf8');
const popupLogJs = fs.readFileSync('popup-log.js', 'utf8');
const popupJs = fs.readFileSync('popup.js', 'utf8');
const popupBootJs = fs.readFileSync('popup-boot.js', 'utf8');
const packSh = fs.readFileSync('pack.sh', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const screenshotMjs = fs.readFileSync('screenshot.mjs', 'utf8');
const storeNotes = fs.readFileSync('store/chrome-web-store-notes.md', 'utf8');
const storeDescriptionZh = fs.readFileSync('store/description_zh.txt', 'utf8');
const storeDescriptionEn = fs.readFileSync('store/description_en.txt', 'utf8');
const htmlTag = popupHtml.match(/<html\b[^>]*>/i)?.[0] || '';
const htmlStyle = htmlTag.match(/\sstyle="([^"]*)"/i)?.[1] || '';
const bodyTag = popupHtml.match(/<body\b[^>]*>/i)?.[0] || '';
const bodyStyle = bodyTag.match(/\sstyle="([^"]*)"/i)?.[1] || '';
const viewportRule = popupHtml.match(/html,\s*body\s*{([\s\S]*?)}/i)?.[1] || '';
const bodyRule = popupHtml.match(/\n\s*body\s*{([\s\S]*?)}/i)?.[1] || '';
const rootRule = popupHtml.match(/:root\s*{([\s\S]*?)}/i)?.[1] || '';
const themeRules = [...popupHtml.matchAll(/\[data-theme="([^"]+)"\]\s*{([\s\S]*?)}/g)];

console.log('\n[popup首帧尺寸与背景]');
assert(/<meta\s+name="color-scheme"\s+content="dark"\s*>/i.test(popupHtml), '声明深色 color-scheme，避免首帧默认白色画布');
assert(hasDeclaration(htmlStyle, 'width', '420px'), 'html 根节点内联声明首帧宽度');
assert(hasDeclaration(htmlStyle, 'min-width', '420px'), 'html 根节点内联声明最小宽度');
assert(hasDeclaration(htmlStyle, 'height', '600px'), 'html 根节点内联声明首帧高度');
assert(hasDeclaration(htmlStyle, 'min-height', '600px'), 'html 根节点内联声明最小高度');
assert(hasDeclaration(htmlStyle, 'background', '#101010'), 'html 根节点背景硬编码暗色，无需等待 CSS 变量解析');
assert(hasDeclaration(htmlStyle, 'color-scheme', 'dark'), 'html 根节点 color-scheme 硬编码，无需等待 CSS 变量解析');

assert(hasDeclaration(bodyStyle, 'width', '420px'), 'body 内联声明首帧宽度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'min-width', '420px'), 'body 内联声明最小宽度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'height', '600px'), 'body 内联声明首帧高度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'min-height', '600px'), 'body 内联声明最小高度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'background', /var\(--bg,\s*#101010\)/), 'body 内联背景直接依赖主题变量并带兜底');
assert(hasDeclaration(bodyStyle, 'color-scheme', /var\(--color-scheme,\s*dark\)/), 'body 内联 color-scheme 直接依赖主题变量并带兜底');

assert(Boolean(viewportRule), '存在 html, body 共享视口规则');
assert(hasDeclaration(viewportRule, 'width', '420px'), 'html/body 共享规则固定宽度');
assert(hasDeclaration(viewportRule, 'min-width', '420px'), 'html/body 共享规则固定最小宽度');
assert(hasDeclaration(viewportRule, 'height', '600px'), 'html/body 共享规则固定高度');
assert(hasDeclaration(viewportRule, 'min-height', '600px'), 'html/body 共享规则固定最小高度');
assert(hasDeclaration(viewportRule, 'background', '#101010'), 'html/body 早期共享规则硬编码背景色，确保首帧正确');
assert(hasDeclaration(viewportRule, 'color-scheme', 'dark'), 'html/body 早期共享规则硬编码 color-scheme');
assert(!/box-shadow\s*:/.test(bodyRule), '主窗口不额外绘制应用内外框，回到滚动条隐藏前的边界体系');
assert(!/border\s*:\s*1px\s+solid\s+var\(--window-edge\)/i.test(bodyRule), '主窗口不使用 window-edge 真实 border');
assert(!/--window-edge\s*:/.test(rootRule), '全局不保留 window-edge token，避免边框体系分叉');
assert(!/--window-edge-highlight\s*:/.test(rootRule), '全局不保留 window-edge-highlight token');
assert(hasDeclaration(rootRule, '--hairline', '0.5px'), '全局 hairline token 使用 0.5px');

assert(themeRules.length >= 3, '存在主题 CSS 变量规则');
for (const [_, themeName, themeCss] of themeRules) {
  assert(hasDeclaration(themeCss, '--bg', /#[0-9a-f]{6}|rgba?\([^)]+\)/), `${themeName} 主题声明 --bg`);
  assert(hasDeclaration(themeCss, '--color-scheme', /dark|light/), `${themeName} 主题声明 --color-scheme`);
}

const themeVarNamesByTheme = Object.fromEntries(themeRules.map(([, themeName, themeCss]) => {
  const varNames = [...themeCss.matchAll(/--[a-z0-9-]+\s*:/gi)]
    .map(match => match[0].replace(/\s*:\s*$/, ''))
    .sort();
  return [themeName, varNames];
}));
const canonicalThemeVars = themeVarNamesByTheme.dark || [];
for (const [themeName, varNames] of Object.entries(themeVarNamesByTheme)) {
  const missing = canonicalThemeVars.filter(name => !varNames.includes(name));
  const extra = varNames.filter(name => !canonicalThemeVars.includes(name));
  assert(missing.length === 0 && extra.length === 0, `${themeName} 主题 token 结构与墨夜一致`);
  assert(!varNames.includes('--rail') && !varNames.includes('--rail-strong') && !varNames.includes('--rule-rail'), `${themeName} 主题不定义 rail 机制特例`);
}


console.log('\n[主题列表/石青主题]');
const themeSelectHtml = popupHtml.match(/<select class="select-mini" id="theme">([\s\S]*?)<\/select>/)?.[1] || '';
const themeCssByName = Object.fromEntries(themeRules.map(([, name, css]) => [name, css]));
assert(!/<option value="clear-light">晴野<\/option>/.test(themeSelectHtml), '外观主题下拉不再包含晴野');
assert(/<option value="slate-night">石青<\/option>/.test(themeSelectHtml), '外观主题下拉包含石青，且不使用 GitHub 命名');
assert(!/github/i.test(themeSelectHtml), '主题显示名与 value 均不出现 GitHub');
assert(!/\[data-theme="clear-light"\]/.test(popupHtml), '样式表不再定义晴野主题');
assert(!/clear-light/.test(themeSelectHtml), '主题下拉不再暴露 clear-light value');
assert(/const VALID_THEMES = new Set\(\['dark', 'green-dark', 'chrome-dark', 'slate-night'\]\)/.test(popupJs), 'JS 主题白名单只接受四套保留主题');
assert(/\['dark', 'green-dark', 'chrome-dark', 'slate-night'\]\.includes\(theme\)/.test(popupBootJs), 'boot 阶段主题白名单只接受四套保留主题');
assert(!/'clear-light':/.test(popupBootJs), 'boot 阶段背景映射不再包含晴野');
assert(!/'clear-light':/.test(popupJs), '运行时背景映射不再包含晴野');
assert(!/theme\s*===\s*'clear-light'/.test(popupBootJs), 'boot 阶段不再按晴野切换 light color-scheme');
assert(!/theme\s*===\s*'clear-light'/.test(popupJs), '运行时不再按晴野切换 light color-scheme');
assert(!themeCssByName['clear-light'], '主题 token 不再包含晴野');
assert(hasDeclaration(themeCssByName['dark'] || '', '--bg', '#101010'), '墨夜背景使用更稳深黑');
assert(hasDeclaration(themeCssByName['dark'] || '', '--accent', '#ecb07f'), '墨夜强调色使用克制暖铜');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--bg', '#0c0f10'), '暗森背景使用更深邃的冷黑底色');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--border-light', '#2a3033'), '暗森轻边界更清晰且偏冷');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--accent', '#8fb2b8'), '暗森强调色使用冷调蓝绿灰');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--state-ok', '#8fbea8'), '暗森成功态与主题强调色轻微分离');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--accent', '#67a8dc'), '铬墨强调色使用克制工具蓝');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--border', '#303641'), '铬墨边框使用稳定冷灰');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--color-scheme', 'dark'), '石青使用 dark color-scheme');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg', '#0b1418'), '石青背景使用更独立的青黑底色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-sub', '#111c21'), '石青次级背景使用青黑面板色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-hover', '#19262c'), '石青 hover 保持低噪声青黑层级');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--text', '#f0f6fc'), '石青主文字保持高可读性');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--text-2', '#9da8b1'), '石青次级文字层级更清晰');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--border', '#2d3c43'), '石青边框使用青灰边界');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--accent', '#4bb6af'), '石青交互强调使用收敛石青青蓝');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--cat-products', '#5f9fd3'), '石青产品分类色降低硬蓝感');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--cat-paper', '#55aa72'), '石青论文分类色降低模板绿感');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--cat-tips', '#df6f68'), '石青观点分类色降低硬红感');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--hot', '#ff7a45'), '石青保留 AI HOT 签名热度色');

console.log('\n[主题辅助文字对比度]');
const compactTextBackgrounds = ['--bg', '--bg-sub', '--bg-hover', '--bg-unread'];
for (const themeName of Object.keys(themeCssByName)) {
  assertThemeTokenContrast(themeName, '--text-3', compactTextBackgrounds, 4.5);
  assertThemeTokenContrast(themeName, '--text-unread-3', compactTextBackgrounds, 4.5);
  assertThemeTokenContrast(themeName, '--text-read', ['--bg', '--bg-hover'], 4.5);
  assertThemeTokenContrast(themeName, '--cat-default', compactTextBackgrounds, 4.5);
}

console.log('\n[简约设置分组]');
assert(/<details class="setting-group" data-setting-group="general">[\s\S]*?<summary class="setting-group-title">常规<\/summary>[\s\S]*?id="enabled"[\s\S]*?id="interval"[\s\S]*?id="feedMode"[\s\S]*?id="historyDays"[\s\S]*?id="openPositionMode"[\s\S]*?<\/details>/.test(popupHtml), '常规分组默认收起并包含推送、频率、内容源、显示天数、定位');
assert(/<details class="setting-group" data-setting-group="appearance">[\s\S]*?<summary class="setting-group-title">外观<\/summary>[\s\S]*?id="theme"[\s\S]*?id="fontFamily"[\s\S]*?id="fontSize"[\s\S]*?<\/details>/.test(popupHtml), '外观分组默认收起且只包含视觉设置');
assert(/<details class="setting-group watch-settings" data-setting-group="watch">[\s\S]*?<summary class="setting-group-title">特关<\/summary>[\s\S]*?id="watchRulesList"/.test(popupHtml), '特关分组默认收起并包含规则列表');
assert(/<details class="setting-group setting-group-debug" data-setting-group="debug">[\s\S]*?<summary class="setting-group-title">调试<\/summary>[\s\S]*?id="copyLogs"[\s\S]*?拷贝/.test(popupHtml), '调试入口位于独立分组并使用拷贝文案');
assert(/settingGroups\.forEach\(group => \{[\s\S]*?group\.addEventListener\('toggle'/.test(popupJs), '设置分组支持互斥展开');
assert(/group\.dataset\.settingGroup\s*===\s*'watch'[\s\S]*requestAnimationFrame\(updateWatchRulesScrollHint\)/.test(popupJs), '首次展开特关分组后重新计算规则列表渐隐状态');
const settingsInnerRule = popupHtml.match(/\.settings-inner\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingsInnerRule, 'gap', '4px'), '设置面板折叠列表使用紧凑 4px 组间距');
assert(hasDeclaration(settingsInnerRule, 'max-height', '420px'), '设置面板内滚动区与外层上限一致，避免盒模型提前截短');
assert(hasDeclaration(settingsInnerRule, 'scrollbar-width', 'none'), '设置面板隐藏 Firefox 滚动条但保留滚动');
assert(hasDeclaration(settingsInnerRule, '-ms-overflow-style', 'none'), '设置面板隐藏旧 Edge 滚动条但保留滚动');
const settingsInnerScrollbarRule = popupHtml.match(/\.settings-inner::-webkit-scrollbar\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingsInnerScrollbarRule, 'width', '0'), '设置面板隐藏 Chrome 滚动条宽度');
assert(hasDeclaration(settingsInnerScrollbarRule, 'height', '0'), '设置面板隐藏 Chrome 横向滚动条高度');
const settingsInnerTailRule = popupHtml.match(/\.settings-inner\.has-scroll-tail\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingsInnerTailRule, '-webkit-mask-image', /linear-gradient\(to bottom,\s*#000\s+calc\(100%\s*-\s*32px\),\s*rgba\(0,\s*0,\s*0,\s*0\.35\)\s+calc\(100%\s*-\s*12px\),\s*transparent\)/), '设置面板未滚到底时使用底部渐隐提示');
assert(hasDeclaration(settingsInnerTailRule, 'mask-image', /linear-gradient\(to bottom,\s*#000\s+calc\(100%\s*-\s*32px\),\s*rgba\(0,\s*0,\s*0,\s*0\.35\)\s+calc\(100%\s*-\s*12px\),\s*transparent\)/), '设置面板底部渐隐兼容标准 mask');
assert(/function\s+updateSettingsScrollHint\(\)/.test(popupJs), '设置面板具备底部渐隐状态更新函数');
assert(/settingsInnerEl\.classList\.toggle\('has-scroll-tail',\s*hasScrollTail\)/.test(popupJs), '设置面板按滚动位置切换渐隐 class');
assert(/settingsInnerEl\.addEventListener\('scroll',\s*updateSettingsScrollHint,\s*\{\s*passive:\s*true\s*}\)/.test(popupJs), '设置面板滚动时刷新渐隐状态');
assert(/requestAnimationFrame\(updateSettingsScrollHint\)/.test(popupJs), '设置面板布局变化后下一帧重新计算渐隐状态');
const settingGroupRule = popupHtml.match(/\.setting-group\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupRule, 'gap', '0'), '设置分组折叠态不引入额外 gap');
assert(hasDeclaration(settingGroupRule, 'padding-top', '0'), '设置分组自身不再用顶部 padding 撑高折叠态');
const settingGroupSiblingRule = popupHtml.match(/\.setting-group \+ \.setting-group\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupSiblingRule, 'border-top', '0'), '设置分组之间不再使用可见分割线');
assert(hasDeclaration(settingGroupSiblingRule, 'padding-top', '0'), '设置分组之间不再额外撑高折叠态');
const settingGroupTitleRule = popupHtml.match(/\.setting-group-title\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupTitleRule, 'height', '38px'), '设置分组标题固定 38px 高度');
assert(hasDeclaration(settingGroupTitleRule, 'padding', '0'), '设置分组标题不使用垂直 padding 干扰居中');
assert(hasDeclaration(settingGroupTitleRule, 'color', /var\(--text-2\)/), '所有分组标题使用次级灰阶');
assert(hasDeclaration(settingGroupTitleRule, 'font-weight', '500'), '分组标题保持较轻的中等字重');
const settingGroupTitleHoverRule = popupHtml.match(/\.setting-group-title:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupTitleHoverRule, 'color', /var\(--accent\)/), '分组标题 hover 使用主题色文字');
assert(hasDeclaration(settingGroupTitleHoverRule, 'background', /transparent/), '分组标题 hover 不改变背景');
const settingGroupOpenHoverRule = popupHtml.match(/\.setting-group\[open\] > \.setting-group-title:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupOpenHoverRule, 'color', /var\(--accent\)/), '展开态标题 hover 仍使用主题色文字');
assert(hasDeclaration(settingGroupOpenHoverRule, 'background', /transparent/), '展开态标题 hover 也不改变背景');
const settingGroupOpenRule = popupHtml.match(/\.setting-group\[open\] > \.setting-group-title\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupOpenRule, 'color', /var\(--accent\)/), '展开态标题保持常驻主题色');
const settingsOpenRule = popupHtml.match(/\.settings\.open\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingsOpenRule, 'max-height', '420px'), '设置面板展开高度保留列表上下文并优先保障设置操作');
assert(!hasDeclaration(settingsOpenRule, 'max-height', '600px'), '设置面板展开不占满整个弹窗高度');
const settingGroupBodyRule = popupHtml.match(/\.setting-group-body\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingGroupBodyRule, 'margin', /4px\s+0\s+12px/), '展开内容区与固定标题行分离设置间距');
const settingRowRule = popupHtml.match(/\.setting-row\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(settingRowRule, 'min-height', '28px'), '设置行使用稳定最小高度对齐开关与下拉控件');
assert(/\.btn-mini\s*{/.test(popupHtml), '设置面板文字按钮使用统一 btn-mini 基类');
assert(!/\.btn-mini\.is-result-ok\s*{/.test(popupHtml), '拷贝按钮不使用额外成功态样式，保持整体按钮风格一致');
const btnMiniHoverRule = popupHtml.match(/\.btn-mini:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(btnMiniHoverRule, 'background', /var\(--accent-soft\)/), '文字按钮悬停使用统一主题色轻染背景');
assert(hasDeclaration(btnMiniHoverRule, 'color', /var\(--accent\)/), '文字按钮悬停使用主题色文字');
assert(/border-color\s*:\s*color-mix\(in srgb, var\(--accent\) 35%, var\(--border\)\)/.test(btnMiniHoverRule), '文字按钮悬停使用轻量主题色边框');
const selectMiniRule = popupHtml.match(/\.select-mini\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(selectMiniRule, 'padding', /5px\s+8px/), '下拉控件尺寸与文字按钮对齐');
assert(hasDeclaration(selectMiniRule, 'border-radius', '5px'), '下拉控件圆角与文字按钮对齐');
const selectMiniHoverRule = popupHtml.match(/\.select-mini:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(selectMiniHoverRule, 'background', /var\(--bg\)/), '下拉控件悬停不改变背景色');
assert(hasDeclaration(selectMiniHoverRule, 'color', /var\(--accent\)/), '下拉控件悬停使用主题色文字');
assert(/border-color\s*:\s*color-mix\(in srgb, var\(--accent\) 35%, var\(--border\)\)/.test(selectMiniHoverRule), '下拉控件悬停使用轻量主题色边框');
assert(/class="btn-mini watch-add-btn" id="addWatchRule"/.test(popupHtml), '添加按钮使用统一文字按钮基类');
assert(/class="btn-mini watch-rule-btn"/.test(popupJs), '规则操作按钮使用统一文字按钮基类');

console.log('\n[右上角按钮布局]');
const actionsRule = popupHtml.match(/\.actions\s*{([\s\S]*?)}/i)?.[1] || '';
const btnIconRule = popupHtml.match(/\.btn-icon\s*{([\s\S]*?)}/i)?.[1] || '';
const btnIconHoverRule = popupHtml.match(/\.btn-icon:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(actionsRule, 'justify-content', 'flex-end'), '右上角按钮靠右排列');
assert(hasDeclaration(actionsRule, 'flex', /0\s+0\s+auto/), '右上角按钮组不被压缩');
assert(hasDeclaration(actionsRule, 'gap', '6px'), '右上角按钮保持间距');
assert(hasDeclaration(btnIconRule, 'flex', /0\s+0\s+var\(--control-size\)/), '单个按钮固定占位，避免叠加');
assert(hasDeclaration(btnIconHoverRule, 'background', /var\(--accent-soft\)/), '右上角按钮悬停使用统一主题色轻染背景');
assert(hasDeclaration(btnIconHoverRule, 'color', /var\(--accent\)/), '右上角按钮悬停使用主题色图标');

console.log('\n[主列表滚动]');
const mainListRule = popupHtml.match(/\.list\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(mainListRule, 'overflow-y', 'auto'), '主列表保留纵向滚动');
assert(hasDeclaration(mainListRule, 'scrollbar-width', 'none'), '主列表隐藏 Firefox 滚动条但保留滚动');
assert(hasDeclaration(mainListRule, '-ms-overflow-style', 'none'), '主列表隐藏旧 Edge 滚动条但保留滚动');
const mainListScrollbarRule = popupHtml.match(/\.list::-webkit-scrollbar\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(mainListScrollbarRule, 'width', '0'), '主列表隐藏 Chrome 滚动条宽度');
assert(hasDeclaration(mainListScrollbarRule, 'height', '0'), '主列表隐藏 Chrome 横向滚动条高度');

console.log('\n[特关UI]');
assert(!/id="watchSection"/.test(popupHtml), '不再使用重复的特关顶部区域');
assert(!/id="watchList"/.test(popupHtml), '不再使用独立特关列表容器');
assert(/id="watchRulesList"/.test(popupHtml), '存在特关规则列表');
assert(!/暂无特关规则/.test(popupJs), '无特关规则时不显示空态提示文案');
assert(/watchRulesList\.innerHTML\s*=\s*''/.test(popupJs), '无特关规则时规则列表保持空内容');
assert(/id="watchSource"/.test(popupHtml), '存在来源输入框');
assert(/id="watchAuthor"/.test(popupHtml), '存在作者输入框');
  assert(/id="watchSource"\s+placeholder="来源"/.test(popupHtml), '来源输入框使用简洁占位文案');
  assert(/id="watchAuthor"\s+placeholder="作者"/.test(popupHtml), '作者输入框使用简洁占位文案');
  assert(/id="watchKeywords"\s+placeholder="关键词，逗号分隔"/.test(popupHtml), '关键词输入框只提示逗号分隔');
  assert(!/钱袋子/.test(popupHtml), '特关输入区不出现具体作者示例');
assert(/id="watchKeywords"/.test(popupHtml), '存在关键词输入框');
assert(/<input class="watch-input watch-input-full" id="watchKeywords"[\s\S]*?<button class="btn-mini watch-add-btn" id="addWatchRule">添加<\/button>/.test(popupHtml), '关键词输入框与添加按钮位于同一行');
const watchRuleFormRule = popupHtml.match(/\.watch-rule-form\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleFormRule, 'padding', '8px'), '新增规则表单恢复外框内边距');
assert(hasDeclaration(watchRuleFormRule, 'border', /1px\s+dashed\s+var\(--border-light\)/), '新增规则表单恢复轻量虚线外框');
const watchActionRowRule = popupHtml.match(/\.watch-action-row\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchActionRowRule, 'display', 'grid'), '关键词输入行使用与来源作者一致的两列栅格');
assert(hasDeclaration(watchActionRowRule, 'grid-template-columns', /minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/), '关键词输入框与添加按钮等比例分列');
const watchInputFullRule = popupHtml.match(/\.watch-action-row \.watch-input-full\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchInputFullRule, 'width', '100%'), '关键词输入框占满左侧等比例列');
const watchAddButtonRule = popupHtml.match(/\.watch-action-row \.watch-add-btn\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchAddButtonRule, 'width', '100%'), '添加按钮占满右侧等比例列');
assert(!/watchSourceEl\.value\s*=\s*''/.test(popupJs), '添加后保留来源输入，方便继续补充关键词');
assert(!/watchAuthorEl\.value\s*=\s*''/.test(popupJs), '添加后保留作者输入，方便继续补充关键词');
assert(/watchKeywordsEl\.value\s*=\s*''/.test(popupJs), '添加后仅清空关键词输入');
assert(!/匹配后置顶/.test(popupHtml), '特关输入区不显示额外说明文案');
assert(/watch-rule-head/.test(popupJs), '规则列表按单条记录展示来源和作者');
assert(/title="\$\{escapeHtml\(getWatchRuleLabel\(rule\)\)\}"/.test(popupJs), '规则卡片使用结构化 title 描述');
assert(/来源不限/.test(popupJs) && /作者不限/.test(popupJs) && /关键词不限/.test(popupJs), '规则描述用不限表达空条件');
assert(/关键词：\$\{rule\.keywords\.join\('、'\)\}/.test(popupJs), '规则描述使用中文顿号连接关键词');
assert(/watch-keyword-tags/.test(popupJs), '规则列表完整展示关键词标签');
assert(/watch-keyword-tag/.test(popupHtml), '关键词标签有独立轻量样式');
assert(/watch-keyword-remove/.test(popupJs), '关键词标签支持单独删除');
assert(/data-keyword-index/.test(popupJs), '删除关键词时使用索引定位具体关键词');
assert(!/\.watch-section\.visible\s*{/.test(popupHtml), '不再维护特关分区显示状态');
const watchRulesListRule = popupHtml.match(/\.watch-rules-list\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRulesListRule, 'display', 'flex'), '特关规则列表改为单列纵向堆叠');
assert(hasDeclaration(watchRulesListRule, 'flex-direction', 'column'), '特关规则列表按单列记录排列');
assert(hasDeclaration(watchRulesListRule, 'padding-right', '0'), '特关规则列表不为隐藏滚动条预留右侧占位');
assert(hasDeclaration(watchRulesListRule, 'scrollbar-width', 'none'), '特关规则列表隐藏 Firefox 滚动条但保留滚动');
assert(hasDeclaration(watchRulesListRule, '-ms-overflow-style', 'none'), '特关规则列表隐藏旧 Edge 滚动条但保留滚动');
assert(/\.watch-rules-list:empty\s*{[^}]*display:\s*none/i.test(popupHtml), '空规则列表不占用布局空间');
const watchRulesListTailRule = popupHtml.match(/\.watch-rules-list\.has-scroll-tail\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRulesListTailRule, '-webkit-mask-image', /linear-gradient\(to bottom,\s*#000\s+calc\(100%\s*-\s*32px\),\s*rgba\(0,\s*0,\s*0,\s*0\.35\)\s+calc\(100%\s*-\s*12px\),\s*transparent\)/), '特关规则列表未滚到底时使用更明显的底部渐隐提示');
assert(hasDeclaration(watchRulesListTailRule, 'mask-image', /linear-gradient\(to bottom,\s*#000\s+calc\(100%\s*-\s*32px\),\s*rgba\(0,\s*0,\s*0,\s*0\.35\)\s+calc\(100%\s*-\s*12px\),\s*transparent\)/), '特关规则列表底部渐隐兼容标准 mask');
assert(/\.watch-badge\s*{/.test(popupHtml), '主列表存在特别关注标签样式');
assert(/pinnedWatch/.test(popupJs), '未读特别关注在主列表置顶');
assert(/pinnedUrls/.test(popupJs), '置顶特别关注不重复渲染原始条目');
assert(/watch-badge\">特关<\/span>/.test(popupJs), '特关条目使用紧凑标签');
const watchBadgeRule = popupHtml.match(/\.watch-badge\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchBadgeRule, 'color', /var\(--accent\)/), '特关标签沿用原有强调色');
assert(hasDeclaration(watchBadgeRule, 'background', /color-mix\(in srgb, var\(--accent\) 10%, transparent\)/), '特关标签使用更克制的强调底色');
assert(hasDeclaration(watchBadgeRule, 'border-radius', '3px'), '特关标签使用与分类一致的圆角长方形');
assert(hasDeclaration(watchBadgeRule, 'font-weight', '500'), '特关标签使用与分类一致的字重');
assert(hasDeclaration(watchBadgeRule, 'padding', '1px 6px'), '特关标签使用与分类一致的内边距');
assert(!/box-shadow\s*:/.test(watchBadgeRule), '特关标签不使用额外立体效果，保持与分类协调');
assert(/\.item\.unread\s*{[\s\S]*box-shadow:\s*inset var\(--hairline\) 0 0 var\(--rail, var\(--accent\)\)/i.test(popupHtml), '未读条目使用 hairline Hot rail');
assert(!/\.item\.watch-item\s*{[\s\S]*box-shadow\s*:/.test(popupHtml), '已读特关条目不保留左侧颜色条');
assert(/\.item\.watch-item\.unread\s*{[\s\S]*box-shadow:\s*inset var\(--hairline\) 0 0 var\(--rail-strong, var\(--accent\)\)/i.test(popupHtml), '未读特关条目使用 hairline Hot rail');
assert(/::-webkit-scrollbar-thumb\s*{[^}]*background:\s*var\(--scrollbar, var\(--border\)\)/i.test(popupHtml), '滚动条使用独立 scrollbar token 并回退 border');
assert(/\.cat-tag\.cat-model\s*{[\s\S]*color-mix\(in srgb, var\(--cat-model\) 9%, transparent\)/i.test(popupHtml), '分类标签背景更克制');
assert(/\.date-label\s*{[\s\S]*background:\s*var\(--bg-sub\)/i.test(popupHtml), '日期浮标使用面板背景降低按钮感');
assert(!/\.watch-rule-card::before\s*{/.test(popupHtml), '特关规则卡片不使用左侧主色竖条');
assert(!/pinnedUrls\.has\(item\.url\) \? '特别关注'/.test(popupJs), '置顶重点条目不额外显示悬浮分组标签');
assert(/'readAllBeforeByMode', 'watchRules'/.test(popupJs), '初始化时从 chrome.storage.local 读取特关规则');
assert(/renderWatchRules\(data\.watchRules \|\| \[\]\)/.test(popupJs), '加载配置时渲染已保存规则');
assert(/function normalizeText\(value\)/.test(popupJs), 'popup 规则合并具备文本归一化函数');
const watchRulesListScrollRule = popupHtml.match(/\.watch-rules-list\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!hasDeclaration(watchRulesListScrollRule, 'height', '168px'), '特关规则列表不固定高度，删除规则后随内容收缩');
assert(hasDeclaration(watchRulesListScrollRule, 'max-height', '168px'), '特关规则列表只保留高度上限，规则较多时才滚动');
assert(hasDeclaration(watchRulesListScrollRule, 'overflow-y', 'auto'), '特关规则列表可滚动');
const watchRulesListScrollbarRule = popupHtml.match(/\.watch-rules-list::-webkit-scrollbar\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRulesListScrollbarRule, 'width', '0'), '特关规则列表隐藏 Chrome 滚动条宽度，避免挤压虚线框');
assert(hasDeclaration(watchRulesListScrollbarRule, 'height', '0'), '特关规则列表隐藏 Chrome 横向滚动条高度');
const watchInputHoverRule = popupHtml.match(/\.watch-input:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchInputHoverRule, 'background', /var\(--bg\)/), '特关输入框 hover 不改变背景色');
assert(/border-color\s*:\s*color-mix\(in srgb, var\(--accent\) 35%, var\(--border\)\)/.test(watchInputHoverRule), '特关输入框 hover 使用统一轻量主题色边框');
const watchRuleCardRule = popupHtml.match(/\.watch-rule-card\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleCardRule, 'display', /grid/), '添加后的规则使用单条记录栅格布局');
assert(hasDeclaration(watchRuleCardRule, 'flex', /0\s+0\s+auto/), '规则卡片在固定高度列表中保持自然高度，由列表滚动承载溢出内容');
assert(hasDeclaration(watchRuleCardRule, 'grid-template-columns', /minmax\(0,\s*1fr\)/), '规则卡片使用单主列承载两行内容');
assert(!hasDeclaration(watchRuleCardRule, 'grid-template-rows', /auto\s+auto/), '规则卡片不预留空关键词行');
assert(!hasDeclaration(watchRuleCardRule, 'row-gap', '5px'), '规则卡片不在无关键词时保留行间距');
assert(hasDeclaration(watchRuleCardRule, 'background', /color-mix\(in srgb, var\(--bg\) 76%, var\(--bg-sub\)\)/), '规则列表使用主题混合背景降低灰盒堆叠');
assert(hasDeclaration(watchRuleCardRule, 'border', /1px\s+dashed\s+var\(--border-light\)/), '已保存规则卡片使用与新增规则表单一致的虚线边界');
assert(!/border\s*:\s*1px\s+solid/i.test(watchRuleCardRule), '已保存规则卡片不再使用实线边界');
assert(hasDeclaration(watchRuleCardRule, 'padding', '8px'), '规则卡片内边距与新增规则表单对齐');
assert(hasDeclaration(watchRuleCardRule, 'width', '100%'), '规则卡片撑满网格单元');
assert(!hasDeclaration(watchRuleCardRule, 'overflow', 'hidden'), '规则卡片不再为左侧竖条裁切内容');
assert(!/box-shadow\s*:/.test(watchRuleCardRule), '规则胶囊不使用阴影，降低卡片感');
assert(!/\.watch-rule-card::before\s*{/.test(popupHtml), '规则元素不使用左侧强调条');
const watchRuleHeadRule = popupHtml.match(/\.watch-rule-head\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleHeadRule, 'display', /flex/), '规则头部按来源与作者横向组织');
assert(hasDeclaration(watchRuleHeadRule, 'align-items', 'baseline'), '规则头部文本基线对齐');
assert(hasDeclaration(watchRuleHeadRule, 'grid-column', /1\s*\/\s*-1/), '规则头部横跨整条规则，容纳来源作者与操作');
assert(hasDeclaration(watchRuleHeadRule, 'gap', '8px'), '规则头部字段与操作之间保留稳定间距');
const watchRuleSourceRule = popupHtml.match(/\.watch-rule-source\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleSourceRule, 'font-size', '10px'), '来源使用更轻的辅助字级');
assert(hasDeclaration(watchRuleSourceRule, 'flex', /0\s+0\s+auto/), '来源完整显示，不压缩省略');
const watchRuleAuthorRule = popupHtml.match(/\.watch-rule-author\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleAuthorRule, 'font-weight', '500'), '作者字段保持主信息字重');
assert(hasDeclaration(watchRuleAuthorRule, 'min-width', '0'), '作者可在停用按钮前省略');
assert(hasDeclaration(watchRuleAuthorRule, 'overflow', 'hidden'), '作者超长时不挤压操作按钮');
const watchRuleContentRule = popupHtml.match(/\.watch-rule-content\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleContentRule, 'grid-column', /1\s*\/\s*-1/), '规则内容区横跨整张规则卡片');
assert(hasDeclaration(watchRuleContentRule, 'display', 'flex'), '规则内容区只在真实子项之间产生间距');
assert(hasDeclaration(watchRuleContentRule, 'flex-direction', 'column'), '规则内容区按头部与关键词纵向排版');
assert(hasDeclaration(watchRuleContentRule, 'gap', '5px'), '有关键词时头部与关键词行保持紧凑间距');
assert(!hasDeclaration(watchRuleContentRule, 'grid-template-rows', /auto\s+auto/), '规则内容区不创建空关键词行');
const watchKeywordTagsRule = popupHtml.match(/\.watch-keyword-tags\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!hasDeclaration(watchKeywordTagsRule, 'grid-column', /1\s*\/\s*-1/), '关键词行依靠全宽内容区延展，不需要空网格行');
assert(hasDeclaration(watchKeywordTagsRule, 'min-width', '0'), '关键词行允许在规则卡片内收缩');
const watchKeywordTagRule = popupHtml.match(/\.watch-keyword-tag\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchKeywordTagRule, 'max-width', '100%'), '关键词标签占满一行时不超过卡片内容宽度');
assert(hasDeclaration(watchKeywordTagRule, 'min-width', '0'), '关键词标签允许长内容收缩');
assert(hasDeclaration(watchKeywordTagRule, 'padding', /1px\s+5px/), '关键词标签左右内边距对称');
assert(/class="watch-keyword-text"/.test(popupJs), '关键词文本使用独立元素承载省略样式');
const watchKeywordTextRule = popupHtml.match(/\.watch-keyword-text\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchKeywordTextRule, 'min-width', '0'), '长关键词文本允许收缩');
assert(hasDeclaration(watchKeywordTextRule, 'overflow', 'hidden'), '长关键词文本不撑破标签');
assert(hasDeclaration(watchKeywordTextRule, 'text-overflow', 'ellipsis'), '长关键词文本超出时省略');
assert(hasDeclaration(watchKeywordTextRule, 'white-space', 'nowrap'), '长关键词文本保持单行');
const keywordRemoveRule = popupHtml.match(/\.watch-keyword-remove\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(keywordRemoveRule, 'flex', /0\s+0\s+auto/), '关键词删除按钮不被长关键词挤压');
const watchRuleActionsRule = popupHtml.match(/\.watch-rule-actions\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleActionsRule, 'margin-left', 'auto'), '停用和删除按钮固定靠右，与作者保持间距');
assert(hasDeclaration(watchRuleActionsRule, 'flex', /0\s+0\s+auto/), '规则操作按钮不被作者挤压');
assert(/<button class="btn-mini watch-rule-btn" data-action="delete" title="删除">×<\/button>/.test(popupJs), '删除规则使用轻量 × 操作');
assert(/saveWatchRules\(nextRules,\s*\{\s*scrollToEnd:\s*true\s*}\)/.test(popupJs), '新增规则后滚动到列表底部，立即露出新规则');
assert(/watchRulesList\.scrollTop\s*=\s*watchRulesList\.scrollHeight/.test(popupJs), '规则列表支持保存后滚到底部');
assert(/function\s+updateWatchRulesScrollHint\(\)/.test(popupJs), '规则列表具备底部渐隐状态更新函数');
assert(/scrollHeight\s*-\s*watchRulesList\.scrollTop\s*-\s*watchRulesList\.clientHeight\s*>\s*1/.test(popupJs), '底部渐隐只在下方仍有内容时显示');
assert(/watchRulesList\.classList\.toggle\('has-scroll-tail',\s*hasScrollTail\)/.test(popupJs), '规则列表按滚动位置切换渐隐 class');
assert(/watchRulesList\.addEventListener\('scroll',\s*updateWatchRulesScrollHint,\s*\{\s*passive:\s*true\s*}\)/.test(popupJs), '规则列表滚动时刷新渐隐状态');
const watchRuleDeleteHoverRule = popupHtml.match(/\.watch-rule-actions \.watch-rule-btn\[data-action="delete"\]:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleDeleteHoverRule, 'color', /var\(--state-fail\)/), '整条删除 hover 使用危险色');
assert(hasDeclaration(watchRuleDeleteHoverRule, 'background', /var\(--state-fail-softer\)/), '整条删除 hover 使用轻危险背景');
const keywordRemoveHoverRule = popupHtml.match(/\.watch-keyword-remove:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(keywordRemoveHoverRule, 'color', /var\(--state-fail\)/), '关键词删除 hover 使用危险色');
assert(!/data-action="delete">删除<\/button>/.test(popupJs), '规则列表不显示厚重的删除文字按钮');
assert(/class="btn-mini" id="copyLogs"/.test(popupHtml), '调试拷贝按钮使用独立 mini button 风格');
assert(/this\.textContent = '成功'/.test(popupJs), '拷贝成功反馈显示成功');
assert(/this\.textContent = '拷贝'/.test(popupJs), '拷贝反馈结束后恢复拷贝文案');
assert(!/classList\.add\('is-result-ok'\)/.test(popupJs), '拷贝成功不添加特殊视觉状态');
const dateLabelRule = popupHtml.match(/\.date-label\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!hasDeclaration(dateLabelRule, 'float', 'left'), '日期浮标不使用左浮动偏离右上角');
assert(hasDeclaration(dateLabelRule, 'position', 'sticky'), '日期标签使用 sticky 悬浮在可视列表顶部');
assert(hasDeclaration(dateLabelRule, 'top', '6px'), '日期标签保持右上角 6px 悬浮偏移');
assert(hasDeclaration(dateLabelRule, 'z-index', '2'), '日期标签提升层级避免被条目覆盖');
assert(hasDeclaration(dateLabelRule, 'float', 'right'), '日期浮标使用右浮动压到首条卡片上');
assert(hasDeclaration(dateLabelRule, 'margin-right', '6px'), '日期浮标靠右贴近卡片内容区');
assert(hasDeclaration(dateLabelRule, 'margin-bottom', '-24px'), '日期浮标使用负下边距覆盖在卡片右上角');
assert(hasDeclaration(dateLabelRule, 'background', /var\(--bg-sub\)/), '日期浮标使用面板背景');
assert(hasDeclaration(dateLabelRule, 'border', /1px\s+solid\s+var\(--border-light\)/), '日期浮标使用完整边框');
assert(hasDeclaration(dateLabelRule, 'padding', /2px\s+8px/), '日期浮标使用紧凑内边距');
assert(hasDeclaration(dateLabelRule, 'border-radius', '10px'), '日期浮标保持胶囊圆角');
assert(!hasDeclaration(dateLabelRule, 'width', 'max-content'), '日期浮标不使用独立行靠右布局');
assert(!hasDeclaration(dateLabelRule, 'margin', /6px\s+18px\s+6px\s+auto/), '日期浮标不退化为两卡片之间的靠右独立行');
assert(!hasDeclaration(dateLabelRule, 'display', 'block'), '日期浮标不退化成全宽分隔行');
assert(!hasDeclaration(dateLabelRule, 'box-sizing', 'border-box'), '日期浮标不使用分隔行盒模型');
assert(/Object\.entries\(groups\)\.forEach\(\(\[dateLabel,\s*items\]\)\s*=>\s*\{\s*html\s*\+=\s*`<div class="date-label">\$\{dateLabel\}<\/div>`/.test(popupJs), '每个日期组都渲染悬浮日期标签，包括首组');
const itemRule = popupHtml.match(/\.item\s*{([\s\S]*?)}/i)?.[1] || '';
const skeletonItemRule = popupHtml.match(/\.skeleton-item\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemRule, 'user-select', 'none'), '列表条目整体不可选，避免标题摘要出现文本光标');
assert(hasDeclaration(itemRule, 'border-bottom', /1px\s+solid\s+var\(--border\)/), '列表条目分割线使用 1px 且与主题主边框色保持一致');
assert(!/--item-divider-shadow\s*:/.test(itemRule), '列表条目不使用 inset shadow 分割线变量');
assert(!/box-shadow\s*:\s*var\(--item-divider-shadow\)/i.test(itemRule), '列表条目默认不使用 inset shadow 分割线');
assert(hasDeclaration(skeletonItemRule, 'border-bottom', /1px\s+solid\s+var\(--border\)/), '加载态条目分割线使用 1px 且与主题主边框色保持一致');
assert(!/box-shadow\s*:/.test(skeletonItemRule), '加载态条目不使用 inset shadow 分割线');
assert(!/\.skeleton-item:last-child\s*{[^}]*box-shadow:\s*none/i.test(popupHtml), '加载态不额外覆盖末项分割线，保持回滚版本');
assert(/\.settings-inner\s*{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/.test(popupHtml), '设置面板内容可滚动');
console.log('\n[popup首帧初始化顺序]');
assert(/function\s+waitForNextPaint\(\)/.test(popupJs), '存在首帧让步 helper');
assert(/await\s+waitForNextPaint\(\);\s*renderHistory\(data,\s*\{\s*applyInitialPosition:\s*true\s*\}\s*\);/s.test(popupJs), 'storage 渲染前先等待下一帧');
assert(/await\s+waitForNextPaint\(\);\s*renderHistory\(cachedData,\s*\{\s*updateBadge:\s*false,\s*applyInitialPosition:\s*true\s*\}\s*\);/s.test(popupJs), '缓存渲染前先等待下一帧');
assert(/<script\s+src="popup-log\.js"><\/script>/i.test(popupHtml), 'popup 首屏接入统一性能日志脚本');
assert(/window\.__popupPerfLog/.test(popupLogJs), '统一性能日志脚本导出全局 helper');
assert(/String\(a\[0\]\)\.startsWith\('\[POPUP\]\[perf\]'\)/.test(popupJs), '只复制标准化性能日志');

console.log('\n[打包清单]');
const localScripts = [...popupHtml.matchAll(/<script\s+src="([^"]+\.js)"><\/script>/ig)].map(match => match[1]);
localScripts.forEach(script => {
  assert(new RegExp(`(^|\\s)${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\\\|$)`, 'm').test(packSh), `打包包含 popup 引用脚本 ${script}`);
});

console.log('\n[README]');
assert(/支持四套主题（墨夜\/暗森\/铬墨\/石青）/.test(readme), 'README 描述四套主题');
assert(!/晴野/.test(readme), 'README 不再提及晴野主题');

console.log('\n[商店素材]');
assert(!/三款深色主题|3 张主题截图/.test(storeNotes + screenshotMjs), '商店文案和素材脚本不再停留在三主题描述');
assert(/四套主题（墨夜\/暗森\/铬墨\/石青）/.test(storeNotes), '商店文案描述四套主题');
assert(!/3 套精心设计的主题/.test(storeDescriptionZh), '中文商店描述不再停留在三主题');
assert(/4 套精心设计的主题：墨夜 \/ 暗森 \/ 铬墨 \/ 石青/.test(storeDescriptionZh), '中文商店描述列出四套主题');
assert(!/3 carefully crafted themes/.test(storeDescriptionEn), '英文商店描述不再停留在三主题');
assert(/4 carefully crafted themes: Obsidian Night \/ Dark Forest \/ Chrome Ink \/ Slate Cyan/.test(storeDescriptionEn), '英文商店描述列出四套主题');
assert(/screenshot-slate-night\.png/.test(screenshotMjs), '商店截图脚本生成石青主题截图');
assert(!/class="side-text"/.test(screenshotMjs), '主题截图不再包含右侧文字描述');
assert(/const promoThemes = \['dark', 'green-dark', 'chrome-dark', 'slate-night'\]/.test(screenshotMjs), '小宣传图包含四套主题');
assert(/const marqueeThemes = \['dark', 'green-dark', 'chrome-dark', 'slate-night'\]/.test(screenshotMjs), '顶部宣传图块包含四套主题');

console.log('\n[默认内容源]');
assert(/function\s+normalizeFeedMode\(mode\)\s*{[\s\S]*?return\s+mode\s+===\s+'all'\s*\?\s*'all'\s*:\s*'selected';[\s\S]*?}/.test(popupJs), 'popup 未设置内容源默认精选');
assert(/feedModeEl\.value\s*=\s*normalizeFeedMode\(data\.feedMode\)/.test(popupJs), '配置加载使用统一内容源归一化');

console.log('\n[可访问性]');
assert(/<button\s+class="btn-icon btn-mark-read"\s+id="markAllRead"\s+title="全部已读"\s+aria-label="全部已读">/.test(popupHtml), '全部已读图标按钮有 aria-label');
assert(/<button\s+class="btn-icon"\s+id="pollNow"\s+title="刷新"\s+aria-label="刷新">/.test(popupHtml), '刷新图标按钮有 aria-label');
assert(/<button\s+class="btn-icon"\s+id="settingsBtn"\s+title="设置"\s+aria-label="设置">/.test(popupHtml), '设置图标按钮有 aria-label');
assert(/role="link"/.test(popupJs), '列表条目声明 link 角色');
assert(/tabindex="0"/.test(popupJs), '列表条目可通过键盘聚焦');
assert(/historyList\.addEventListener\('keydown'/.test(popupJs), '列表支持键盘打开条目');
assert(/e\.key\s*===\s*'Enter'/.test(popupJs) && /e\.key\s*===\s*' '/.test(popupJs), '列表条目支持 Enter 和 Space');

console.log('\n[设置默认折叠]');
assert(!/ensureDefaultSettingsGroupOpen/.test(popupJs), '打开设置面板不再自动展开默认分组');
assert(/function collapseSettingsGroups\(\)\s*{[\s\S]*settingGroups\.forEach\(group => \{[\s\S]*group\.open\s*=\s*false/.test(popupJs), '设置面板重新打开时收起全部分组');
assert(/settingsPanel\.classList\.contains\('open'\)[\s\S]*collapseSettingsGroups\(\)/.test(popupJs), '打开设置面板时执行分组收起');

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
