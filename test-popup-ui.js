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
  const value = valuePattern instanceof RegExp
    ? valuePattern.source
    : valuePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${property}\\s*:\\s*${value}\\s*(?:;|$)`, 'i').test(css);
}

const popupHtml = fs.readFileSync('popup.html', 'utf8');
const htmlTag = popupHtml.match(/<html\b[^>]*>/i)?.[0] || '';
const htmlStyle = htmlTag.match(/\sstyle="([^"]*)"/i)?.[1] || '';
const bodyTag = popupHtml.match(/<body\b[^>]*>/i)?.[0] || '';
const bodyStyle = bodyTag.match(/\sstyle="([^"]*)"/i)?.[1] || '';
const viewportRule = popupHtml.match(/html,\s*body\s*{([\s\S]*?)}/i)?.[1] || '';
const themeRules = [...popupHtml.matchAll(/\[data-theme="([^"]+)"\]\s*{([\s\S]*?)}/g)];

console.log('\n[popup首帧尺寸与背景]');
assert(/<meta\s+name="color-scheme"\s+content="dark"\s*>/i.test(popupHtml), '声明深色 color-scheme，避免首帧默认白色画布');
assert(hasDeclaration(htmlStyle, 'width', '420px'), 'html 根节点内联声明首帧宽度');
assert(hasDeclaration(htmlStyle, 'min-width', '420px'), 'html 根节点内联声明最小宽度');
assert(hasDeclaration(htmlStyle, 'height', '600px'), 'html 根节点内联声明首帧高度');
assert(hasDeclaration(htmlStyle, 'min-height', '600px'), 'html 根节点内联声明最小高度');
assert(hasDeclaration(htmlStyle, 'background', /var\(--bg,\s*#111111\)/), 'html 根节点背景直接依赖主题变量并带兜底');
assert(hasDeclaration(htmlStyle, 'color-scheme', /var\(--color-scheme,\s*dark\)/), 'html 根节点 color-scheme 直接依赖主题变量并带兜底');

assert(hasDeclaration(bodyStyle, 'width', '420px'), 'body 内联声明首帧宽度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'min-width', '420px'), 'body 内联声明最小宽度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'height', '600px'), 'body 内联声明首帧高度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'min-height', '600px'), 'body 内联声明最小高度，兼容 popup 以 body 测量尺寸');
assert(hasDeclaration(bodyStyle, 'background', /var\(--bg,\s*#111111\)/), 'body 内联背景直接依赖主题变量并带兜底');
assert(hasDeclaration(bodyStyle, 'color-scheme', /var\(--color-scheme,\s*dark\)/), 'body 内联 color-scheme 直接依赖主题变量并带兜底');

assert(Boolean(viewportRule), '存在 html, body 共享视口规则');
assert(hasDeclaration(viewportRule, 'width', '420px'), 'html/body 共享规则固定宽度');
assert(hasDeclaration(viewportRule, 'min-width', '420px'), 'html/body 共享规则固定最小宽度');
assert(hasDeclaration(viewportRule, 'height', '600px'), 'html/body 共享规则固定高度');
assert(hasDeclaration(viewportRule, 'min-height', '600px'), 'html/body 共享规则固定最小高度');
assert(hasDeclaration(viewportRule, 'background', /var\(--bg,\s*#111111\)/), 'html/body 共享规则使用主题背景并带兜底');
assert(hasDeclaration(viewportRule, 'color-scheme', /var\(--color-scheme,\s*dark\)/), 'html/body 共享规则使用主题 color-scheme 并带兜底');

assert(themeRules.length >= 3, '存在主题 CSS 变量规则');
for (const [_, themeName, themeCss] of themeRules) {
  assert(hasDeclaration(themeCss, '--bg', /#[0-9a-f]{6}|rgba?\([^)]+\)/), `${themeName} 主题声明 --bg`);
  assert(hasDeclaration(themeCss, '--color-scheme', /dark|light/), `${themeName} 主题声明 --color-scheme`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
