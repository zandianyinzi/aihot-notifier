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

function selectorSetsDeclaration(css, selectorPattern, property, valuePattern = /[^;]+/) {
  return [...css.matchAll(/([^{}]+)\s*{([^{}]*)}/g)].some(([, selectorText, ruleBody]) => {
    const selectors = selectorText.split(',').map(selector => selector.trim());
    return selectors.some(selector => selectorPattern.test(selector)) &&
      hasDeclaration(ruleBody, property, valuePattern);
  });
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
const backgroundJs = fs.readFileSync('background.js', 'utf8');
const popupLogJs = fs.readFileSync('popup-log.js', 'utf8');
const popupJs = fs.readFileSync('popup.js', 'utf8');
const popupReliabilityJs = fs.readFileSync('popup-reliability.js', 'utf8');
const popupBootJs = fs.readFileSync('popup-boot.js', 'utf8');
const claudeMd = fs.readFileSync('CLAUDE.md', 'utf8');
const agentsMd = fs.readFileSync('AGENTS.md', 'utf8');
const packSh = fs.readFileSync('pack.sh', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const screenshotMjs = fs.readFileSync('screenshot.mjs', 'utf8');
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
assert(hasDeclaration(rootRule, '--hairline', '1.25px'), '全局 hairline token 使用 1.25px');
assert(!/--hover-rail\s*:/.test(rootRule), '全局不保留 hover rail 实线 token');
assert(!/--hover-rail-glow\s*:/.test(rootRule), '全局不保留 hover rail 轻染 token');

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
  assert(varNames.includes('--rail') && varNames.includes('--rail-strong'), `${themeName} 主题定义 rail 与 rail-strong 语义 token`);
  assert(varNames.includes('--brand-hot') && varNames.includes('--brand-hot-dot'), `${themeName} 主题定义品牌热源色 token`);
  assert(varNames.includes('--brand-hot-glow'), `${themeName} 主题定义品牌热源光晕 token`);
  assert(!varNames.includes('--rule-rail'), `${themeName} 主题不使用旧 rule-rail token`);
}

const brandLogoRule = popupHtml.match(/\.brand-logo\s*{([\s\S]*?)}/i)?.[1] || '';
const brandLogoMarkRule = popupHtml.match(/\.brand-logo-mark\s*{([\s\S]*?)}/i)?.[1] || '';
const brandLogoDotRule = popupHtml.match(/\.brand-logo-dot\s*{([\s\S]*?)}/i)?.[1] || '';
const brandLogoTag = popupHtml.match(/<svg\b[^>]*class="brand-logo"[^>]*>/i)?.[0] || '';
const brandLogoDotTag = popupHtml.match(/<circle\b[^>]*class="brand-logo-dot"[^>]*>/i)?.[0] || '';
const brandLogoWidth = parseFloat(readDeclaration(brandLogoRule, 'width'));
const brandLogoHeight = parseFloat(readDeclaration(brandLogoRule, 'height'));
const brandLogoViewBox = (brandLogoTag.match(/\bviewBox="([^"]+)"/i)?.[1] || '').split(/\s+/).map(Number);
const brandLogoDotRadius = Number(brandLogoDotTag.match(/\br="([\d.]+)"/i)?.[1]);
const brandLogoSvgScale = Math.min(
  brandLogoWidth / brandLogoViewBox[2],
  brandLogoHeight / brandLogoViewBox[3]
);
const brandLogoDotMinimumDiameter = brandLogoDotRadius * 2 * brandLogoSvgScale * 0.6;
assert(hasDeclaration(brandLogoMarkRule, 'stroke', /var\(--brand-hot\)/), 'Logo 线条颜色使用品牌热源 token');
assert(hasDeclaration(brandLogoDotRule, 'fill', /var\(--brand-hot-dot\)/), 'Logo 红点颜色使用品牌热源红点 token');
assert(hasDeclaration(brandLogoDotRule, 'filter', /drop-shadow\(0 0 3px var\(--brand-hot-glow\)\)/), 'Logo 红点光晕使用品牌热源光晕 token');
assert(/@keyframes\s+logo-dot-breathe\s*{[\s\S]*?50%\s*{\s*opacity:\s*0\.6;\s*transform:\s*scale\(0\.6\);\s*filter:\s*drop-shadow\(0 0 3px var\(--brand-hot-glow\)\);\s*}/.test(popupHtml), 'Logo 红点最小帧使用指定尺寸、透明度与光晕');
assert(Math.abs(brandLogoDotMinimumDiameter - 2.5) < 0.01, 'Logo 红点最小帧实际直径约为 2.50px');


console.log('\n[主题列表/石青主题]');
const themeSelectHtml = popupHtml.match(/<select class="select-mini" id="theme"[^>]*>([\s\S]*?)<\/select>/)?.[1] || '';
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
assert(hasDeclaration(themeCssByName['dark'] || '', '--accent', '#caa85a'), '墨夜强调色往行业黄 signal 靠拢');
assert(hasDeclaration(themeCssByName['dark'] || '', '--accent-soft', 'rgba(202,168,90,0.12)'), '墨夜强调轻染跟随行业黄 signal');
assert(hasDeclaration(themeCssByName['dark'] || '', '--rail', '#e4ba48'), '墨夜 rail 使用沉稳行业黄信号色');
assert(hasDeclaration(themeCssByName['dark'] || '', '--rail-strong', '#b98b32'), '墨夜 strong rail 使用更深沉黄褐同色系');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--bg', '#0c0f10'), '暗森背景使用更深邃的冷黑底色');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--border-light', '#2a3033'), '暗森轻边界更清晰且偏冷');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--accent', '#91ad79'), '暗森强调色使用苔藓绿，和石青拉开');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--accent-soft', 'rgba(145,173,121,0.14)'), '暗森强调轻染跟随苔藓绿 signal');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--rail', '#9fbd73'), '暗森 rail 使用苔藓绿信号色');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--rail-strong', '#6f8a52'), '暗森 strong rail 使用更深橄榄绿');
assert(hasDeclaration(themeCssByName['green-dark'] || '', '--state-ok', '#8fbea8'), '暗森成功态与主题强调色轻微分离');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--accent', '#82b2e6'), '铬墨强调色往产品蓝 signal 靠拢');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--accent-soft', 'rgba(130,178,230,0.14)'), '铬墨强调轻染跟随产品蓝 signal');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--rail', '#8ab4f8'), '铬墨 rail 使用稳定产品蓝信号色');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--rail-strong', '#5f8fc8'), '铬墨 strong rail 使用更深产品蓝');
assert(hasDeclaration(themeCssByName['chrome-dark'] || '', '--border', '#303641'), '铬墨边框使用稳定冷灰');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--color-scheme', 'dark'), '石青使用 dark color-scheme');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg', '#0b1418'), '石青背景使用更独立的青黑底色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-sub', '#111c21'), '石青次级背景使用青黑面板色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--bg-hover', '#19262c'), '石青 hover 保持低噪声青黑层级');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--text', '#f0f6fc'), '石青主文字保持高可读性');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--text-2', '#9da8b1'), '石青次级文字层级更清晰');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--border', '#2d3c43'), '石青边框使用青灰边界');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--accent', '#62bcb5'), '石青交互强调往青绿 signal 靠拢');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--accent-soft', 'rgba(98,188,181,0.13)'), '石青强调轻染跟随青绿 signal');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--rail', '#5ecdc3'), '石青 rail 使用青绿信号色');
assert(hasDeclaration(themeCssByName['slate-night'] || '', '--rail-strong', '#3f928c'), '石青 strong rail 使用更深青绿');
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
const settingsRule = popupHtml.match(/\.settings\s*{([\s\S]*?)}/i)?.[1] || '';
const settingsPanelOpenRule = popupHtml.match(/\.settings\.open\s*{([\s\S]*?)}/i)?.[1] || '';
assert(/^max-height\s+0\.28s\s+ease/i.test(readDeclaration(settingsRule, 'transition')), '设置面板使用平滑高度动画');
assert(!readDeclaration(settingsRule, 'position'), '设置面板保留正常文档流布局');
assert(/function\s+updateSettingsScrollHint\(\)/.test(popupJs), '设置面板具备底部渐隐状态更新函数');
assert(/settingsInnerEl\.classList\.toggle\('has-scroll-tail',\s*hasScrollTail\)/.test(popupJs), '设置面板按滚动位置切换渐隐 class');
assert(/settingsInnerEl\.addEventListener\('scroll',\s*updateSettingsScrollHint,\s*\{\s*passive:\s*true\s*}\)/.test(popupJs), '设置面板滚动时刷新渐隐状态');
assert(/requestAnimationFrame\(updateSettingsScrollHint\)/.test(popupJs), '设置面板布局变化后下一帧重新计算渐隐状态');
assert(/function\s+isWithinDisplayWindow\(item,\s*cutoff\)/.test(popupJs), '显示天数具备按发布时间筛选函数');
assert(/const\s+history\s*=\s*rawHistory\.filter\(i\s*=>\s*isWithinDisplayWindow\(i,\s*cutoff\)\)/.test(popupJs), '主列表按发布时间应用显示天数');
assert(/logPerf\('settings-click'/.test(popupJs), '设置面板点击记录目标状态');
assert(/logPerf\('settings-frame'/.test(popupJs), '设置面板展开帧记录关键帧时序');
assert(/settingsPanel\.addEventListener\('transition(run|end)'/.test(popupJs), '设置面板记录高度过渡起止事件');
assert(/logPerf\('settings-layout-read'/.test(popupJs), '设置面板记录滚动尺寸读取耗时');
assert(/let\s+cachedHistoryScrollHeight\s*=\s*0/.test(popupJs), '历史列表缓存总高度避免设置面板重复触发布局');
assert(/function\s+updateHistoryScrollControls\(options\s*=\s*\{\}\)/.test(popupJs), '历史列表边缘按钮支持复用缓存尺寸');
assert(/readScrollHeight\s*!==\s*false/.test(popupJs), '历史列表仅在内容更新或首次计算时读取总高度');
assert(/logPerf\('scroll-restore'/.test(popupJs), '滚动位置恢复记录前后状态');
assert(/logPerf\('scroll-save'/.test(popupJs), '滚动位置保存记录快照');
assert(/logPerf\('scroll-event'/.test(popupJs), '滚动事件记录当前位置');
assert(/function\s+suppressScrollPersistenceForFrames\(/.test(popupJs), '初始化恢复后暂时抑制滚动位置持久化');
assert(/if\s*\(scrollPersistenceSuppressed\)\s*return;/.test(popupJs), '滚动位置持久化跳过初始化滚动事件');
// Refresh/reopen position behavior is exercised by test-popup-scroll.js.
assert(!/settingsPanelController\.toggle\(\);\s*requestAnimationFrame\(updateSettingsScrollHint\);\s*requestAnimationFrame\(updateHistoryScrollControls\)/.test(popupJs), '设置面板展开首帧不强制测量历史列表布局');
assert(/settingsPanel\.addEventListener\('transitionend',[\s\S]*?requestAnimationFrame\(\(\)\s*=>\s*updateHistoryScrollControls\(\{\s*readScrollHeight:\s*false\s*\}\)\)/.test(popupJs), '设置面板过渡结束后复用历史列表尺寸刷新边缘按钮');
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
const btnIconFocusVisibleRule = popupHtml.match(/\.btn-icon:focus-visible\s*{([\s\S]*?)}/i)?.[1] || '';
const btnMiniFocusVisibleRule = popupHtml.match(/\.btn-mini:focus-visible\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(actionsRule, 'justify-content', 'flex-end'), '右上角按钮靠右排列');
assert(hasDeclaration(actionsRule, 'flex', /0\s+0\s+auto/), '右上角按钮组不被压缩');
assert(hasDeclaration(actionsRule, 'gap', '6px'), '右上角按钮保持间距');
assert(hasDeclaration(btnIconRule, 'flex', /0\s+0\s+var\(--control-size\)/), '单个按钮固定占位，避免叠加');
assert(hasDeclaration(btnIconHoverRule, 'background', /var\(--accent-soft\)/), '右上角按钮悬停使用统一主题色轻染背景');
assert(hasDeclaration(btnIconHoverRule, 'color', /var\(--accent\)/), '右上角按钮悬停使用主题色图标');
assert(hasDeclaration(btnIconFocusVisibleRule, 'outline', /1px\s+solid\s+var\(--accent\)/), '右上角按钮键盘焦点使用主题色描边');
assert(hasDeclaration(btnIconFocusVisibleRule, 'outline-offset', '2px'), '右上角按钮键盘焦点描边外移避免遮挡图标');
assert(hasDeclaration(btnMiniFocusVisibleRule, 'outline', /1px\s+solid\s+var\(--accent\)/), '文字按钮键盘焦点使用主题色描边');
assert(hasDeclaration(btnMiniFocusVisibleRule, 'outline-offset', '2px'), '文字按钮键盘焦点描边外移');
assert(/id="scrollToTop"[^>]*title="置顶"[^>]*aria-label="置顶"/.test(popupHtml), '顶部导航按钮有置顶语义标签');
assert(/id="scrollToBottom"[^>]*title="置底"[^>]*aria-label="置底"/.test(popupHtml), '底部导航按钮有置底语义标签');
assert(/class="btn-icon scroll-nav-btn" id="scrollToTop"/.test(popupHtml), '置顶按钮复用统一图标按钮样式');
assert(/class="btn-icon scroll-nav-btn" id="scrollToBottom"/.test(popupHtml), '置底按钮复用统一图标按钮样式');

console.log('\n[键盘焦点可访问性]');
const switchInputRule = popupHtml.match(/\.switch input\s*{([\s\S]*?)}/i)?.[1] || '';
const switchFocusVisibleRule = popupHtml.match(/\.switch input:focus-visible \+ \.switch-track\s*{([\s\S]*?)}/i)?.[1] || '';
const itemFocusVisibleRule = popupHtml.match(/\.item:focus-visible\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!hasDeclaration(switchInputRule, 'display', 'none'), '开关 input 不使用 display:none，保留键盘可聚焦能力');
assert(hasDeclaration(switchInputRule, 'opacity', '0'), '开关 input 视觉隐藏但保留可访问性');
assert(hasDeclaration(switchFocusVisibleRule, 'outline', /1px\s+solid\s+var\(--accent\)/), '开关键盘焦点在轨道上显示主题色描边');
assert(hasDeclaration(switchFocusVisibleRule, 'outline-offset', '2px'), '开关键盘焦点描边外移');
assert(hasDeclaration(itemFocusVisibleRule, 'outline', /1px\s+solid\s+var\(--accent\)/), '列表条目键盘焦点使用主题色描边');
assert(hasDeclaration(itemFocusVisibleRule, 'outline-offset', '-2px'), '列表条目键盘焦点描边内收，避免改变布局');

console.log('\n[降低动态效果]');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*\.brand-logo-dot\s*{[\s\S]*animation:\s*none/i.test(popupHtml), '降低动态效果时停止 Logo 呼吸动画');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*\.skeleton-line[\s\S]*animation:\s*none/i.test(popupHtml), '降低动态效果时停止骨架屏闪烁');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*\.btn-icon\.is-loading svg[\s\S]*animation:\s*none/i.test(popupHtml), '降低动态效果时停止刷新按钮旋转');
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*\.btn-icon\.is-result-ok[\s\S]*\.btn-icon\.is-result-danger[\s\S]*animation:\s*none/i.test(popupHtml), '降低动态效果时停止按钮结果动画');

console.log('\n[主列表滚动]');
const mainListRule = popupHtml.match(/\.list\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(mainListRule, 'overflow-y', 'auto'), '主列表保留纵向滚动');
assert(!readDeclaration(mainListRule, 'transform'), '主列表不使用视觉位移模拟推开');
assert(!/--settings-shift/.test(popupHtml), '主列表不使用悬浮位移变量');
assert(!/syncSettingsListShift/.test(popupJs), '设置面板不使用悬浮位移同步');
assert(!hasDeclaration(mainListRule, 'overflow-anchor', 'none'), '主列表保留浏览器滚动锚定，补偿离屏条目实现后的高度修正');
assert(hasDeclaration(mainListRule, 'scrollbar-width', 'none'), '主列表隐藏 Firefox 滚动条但保留滚动');
assert(hasDeclaration(mainListRule, '-ms-overflow-style', 'none'), '主列表隐藏旧 Edge 滚动条但保留滚动');
const mainListScrollbarRule = popupHtml.match(/\.list::-webkit-scrollbar\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(mainListScrollbarRule, 'width', '0'), '主列表隐藏 Chrome 滚动条宽度');
assert(hasDeclaration(mainListScrollbarRule, 'height', '0'), '主列表隐藏 Chrome 横向滚动条高度');
assert(/function\s+updateHistoryScrollControls\(options\s*=\s*\{\}\)/.test(popupJs), '主列表具备首尾导航按钮状态更新函数');
assert(/scrollToTopBtn\.classList\.toggle\('visible'/.test(popupJs), '置顶按钮按当前滚动位置动态显隐');
assert(/scrollToBottomBtn\.classList\.toggle\('visible'/.test(popupJs), '置底按钮按当前滚动位置动态显隐');
assert(/historyList\.addEventListener\('scroll',[\s\S]*?updateHistoryScrollControls\(\)/.test(popupJs), '主列表滚动时刷新首尾导航按钮');
assert(/scrollToTopBtn\.addEventListener\('click',[\s\S]*?scrollHistoryTo\(0\)/.test(popupJs), '置顶按钮立即跳转到列表开头');
assert(/scrollToBottomBtn\.addEventListener\('click',[\s\S]*?scrollHistoryTo\(historyList\.scrollHeight\)/.test(popupJs), '置底按钮立即跳转到列表结尾');
assert(/historyList\.scrollTo\(\{\s*top,\s*behavior:\s*'auto'\s*}\)/.test(popupJs), '首尾导航跳过平滑滚动重绘');

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
assert(/class="watch-keyword-tag"><span class="watch-keyword-text"[\s\S]*?class="watch-keyword-remove"/.test(popupJs), '关键词文字与删除操作位于同一流式胶囊内');
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
assert(/pinnedKeys/.test(popupJs), '置顶特别关注按稳定key不重复渲染原始条目');
assert(/watch-badge\">特关<\/span>/.test(popupJs), '特关条目使用紧凑标签');
const watchBadgeRule = popupHtml.match(/\.watch-badge\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchBadgeRule, 'color', /var\(--accent\)/), '特关标签沿用原有强调色');
assert(hasDeclaration(watchBadgeRule, 'background', /color-mix\(in srgb, var\(--accent\) 10%, transparent\)/), '特关标签使用更克制的强调底色');
assert(hasDeclaration(watchBadgeRule, 'border-radius', '3px'), '特关标签使用与分类一致的圆角长方形');
assert(hasDeclaration(watchBadgeRule, 'font-weight', '500'), '特关标签使用与分类一致的字重');
assert(hasDeclaration(watchBadgeRule, 'padding', '1px 6px'), '特关标签使用与分类一致的内边距');
assert(!/box-shadow\s*:/.test(watchBadgeRule), '特关标签不使用额外立体效果，保持与分类协调');
const itemHoverRule = popupHtml.match(/\.item:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemHoverRule, 'background', /color-mix\(in srgb, var\(--bg-item-hover\) 88%, #000\)/), '条目 hover 使用轻微压暗反馈');
assert(!readDeclaration(itemHoverRule, 'box-shadow'), '条目 hover 不再使用右侧细线反馈');
const itemReadHoverRule = popupHtml.match(/\.item\.read:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemReadHoverRule, 'background', /color-mix\(in srgb, var\(--bg-item-hover\) 64%, #000\)/), '已读条目 hover 使用可见但低于未读的亮度反馈');
assert(!readDeclaration(itemReadHoverRule, 'box-shadow'), '已读条目 hover 不使用额外颜色条反馈');

const itemUnreadHoverRule = popupHtml.match(/\.item\.unread:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemUnreadHoverRule, 'background', /color-mix\(in srgb, var\(--bg-unread\) 84%, #000\)/), '未读条目 hover 在保留未读底色基础上轻微压暗');
assert(!readDeclaration(itemUnreadHoverRule, 'box-shadow'), '未读条目 hover 不再使用右侧细线反馈');

const watchUnreadHoverRule = popupHtml.match(/\.item\.watch-item\.unread:hover\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!watchUnreadHoverRule, '特关未读 hover 不再使用额外右侧细线规则');

const readHoverTextSelectorPattern = /^\.item\.read:hover\s+\.item-(?:title|summary|meta)$/i;
assert(!selectorSetsDeclaration(popupHtml, readHoverTextSelectorPattern, 'color'), '已读条目 hover 不再对标题摘要与元信息设置颜色');
assert(!selectorSetsDeclaration(popupHtml, readHoverTextSelectorPattern, 'color', /var\(--text-read-hover\)/), '已读条目 hover 不再使用 --text-read-hover 提亮标题摘要与元信息');
const itemUnreadRule = popupHtml.match(/\.item\.unread\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemUnreadRule, 'background', /var\(--bg-unread\)/), '未读条目保留未读背景');
assert(!readDeclaration(itemUnreadRule, 'box-shadow'), '未读条目不再保留左侧颜色条');
assert(!/\.item\.watch-item\s*{[\s\S]*box-shadow\s*:/.test(popupHtml), '已读特关条目不保留左侧颜色条');
const watchUnreadRule = popupHtml.match(/\.item\.watch-item\.unread\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchUnreadRule, 'box-shadow', 'none'), '未读特关条目不再保留左侧颜色条');
assert(/::-webkit-scrollbar-thumb\s*{[^}]*background:\s*var\(--scrollbar, var\(--border\)\)/i.test(popupHtml), '滚动条使用独立 scrollbar token 并回退 border');
assert(/\.cat-tag\.cat-model\s*{[\s\S]*color-mix\(in srgb, var\(--cat-model\) 9%, transparent\)/i.test(popupHtml), '分类标签背景更克制');
assert(!/\.date-label\s*{/.test(popupHtml), '日期浮标样式已移除');
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
const disabledWatchRuleCardRule = popupHtml.match(/\.watch-rule-card\.disabled\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!hasDeclaration(disabledWatchRuleCardRule, 'opacity', /.+/), '停用规则不整体降低透明度，启用与排序操作保持清晰');
assert(/\.watch-rule-card\.disabled \.watch-rule-source,[\s\S]*?\.watch-rule-card\.disabled \.watch-keyword-tags\s*{[\s\S]*?opacity\s*:\s*0\.52/i.test(popupHtml), '停用规则只弱化来源、作者和关键词内容');
const watchRuleHeadRule = popupHtml.match(/\.watch-rule-head\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleHeadRule, 'display', /flex/), '规则头部按来源与作者横向组织');
assert(hasDeclaration(watchRuleHeadRule, 'align-items', 'center'), '规则头部文本与统一操作条垂直居中');
assert(hasDeclaration(watchRuleHeadRule, 'grid-column', /1\s*\/\s*-1/), '规则头部横跨整条规则，容纳来源作者与操作');
assert(hasDeclaration(watchRuleHeadRule, 'gap', '8px'), '规则头部字段与操作之间保留稳定间距');
const watchRuleSourceRule = popupHtml.match(/\.watch-rule-source\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleSourceRule, 'font-size', '10px'), '来源使用更轻的辅助字级');
assert(hasDeclaration(watchRuleSourceRule, 'flex', /0\s+1\s+auto/), '超长来源允许收缩，避免挤出右侧操作');
assert(hasDeclaration(watchRuleSourceRule, 'min-width', '0'), '来源可在固定宽度规则卡片内收缩');
assert(hasDeclaration(watchRuleSourceRule, 'white-space', 'normal'), '超长来源通过换行保持完整显示');
assert(hasDeclaration(watchRuleSourceRule, 'overflow-wrap', 'anywhere'), '连续长来源也不会撑破规则卡片');
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
assert(hasDeclaration(watchKeywordTagRule, 'padding', /2px\s+5px/), '关键词边框上下左右紧贴文字内容');
assert(hasDeclaration(watchKeywordTagRule, 'gap', '3px'), '关键词文字与删除按钮在同一胶囊内保持紧凑间距');
assert(/class="watch-keyword-text"/.test(popupJs), '关键词文本使用独立元素承载省略样式');
const watchKeywordTextRule = popupHtml.match(/\.watch-keyword-text\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchKeywordTextRule, 'min-width', '0'), '长关键词文本允许收缩');
assert(hasDeclaration(watchKeywordTextRule, 'overflow', 'hidden'), '长关键词文本不撑破标签');
assert(hasDeclaration(watchKeywordTextRule, 'text-overflow', 'ellipsis'), '长关键词文本超出时省略');
assert(hasDeclaration(watchKeywordTextRule, 'white-space', 'nowrap'), '长关键词文本保持单行');
const keywordRemoveRule = popupHtml.match(/\.watch-keyword-remove\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(keywordRemoveRule, 'flex', /0\s+0\s+auto/), '关键词删除按钮不被长关键词挤压');
assert(hasDeclaration(keywordRemoveRule, 'width', '14px') && hasDeclaration(keywordRemoveRule, 'height', '14px'), '删除按钮可见盒子不撑大关键词胶囊');
assert(hasDeclaration(keywordRemoveRule, 'position', 'relative'), '删除按钮为透明命中区提供定位基准');
const keywordRemoveHitRule = popupHtml.match(/\.watch-keyword-remove::before\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(keywordRemoveHitRule, 'width', '24px') && hasDeclaration(keywordRemoveHitRule, 'height', '24px'), '删除按钮使用透明伪元素保留 24x24 命中区');
const watchRuleActionsRule = popupHtml.match(/\.watch-rule-actions\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleActionsRule, 'margin-left', 'auto'), '停用和删除按钮固定靠右，与作者保持间距');
assert(hasDeclaration(watchRuleActionsRule, 'flex', /0\s+0\s+auto/), '规则操作按钮不被作者挤压');
const watchRuleButtonRule = popupHtml.match(/\.watch-rule-actions \.watch-rule-btn\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleButtonRule, 'height', '24px'), '规则操作统一使用 24px 高度');
assert(/<span class="watch-rule-move-group">[\s\S]*?data-action="move-up"[\s\S]*?data-action="move-down"[\s\S]*?<\/span>/.test(popupJs), '上下移动收纳在独立排序组中');
const watchRuleMoveGroupRule = popupHtml.match(/\.watch-rule-move-group\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleMoveGroupRule, 'border-left', /1px\s+solid\s+var\(--border-light\)/), '排序组使用低对比分隔线区分规则操作');
assert(hasDeclaration(watchRuleMoveGroupRule, 'padding-left', '4px'), '分隔线与排序按钮保持紧凑间距');
assert(/data-action="move-up"[^>]*title="上移"[^>]*aria-label="上移 /.test(popupJs), '规则列表提供上移图标按钮和可访问名称');
assert(/data-action="move-down"[^>]*title="下移"[^>]*aria-label="下移 /.test(popupJs), '规则列表提供下移图标按钮和可访问名称');
assert(/ruleIndex === 0 \? 'disabled'/.test(popupJs), '第一条规则禁用上移');
assert(/ruleIndex === normalized\.length - 1 \? 'disabled'/.test(popupJs), '最后一条规则禁用下移');
const watchRuleMoveRule = popupHtml.match(/\.watch-rule-actions \.watch-rule-move\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleMoveRule, 'width', '24px') && hasDeclaration(watchRuleMoveRule, 'height', '24px'), '排序图标按钮与其它操作统一为 24px');
assert(/moveWatchRule\(rules,\s*ruleId,\s*-1\)/.test(popupJs) && /moveWatchRule\(rules,\s*ruleId,\s*1\)/.test(popupJs), '排序按钮通过规则交换 helper 保存');
assert(/restoreWatchRuleActionFocus\(watchRulesList,\s*focusRuleId,\s*focusAction\)/.test(popupJs), '规则重排及后续存储刷新后恢复同一规则的操作焦点');
assert(/watch-rule-card[^`]*?\$\{rule\.id === options\.movedRuleId \? 'is-moved' : ''}/.test(popupJs), '移动后的规则获得一次性反馈状态');
assert(/@keyframes\s+watch-rule-moved/.test(popupHtml), '规则移动使用克制的背景与边框反馈');
assert(/prefers-reduced-motion:[\s\S]*?\.watch-rule-card\.is-moved[\s\S]*?animation:\s*none/i.test(popupHtml), '降低动态效果时停止规则移动动画');
assert(/sortWatchItemsByRulePriority\(sessionWatchPinTracker/.test(popupJs), '置顶消息按特关优先级排序');
assert(/buildHistoryRenderSignature\(\s*history,\s*historyDays,\s*watchRules/.test(popupJs), '渲染缓存签名包含特关规则命中集合');
assert(/<button class="btn-mini watch-rule-btn" data-action="delete" title="删除"[^>]*>×<\/button>/.test(popupJs), '删除规则使用轻量 × 操作');
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
assert(/function\s+formatDateTime\(isoStr\)/.test(popupJs), '条目时间格式化同时输出本地日期和时间');
assert(/return\s+`\$\{month}\/\$\{day}\s+\$\{hours}:\$\{minutes}`/.test(popupJs), '条目时间使用 MM/DD HH:mm 格式');
assert(/<span class="item-source">\$\{source\}<\/span>/.test(popupJs), '来源使用可独立收缩的语义节点');
const itemSourceRule = popupHtml.match(/\.item-source\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemSourceRule, 'min-width', '0'), '长来源允许在元信息行内收缩');
assert(hasDeclaration(itemSourceRule, 'overflow', 'hidden'), '长来源隐藏溢出内容');
assert(hasDeclaration(itemSourceRule, 'text-overflow', 'ellipsis'), '长来源使用省略号提示截断');
assert(hasDeclaration(itemSourceRule, 'white-space', 'nowrap'), '来源保持单行以免挤高元信息行');
assert(/<span class="item-datetime">\$\{formatDateTime\(item\.time\)}<\/span>/.test(popupJs), '每条资讯展示组合后的日期时间');
const itemDateTimeRule = popupHtml.match(/\.item-datetime\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(itemDateTimeRule, 'white-space', 'nowrap'), '组合日期时间始终保持在同一行');
assert(hasDeclaration(itemDateTimeRule, 'font-variant-numeric', 'tabular-nums'), '组合日期时间使用等宽数字便于纵向扫读');
assert(!/getDateLabel|date-label|history-group|pinnedGroups/.test(popupJs), '列表不再生成日期浮标或日期分组容器');
const itemRule = popupHtml.match(/\.item\s*{([\s\S]*?)}/i)?.[1] || '';
assert(!readDeclaration(itemRule, 'content-visibility'), '历史条目不使用会造成高度估算漂移的离屏布局跳过');
assert(!readDeclaration(itemRule, 'contain-intrinsic-size'), '历史条目不使用固定固有高度估算');
assert(!/settings-transitioning/.test(popupHtml), '设置过渡不切换条目布局状态');
assert(!/settingsTransitionEpoch|settingsTransitionScrollTop/.test(popupJs), '设置过渡不保存和校正条目滚动位置');
const itemTitleRule = popupHtml.match(/\n\s*\.item-title\s*{([\s\S]*?)}/i)?.[1] || '';
const unreadTitleRule = popupHtml.match(/\.item\.unread\s+\.item-title\s*{([\s\S]*?)}/i)?.[1] || '';
const skeletonItemRule = popupHtml.match(/\.skeleton-item\s*{([\s\S]*?)}/i)?.[1] || '';
const skeletonTitleRule = popupHtml.match(/\.skeleton-title\s*{([\s\S]*?)}/i)?.[1] || '';
const skeletonSummaryRule = popupHtml.match(/\.skeleton-summary\s*{([\s\S]*?)}/i)?.[1] || '';
const skeletonMetaRule = popupHtml.match(/\.skeleton-meta\s*{([\s\S]*?)}/i)?.[1] || '';
const sizeRules = [...popupHtml.matchAll(/\[data-size="([^"]+)"\]\s*{([^}]*)}/g)];
const expectedSkeletonMetaHeights = {
  small: '10px',
  medium: '10px',
  large: '11px',
  xlarge: '12px',
  xxlarge: '13px'
};
assert(hasDeclaration(itemTitleRule, 'font-weight', '500'), '标题字重恒定 500，已读未读切换不改字重以避免行盒重排位移');
assert(!/font-weight\s*:/.test(unreadTitleRule), '未读标题不覆写字重，仅靠颜色区分，防止 unread→read 时标题重排');
assert(hasDeclaration(itemRule, 'user-select', 'none'), '列表条目整体不可选，避免标题摘要出现文本光标');
assert(hasDeclaration(itemRule, 'border-bottom', /1px\s+solid\s+var\(--border\)/), '列表条目分割线使用 1px 且与主题主边框色保持一致');
assert(!/--item-divider-shadow\s*:/.test(itemRule), '列表条目不使用 inset shadow 分割线变量');
assert(!/box-shadow\s*:\s*var\(--item-divider-shadow\)/i.test(itemRule), '列表条目默认不使用 inset shadow 分割线');
assert(hasDeclaration(skeletonItemRule, 'border-bottom', /1px\s+solid\s+var\(--border\)/), '加载态条目分割线使用 1px 且与主题主边框色保持一致');
assert(!/box-shadow\s*:/.test(skeletonItemRule), '加载态条目不使用 inset shadow 分割线');
assert(!/\.skeleton-item:last-child\s*{[^}]*box-shadow:\s*none/i.test(popupHtml), '加载态不额外覆盖末项分割线，保持回滚版本');
assert(sizeRules.length === 5 && sizeRules.every(([, , body]) => /--skeleton-title-h\s*:/.test(body) && /--skeleton-summary-h\s*:/.test(body) && /--skeleton-meta-h\s*:/.test(body)), '五档字号都定义随字号缩放的骨架高度');
assert(sizeRules.every(([, size, body]) => hasDeclaration(body, '--skeleton-meta-h', expectedSkeletonMetaHeights[size])), '五档骨架元信息高度使用随字号缩放的 cap-height 细条');
assert(hasDeclaration(skeletonTitleRule, 'height', /var\(--skeleton-title-h\)/), '骨架标题使用字号对应高度');
assert(hasDeclaration(skeletonSummaryRule, 'height', /var\(--skeleton-summary-h\)/) && hasDeclaration(skeletonSummaryRule, 'margin-top', '6px'), '骨架摘要匹配真实摘要行高与间距');
assert(hasDeclaration(skeletonMetaRule, 'height', /var\(--skeleton-meta-h\)/) && hasDeclaration(skeletonMetaRule, 'margin-top', '6px'), '骨架元信息匹配真实元信息行高与间距');
assert(/\.settings-inner\s*{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/.test(popupHtml), '设置面板内容可滚动');
console.log('\n[popup首帧初始化顺序]');
assert(/function\s+waitForNextPaint\(\)/.test(popupJs), '存在首帧让步 helper');
assert(/waitForPaint:\s*waitForNextPaint/.test(popupJs) && /await\s+deps\.waitForPaint\(\);[\s\S]*?deps\.renderStorage/.test(popupReliabilityJs), 'storage 渲染前先等待下一帧');
assert(/await\s+deps\.waitForPaint\(\);[\s\S]*?deps\.renderCache/.test(popupReliabilityJs), '缓存渲染前先等待下一帧');
assert(/captureScrollAnchor:\s*\(\)\s*=>\s*captureScrollAnchor\(historyList\)/.test(popupJs), '普通 history load 在提交前捕获当前阅读锚点');
assert(/buildScrollPosition\(historyList,\s*context\)/.test(popupJs), '持久化滚动位置使用统一锚点快照 helper');
assert(/Number\.isFinite\(position\.offsetTop\)[\s\S]*?anchorKey:\s*position\.anchorKey/.test(popupJs), '持久化滚动位置按稳定锚点和相对偏移恢复并兼容旧数据回退');
assert(/function\s+buildScrollPosition\([\s\S]*?anchorKey:\s*anchor\?\.anchorKey/.test(popupReliabilityJs), '滚动位置快照保存稳定 anchorKey');
assert(/writeScrollPosition\([\s\S]*?feedMode:\s*normalizeFeedMode\((?:feedMode|scrollCtx\.feedMode)\)/.test(popupJs), '打开条目保存滚动位置时使用归一化内容源');
assert(/const\s+scrollAnchor\s*=\s*captureScrollAnchor\(historyList\);[\s\S]*?if\s*\(!cachedReadIds\.has\(key\)\)/.test(popupJs), '打开条目在已读状态变更前捕获滚动锚点');
assert(/renderCache:\s*data\s*=>\s*\{[\s\S]*?renderHistory\(data,\s*\{\s*applyInitialPosition:\s*true,\s*persistWatchPins:\s*false\s*}\)/.test(popupJs), 'warm cache 只预览未读特关置顶，不污染会话置顶集合');
assert(/renderStorage:\s*data\s*=>\s*\{[\s\S]*?const\s+scrollAnchor\s*=\s*captureScrollAnchor\(historyList\)[\s\S]*?scrollAnchor\?\.anchorUrl\s*\?[\s\S]*?scrollAnchor[\s\S]*?:[\s\S]*?applyInitialPosition:\s*true/.test(popupJs), 'warm cache 到权威 storage 的二次渲染优先保留现有内容锚点');
assert(/<script\s+src="popup-log\.js"><\/script>/i.test(popupHtml), 'popup 首屏接入统一性能日志脚本');
assert(/window\.__popupPerfLog/.test(popupLogJs), '统一性能日志脚本导出全局 helper');
assert(/window\.__popupPerf\.snapshot\(\)/.test(popupJs), '拷贝日志只取统一性能日志快照');
assert(!/console\.log\s*=/.test(popupJs), '不再重写 console.log，避免生产环境常驻插桩');

console.log('\n[打包清单]');
const localScripts = [...popupHtml.matchAll(/<script\s+src="([^"]+\.js)"><\/script>/ig)].map(match => match[1]);
localScripts.forEach(script => {
  assert(new RegExp(`(^|\\s)${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\\\|$)`, 'm').test(packSh), `打包包含 popup 引用脚本 ${script}`);
});
assert(/(^|\s)feed-state\.js(\s|\\|$)/m.test(packSh), '打包包含共享内容源投影模块');

console.log('\n[README]');
assert(/支持四套主题（墨夜\/暗森\/铬墨\/石青）/.test(readme), 'README 描述四套主题');
assert(!/晴野/.test(readme), 'README 不再提及晴野主题');

console.log('\n[商店素材]');
assert(!/三款深色主题|3 张主题截图/.test(screenshotMjs), '素材脚本不再停留在三主题描述');
assert(!/3 套精心设计的主题/.test(storeDescriptionZh), '中文商店描述不再停留在三主题');
assert(/4 套精心设计的主题：墨夜 \/ 暗森 \/ 铬墨 \/ 石青/.test(storeDescriptionZh), '中文商店描述列出四套主题');
assert(!/3 carefully crafted themes/.test(storeDescriptionEn), '英文商店描述不再停留在三主题');
assert(/4 carefully crafted themes: Obsidian Night \/ Dark Forest \/ Chrome Ink \/ Slate Cyan/.test(storeDescriptionEn), '英文商店描述列出四套主题');
assert(/screenshot-slate-night\.png/.test(screenshotMjs), '商店截图脚本生成石青主题截图');
assert(!/class="side-text"/.test(screenshotMjs), '主题截图不再包含右侧文字描述');
assert((screenshotMjs.match(/<span class="item-datetime">\$\{timeStr\}<\/span>/g) || []).length === 3, '三组商店素材 mock 均复用生产日期时间样式');
assert(/const promoThemes = \['dark', 'green-dark', 'chrome-dark', 'slate-night'\]/.test(screenshotMjs), '小宣传图包含四套主题');
assert(/const marqueeThemes = \['dark', 'green-dark', 'chrome-dark', 'slate-night'\]/.test(screenshotMjs), '顶部宣传图块包含四套主题');

console.log('\n[默认内容源]');
const feedStateScriptIndex = popupHtml.indexOf('<script src="feed-state.js"></script>');
const popupReliabilityScriptIndex = popupHtml.indexOf('<script src="popup-reliability.js"></script>');
const popupScriptIndex = popupHtml.indexOf('<script src="popup.js"></script>');
assert(feedStateScriptIndex >= 0 && feedStateScriptIndex < popupReliabilityScriptIndex && feedStateScriptIndex < popupScriptIndex, 'popup 在可靠性与应用脚本前加载共享内容源投影模块');
assert(/const\s*{\s*normalizeFeedMode,\s*projectHistory\s*}\s*=\s*window\.FeedState/.test(popupJs), 'popup 使用共享内容源投影 contract');
assert(/const\s+rawHistory\s*=\s*projectHistory\(data\.history\s*\|\|\s*\[\],\s*data\.feedMode\)/.test(popupJs), 'popup 渲染前按当前内容源投影 canonical history');
assert(/projectHistory\(history,\s*feedMode\)/.test(backgroundJs), 'background badge 按当前内容源投影 canonical history');
assert(/feedModeEl\.value\s*=\s*normalizeFeedMode\(data\.feedMode\)/.test(popupJs), '配置加载使用统一内容源归一化');

console.log('\n[可访问性]');
assert(/<button\s+class="btn-icon btn-mark-read"\s+id="markAllRead"\s+title="全部已读"\s+aria-label="全部已读">/.test(popupHtml), '全部已读图标按钮有 aria-label');
assert(/<button\s+class="btn-icon"\s+id="pollNow"\s+title="刷新"\s+aria-label="刷新">/.test(popupHtml), '刷新图标按钮有 aria-label');
assert(/<button\s+class="btn-icon"\s+id="settingsBtn"\s+title="设置"\s+aria-label="设置"[^>]*>/.test(popupHtml), '设置图标按钮有 aria-label');
assert(/id="settingsBtn"[^>]*aria-controls="settingsPanel"[^>]*aria-expanded="false"/.test(popupHtml), '设置按钮声明受控面板且默认折叠');
assert(/<div class="settings" id="settingsPanel"[^>]*inert/.test(popupHtml), '设置面板默认 inert，关闭时不可聚焦');
assert(/role="link"/.test(popupJs), '列表条目声明 link 角色');
assert(/tabindex="0"/.test(popupJs), '列表条目可通过键盘聚焦');
assert(/historyList\.addEventListener\('keydown'/.test(popupJs), '列表支持键盘打开条目');
assert(/e\.key\s*===\s*'Enter'/.test(popupJs) && /e\.key\s*===\s*' '/.test(popupJs), '列表条目支持 Enter 和 Space');

console.log('\n[可靠性与操作反馈]');
const markAllReadHandler = popupJs.match(/markAllReadBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*{([\s\S]*?)\n}\);/)?.[1] || '';
const markWatchUrlsViewedHelper = popupJs.match(/async function markWatchUrlsViewed\(urls\)\s*{([\s\S]*?)\n}/)?.[1] || '';
assert(/const\s+enqueuePopupMutation\s*=\s*popupReliability\.createMutationQueue\(\)/.test(popupJs), 'popup 对特关规则和内容源切换提供共享 mutation queue');
assert(/enqueuePopupMutation\(async\s*\(\)\s*=>\s*{[\s\S]*?watchRules/s.test(popupJs), '特关规则的读取、合并和保存处于同一 mutation queue 中');
assert(/createFeedModeSwitchController\(/.test(popupJs), '内容源切换交由具备序列保护的 controller 执行');
assert(/setDisabled:\s*disabled\s*=>\s*\{\s*feedModeEl\.disabled\s*=\s*disabled;\s*}/.test(popupJs), '内容源请求期间禁用选择器，避免重复提交');
assert(!/config\.feedMode\s*=/.test(popupJs), '普通设置保存始终排除 background 拥有的 feedMode');
assert(!/chrome\.storage\.local\.set\(\{\s*feedMode\b/.test(popupJs), 'popup 不直接写入 feedMode');
assert(!/chrome\.storage\.local\.set\(\{\s*readIds\b/.test(popupJs), 'popup 不直接写入 readIds');
assert(!/chrome\.storage\.local\.set\(\{\s*watchNotifyState\b/.test(popupJs), 'popup 不直接写入 watchNotifyState');
assert(!/chrome\.storage\.local\.set\(\{\s*watchRules\b/.test(popupJs), 'popup 不直接写入 watchRules');
assert(!/chrome\.action\.setBadgeText/.test(popupJs), 'popup 不直接更新 badge text');
assert(/type:\s*'openItem'/.test(popupJs) && /ids:\s*\[key,\s*url\]/.test(popupJs), '条目打开后通过 background 合并 readIds');
assert(/type:\s*'saveWatchRules'/.test(popupJs), '特关规则通过 background 串行保存');
assert(/createLatestWinsLoadController/.test(popupJs), 'popup 使用 coalesced latest-wins load controller');
assert(/cached\.data\.feedMode[\s\S]*?expectedMode/.test(popupJs), 'popup cache 拒绝与请求内容源不匹配的数据');
assert(/createPopupInitializationController/.test(popupJs), 'popup 初始化交由可测试的 latest-wins coordinator');
assert(/readCommittedMode:\s*async\s*\(\)\s*=>[\s\S]*?chrome\.storage\.local\.get\('feedMode'\)/.test(popupJs), 'popup 初始化单独发起轻量权威 mode 读取');
assert(/readWarmCache:\s*\(\)\s*=>\s*readWarmPopupCache\(\)/.test(popupJs), 'popup 初始化不等待 full history 即开始 warm cache 读取');
assert(/readFullStorage:\s*\(\)\s*=>\s*chrome\.storage\.local\.get\(POPUP_INITIAL_STORAGE_KEYS\)/.test(popupJs), 'popup 初始化并发发起 full storage 读取');
assert(/applyStorage:[\s\S]*?observeCommittedMode\(data\.feedMode\)/.test(popupJs), '权威 mode 更新仅位于 coordinator fenced storage commit 中');
assert(/chrome\.runtime\.sendMessage\(\{\s*type:\s*'markAllRead',\s*readAllBefore:\s*now\s*}\)/.test(markAllReadHandler), '全部已读通过 background 串行推进全局水位');
assert(!/chrome\.storage\.local\.set\(\{[\s\S]*?readAllBefore/.test(markAllReadHandler), 'popup 不独立覆写全部已读水位');
assert(!/watchAliases|markWatchItemsViewed\(/.test(markAllReadHandler), '全部已读由 background 原子提交全局水位与全部特关已查看状态');
assert(/const\s+scrollAnchor\s*=\s*captureScrollAnchor\(historyList\)/.test(markAllReadHandler), '全部已读前捕获当前列表滚动锚点');
assert(/const\s+rollbackOptimisticReadState\s*=\s*applyOptimisticReadState\(historyList\.querySelectorAll\('\.item'\),\s*markAllReadBtn\)/.test(markAllReadHandler), '全部已读乐观状态保留可同步执行的 DOM 回滚');
assert(/applyOptimisticReadState\(historyList\.querySelectorAll\('\.item'\),\s*markAllReadBtn\);\s*restoreScrollAnchor\(historyList,\s*scrollAnchor\);\s*const\s+now/.test(markAllReadHandler), '全部已读乐观 class 切换后立即恢复滚动锚点');
assert(!/HISTORY_SCROLL_ANCHOR_MAX_JUMP/.test(popupJs), '全部已读滚动锚点恢复不设置距离上限');
assert(/await\s+runMarkAllReadMutation\(\{[\s\S]*?rollback:\s*\(\)\s*=>\s*\{\s*rollbackOptimisticReadState\(\);\s*restoreScrollAnchor\(historyList,\s*scrollAnchor\);\s*}[\s\S]*?reload:\s*\(\)\s*=>\s*loadHistory\(undefined,\s*\{\s*immediate:\s*true,\s*forceRender:\s*true,\s*scrollAnchor\s*}\)/.test(markAllReadHandler), '全部已读失败回滚 class 后立即恢复滚动锚点，再执行权威刷新');
assert(/onFailure:\s*\(\{\s*committed,\s*recovered\s*}\)\s*=>\s*\{[\s\S]*?if\s*\(committed\s*&&\s*recovered\)\s*return[;\s]*[\s\S]*?committed\s*\?[\s\S]*?列表刷新失败[\s\S]*?:\s*'全部已读失败，请重试。'/.test(markAllReadHandler), '后台已提交且刷新重试成功时才静默，mutation 失败仍提示');
assert(/commit:\s*\(data,\s*context\)\s*=>\s*\{[\s\S]*?renderHistory\(data,\s*\{[\s\S]*?skipUnchanged:\s*!context\.forceRender[\s\S]*?scrollAnchor:\s*context\.scrollAnchor[\s\S]*?}\)/.test(popupJs), 'history load commit 将强制重绘和滚动锚点传给列表渲染');
assert(/renderHistory\(data,\s*\{[\s\S]*?applyInitialPosition:\s*context\.applyInitialPosition/.test(popupJs), '冷骨架被普通 load 抢占时仍应用配置的初始定位');
assert(/const\s+response\s*=\s*await\s+chrome\.runtime\.sendMessage\([\s\S]*?if\s*\(!response\?\.ok\)\s*throw/.test(markWatchUrlsViewedHelper), '特关已查看消息显式检查 background 失败响应');
assert(!/chrome\.storage\.local\.(?:get|set)/.test(markWatchUrlsViewedHelper), '特关已查看失败只提示，不回退写 durable state');
assert(/getSafeHttpsUrl\(item\.dataset\.url\)/.test(popupJs) && /type:\s*'openItem'/.test(popupJs), '条目打开校验 HTTPS 后交由 background 创建标签页');
assert(/async function openItem[\s\S]*?await\s+chrome\.tabs\.create\(\{\s*url\s*}\)[\s\S]*?markItemsRead/s.test(backgroundJs) && /msg\.type\s*===\s*'openItem'/.test(backgroundJs), 'background 在已验证标签页创建后提交已读状态');
assert(/createConfigMutationController/.test(popupJs) && /await\s+configMutationController\.save/.test(popupJs), '设置保存使用可等待且可回滚的串行控制器');
assert(/getSafeHttpsUrl\(value\)[\s\S]*?parsed\.protocol\s*===\s*'https:'/s.test(popupReliabilityJs), '条目打开拒绝非 HTTPS URL');
assert(/await\s+createTab\(\{\s*url\s*}\);[\s\S]*?await\s+afterOpen\(url\);/s.test(popupReliabilityJs), 'openHttpsUrl 在创建标签页后执行 afterOpen 回调');
assert(/id="popupStatus"[^>]*role="status"[^>]*aria-live="polite"/.test(popupHtml), '失败状态使用 aria-live status 区域提示');
assert(popupHtml.indexOf('id="historyList"') < popupHtml.indexOf('id="popupStatus"'), '状态行位于列表底部，不插入菜单与首条内容之间');
assert(/function\s+showPopupStatus\(message(?:,\s*options\s*=\s*\{\})?\)/.test(popupJs), 'popup 可向 status 区域发布失败提示');
const popupStatusRule = popupHtml.match(/\.popup-status\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(popupStatusRule, 'height', '22px'), '状态行固定 22px 高度，列表布局保持稳定');
assert(hasDeclaration(popupStatusRule, 'min-height', '22px'), '状态行最小高度固定为 22px');
assert(/\.popup-status:not\(:empty\)\s*\{[\s\S]*?display:\s*flex/i.test(popupHtml), '状态行可见时使用可读的行内布局');
assert(hasDeclaration(popupStatusRule, 'display', 'none'), '状态栏无提示时完全隐藏，不占用布局空间');
assert(/\.popup-status:not\(:empty\)\s*\{[\s\S]*?display:\s*flex/i.test(popupHtml), '状态栏有提示时恢复可见布局');
assert(/popupStatusEl\.classList\.toggle\('is-error'/.test(popupJs), '失败状态使用可见错误样式');
assert(/createAllFeedContinuationStatusController/.test(popupJs) && /showStatus:\s*\(\)\s*=>\s*\{\}/.test(popupJs), '后台续拉不显示进度提示，状态栏仅保留可操作错误');
assert(/刷新失败，请重试/.test(popupJs), '刷新失败向用户显示可读状态');
assert(/设置保存失败，请重试/.test(popupJs), '设置保存失败向用户显示可读状态');
assert(/allFeedContinuation/.test(popupJs) && /createAllFeedContinuationStatusController/.test(popupReliabilityJs), 'all 首屏返回后继续执行后台续拉');
assert(/id="enabled"[^>]*aria-label="推送通知"/.test(popupHtml), '通知开关有程序化标签');
assert(/id="watchSource"[^>]*aria-label="来源"/.test(popupHtml), '来源输入有程序化标签');
assert(/id="watchAuthor"[^>]*aria-label="作者"/.test(popupHtml), '作者输入有程序化标签');
assert(/id="watchKeywords"[^>]*aria-label="关键词，逗号分隔"/.test(popupHtml), '关键词输入有程序化标签');
assert(/id="interval"[^>]*aria-label="检查频率"/.test(popupHtml), '检查频率有程序化标签');
assert(/id="feedMode"[^>]*aria-label="内容源"/.test(popupHtml), '内容源有程序化标签');
assert(/id="historyDays"[^>]*aria-label="显示天数"/.test(popupHtml), '显示天数有程序化标签');
assert(/<select class="select-mini" id="historyDays"[^>]*>[\s\S]*?<option value="1" selected>1 天<\/option>[\s\S]*?<option value="2">2 天<\/option>/.test(popupHtml), '显示天数默认选择 1 天');
assert(/const DEFAULT_HISTORY_DAYS = 1;/.test(popupJs), 'popup 默认显示天数为 1 天');
assert(/const DEFAULT_HISTORY_DAYS = 1;/.test(backgroundJs), 'background 默认显示天数为 1 天');
assert(/id="openPositionMode"[^>]*aria-label="定位"/.test(popupHtml), '定位有程序化标签');
assert(/id="theme"[^>]*aria-label="主题"/.test(popupHtml), '主题有程序化标签');
assert(/id="fontFamily"[^>]*aria-label="字体"/.test(popupHtml), '字体有程序化标签');
assert(/id="fontSize"[^>]*aria-label="字号"/.test(popupHtml), '字号有程序化标签');
assert(/data-action="delete"[^>]*aria-label="删除 \$\{ruleLabel}/.test(popupJs), '删除规则按钮名称包含具体规则描述');
assert(/data-action="move-up"[^>]*aria-label="上移 \$\{ruleLabel}/.test(popupJs), '上移按钮名称包含具体规则描述');
assert(/data-action="move-down"[^>]*aria-label="下移 \$\{ruleLabel}/.test(popupJs), '下移按钮名称包含具体规则描述');
assert(/watch-keyword-remove[^>]*aria-label="删除关键词/.test(popupJs), '删除关键词按钮有明确 aria-label');
const watchRuleDeleteRule = popupHtml.match(/\.watch-rule-actions \.watch-rule-btn\[data-action="delete"\]\s*{([\s\S]*?)}/i)?.[1] || '';
const watchKeywordRemoveRule = popupHtml.match(/\.watch-keyword-remove\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(watchRuleDeleteRule, 'min-width', '24px') && hasDeclaration(watchRuleDeleteRule, 'height', '24px'), '删除规则命中区域至少 24x24');
assert(hasDeclaration(keywordRemoveHitRule, 'width', '24px') && hasDeclaration(keywordRemoveHitRule, 'height', '24px'), '删除关键词透明命中区域保持 24x24');
assert(/<script\s+src="popup-reliability\.js"><\/script>/i.test(popupHtml), 'popup 加载可执行的可靠性 helper');
assert(/createFeedModeSwitchController/.test(popupReliabilityJs), '内容源切换协议位于可执行 helper 中');
assert(/openHttpsUrl/.test(popupReliabilityJs), '安全打开与已读顺序位于可执行 helper 中');
const emptyStateRule = popupHtml.match(/\.empty-state\s*{([\s\S]*?)}/i)?.[1] || '';
assert(hasDeclaration(emptyStateRule, 'cursor', 'default'), '空态使用默认光标');
assert(hasDeclaration(emptyStateRule, 'user-select', 'none'), '空态禁止文本选择');

console.log('\n[设置默认折叠]');
assert(!/ensureDefaultSettingsGroupOpen/.test(popupJs), '打开设置面板不再自动展开默认分组');
assert(/function\s+collapseGroups\(\)[\s\S]*?group\.open\s*=\s*false/.test(popupReliabilityJs), '设置面板重新打开时收起全部分组');
assert(/createSettingsPanelController/.test(popupJs) && /settingsPanelController\.setOpen/.test(popupJs), '打开设置面板时执行分组收起');
assert(/trigger\.setAttribute\('aria-expanded',\s*isOpen\s*\?\s*'true'\s*:\s*'false'\)/.test(popupReliabilityJs), '设置开关同步 aria-expanded');
assert(/panel\.toggleAttribute\('inert',\s*!isOpen\)/.test(popupReliabilityJs), '设置关闭时同步 inert');
assert(/groups\[0\][\s\S]*?querySelector\('\.setting-group-title'\)[\s\S]*?\.focus\(\)/.test(popupReliabilityJs), '设置打开后焦点进入首个分组标题');
assert(/trigger\.focus\(\)/.test(popupReliabilityJs), '设置关闭后焦点返回触发按钮');
assert(
  fs.lstatSync('CLAUDE.md').isSymbolicLink() &&
    fs.readlinkSync('CLAUDE.md') === 'AGENTS.md' && claudeMd === agentsMd,
  'CLAUDE 通过相对软链接读取 AGENTS 规则源'
);
assert(/主列表 hover 只使用整行轻压暗反馈，不使用左侧或右侧 hover 颜色条/.test(agentsMd), 'AGENTS 描述主列表 hover 不使用颜色条');
assert(/Windows\/PowerShell 无 bash 时使用 Compress-Archive/.test(agentsMd), 'AGENTS 记录 PowerShell 打包替代命令');
assert(/设置面板(?:使用原生折叠分组，打开设置时|按 `常规 \/ 外观 \/ 特关 \/ 调试` 分组，)默认不展开任何分组/.test(agentsMd), 'AGENTS 描述设置面板默认不展开');
assert(!/默认只展开 `常规`/.test(agentsMd), 'AGENTS 不再描述默认展开常规');

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
