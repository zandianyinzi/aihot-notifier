/**
 * 生成 Chrome Web Store 全部商店素材：
 *   - 2 张主题截图（1280x800 @2x）
 *   - 1 张宣传图（440x280 @2x，双主题卡片拼接）
 *
 * 用法（换电脑后只需执行以下命令）：
 *   npx puppeteer browsers install chrome
 *   npm install --no-save puppeteer
 *   node screenshot.mjs
 *
 * 输出目录：store/
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(__dirname, 'store');
mkdirSync(STORE_DIR, { recursive: true });

const mockItems = [
  { title: 'OpenAI 发布 GPT-5 Turbo，推理能力提升 3 倍', summary: '新模型在数学推理和代码生成上有显著提升，支持 100 万 token 上下文窗口', category: '模型', minutesAgo: 30 },
  { title: 'Anthropic Claude 4 系列全面开放 API 调用', summary: '包括 Opus、Sonnet、Haiku 三个版本，企业用户可直接迁移', category: '产品', minutesAgo: 60 },
  { title: 'Google DeepMind 发布新一代 AlphaFold，蛋白质预测精度再创新高', summary: '新模型可预测蛋白质与药物分子的相互作用，有望加速新药研发', category: '论文', minutesAgo: 90 },
  { title: '国内首个千亿参数开源模型发布，支持 32K 上下文', summary: '性能对标 GPT-4，完全开源可商用，社区生态建设中', category: '模型', minutesAgo: 120 },
  { title: 'Cursor 推出 AI Agent 模式，可自主完成复杂编程任务', summary: '集成多步推理和自动调试能力，开发者生产力大幅提升', category: '产品', minutesAgo: 180 },
  { title: 'Meta 开源视频生成模型 Movie Gen，支持 30 秒高清视频', summary: '支持文本到视频、图片到视频、视频编辑等多种模式', category: '模型', minutesAgo: 240 },
  { title: '如何用 Claude Code 提升 10 倍编程效率', summary: '实战技巧分享：合理使用上下文、编写 CLAUDE.md、善用 slash commands', category: '技巧与观点', minutesAgo: 300 },
  { title: 'AI 芯片市场格局变化：英伟达份额首次跌破 80%', summary: 'AMD、Intel 和多家国产芯片厂商加速追赶，市场竞争加剧', category: '行业', minutesAgo: 360 },
];

const catClass = {
  '模型': 'cat-model',
  '产品': 'cat-products',
  '行业': 'cat-industry',
  '论文': 'cat-paper',
  '技巧与观点': 'cat-tips',
};

const themes = [
  {
    name: 'dark',
    filename: 'screenshot-dark.png',
    bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    textColor: '#f0f0f0',
    textColor2: '#aaa',
    featureColor: '#aaa',
    accentDot: '#ff8c5a',
    frameShadow: '0 20px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
    frameBorder: '1px solid rgba(255,255,255,0.08)',
    subtitle: '墨夜主题，夜间阅读更舒适。',
  },
  {
    name: 'green-dark',
    filename: 'screenshot-green-dark.png',
    bg: 'linear-gradient(135deg, #0d1a12 0%, #1a2e1e 100%)',
    textColor: '#e0e8de',
    textColor2: '#8a9e88',
    featureColor: '#8a9e88',
    accentDot: '#5ccc6a',
    frameShadow: '0 20px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
    frameBorder: '1px solid rgba(255,255,255,0.08)',
    subtitle: '暗森主题，沉浸感十足。',
  },
];

function buildWrapperHtml(theme) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px;
    height: 800px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${theme.bg};
    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    overflow: hidden;
  }
  .phone-frame {
    width: 420px;
    height: 600px;
    border-radius: 12px;
    box-shadow: ${theme.frameShadow};
    overflow: hidden;
    border: ${theme.frameBorder};
  }
  .phone-frame iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  .side-text {
    margin-left: 60px;
    max-width: 320px;
  }
  .side-text h1 {
    font-size: 28px;
    font-weight: 600;
    color: ${theme.textColor};
    margin-bottom: 12px;
    letter-spacing: -0.02em;
  }
  .side-text p {
    font-size: 15px;
    line-height: 1.7;
    color: ${theme.textColor2};
  }
  .side-text .features {
    margin-top: 20px;
    list-style: none;
  }
  .side-text .features li {
    font-size: 14px;
    color: ${theme.featureColor};
    padding: 6px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .side-text .features li::before {
    content: '';
    width: 6px;
    height: 6px;
    background: ${theme.accentDot};
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
</head>
<body>
  <div class="phone-frame">
    <iframe id="popup-frame" src="popup.html"></iframe>
  </div>
  <div class="side-text">
    <h1>AI HOT Notifier</h1>
    <p>${theme.subtitle}</p>
    <ul class="features">
      <li>精选 + 全量两种模式</li>
      <li>桌面通知即时推送</li>
      <li>双主题 / 字体风格可选</li>
      <li>轻量无依赖，隐私友好</li>
    </ul>
  </div>
</body>
</html>`;
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  for (const theme of themes) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

    const wrapperPath = resolve(__dirname, `_wrapper_${theme.name}.html`);
    writeFileSync(wrapperPath, buildWrapperHtml(theme), 'utf-8');

    await page.goto(`file:///${wrapperPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));

    const frame = page.frames().find(f => f.url().includes('popup.html'));
    if (frame) {
      await frame.evaluate((themeName, items, catClass) => {
        document.documentElement.setAttribute('data-theme', themeName);
        document.body.setAttribute('data-theme', themeName);

        const list = document.getElementById('historyList');
        const unreadCount = document.getElementById('unreadCount');

        list.innerHTML = '';
        unreadCount.textContent = items.length > 999 ? '999+' : String(items.length);
        unreadCount.title = `${items.length} 条未读`;
        unreadCount.classList.add('show');
        document.getElementById('markAllRead').classList.add('visible');

        const now = Date.now();
        items.forEach((item, i) => {
          const div = document.createElement('div');
          const isUnread = i < 4;
          div.className = `item ${isUnread ? 'unread' : 'read'}`;

          const time = new Date(now - item.minutesAgo * 60 * 1000);
          const timeStr = `${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}`;
          const cls = catClass[item.category] || 'cat-default';

          div.innerHTML = `
            <div class="item-body">
              <div class="item-title">${item.title}</div>
              <div class="item-summary">${item.summary}</div>
              <div class="item-meta">
                <span class="cat-tag ${cls}">${item.category}</span>
                <span class="sep"></span>
                <span>${timeStr}</span>
              </div>
            </div>
          `;
          list.appendChild(div);
        });
      }, theme.name, mockItems, catClass);
    }

    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 1500));

    const outPath = resolve(STORE_DIR, theme.filename);
    await page.screenshot({ path: outPath });
    console.log(`✓ ${theme.filename}`);

    await page.close();
    unlinkSync(wrapperPath);
  }

  // ---- 宣传图 440x280（双主题卡片堆叠拼接） ----
  console.log('');

  const promoHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 440px;
    height: 280px;
    background:
      linear-gradient(112deg, #1a1a2e 0%, #16213e 49.8%, #1a2e1e 50%, #0d1a12 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  .cards {
    position: relative;
    width: 280px;
    height: 240px;
  }
  .card {
    position: absolute;
    width: 180px;
    height: 260px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2);
  }
  .card iframe {
    width: 420px;
    height: 600px;
    border: none;
    transform: scale(0.4286);
    transform-origin: top left;
  }
  .card-1 {
    left: 10px; top: 10px; z-index: 1;
    transform: rotate(-5deg);
    border: 1px solid rgba(255,255,255,0.1);
  }
  .card-2 {
    left: 95px; top: 0px; z-index: 2;
    transform: rotate(4deg);
    border: 1px solid rgba(255,255,255,0.12);
  }
</style>
</head>
<body>
  <div class="cards">
    <div class="card card-1"><iframe src="popup.html" data-theme="dark"></iframe></div>
    <div class="card card-2"><iframe src="popup.html" data-theme="green-dark"></iframe></div>
  </div>
</body>
</html>`;

  const promoThemes = ['dark', 'green-dark'];
  const promoItems = mockItems.slice(0, 5);

  const promoPage = await browser.newPage();
  await promoPage.setViewport({ width: 440, height: 280, deviceScaleFactor: 2 });

  const promoWrapperPath = resolve(__dirname, '_wrapper_promo.html');
  writeFileSync(promoWrapperPath, promoHtml, 'utf-8');

  await promoPage.goto(`file:///${promoWrapperPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const promoFrames = promoPage.frames().filter(f => f.url().includes('popup.html'));
  for (let i = 0; i < promoFrames.length; i++) {
    const themeName = promoThemes[i] || 'dark';
    await promoFrames[i].evaluate((themeName, items, catClass) => {
      document.documentElement.setAttribute('data-theme', themeName);
      document.body.setAttribute('data-theme', themeName);

      const list = document.getElementById('historyList');
      const unreadCount = document.getElementById('unreadCount');

      list.innerHTML = '';
      unreadCount.textContent = items.length > 999 ? '999+' : String(items.length);
      unreadCount.title = `${items.length} 条未读`;
      unreadCount.classList.add('show');
      document.getElementById('markAllRead').classList.add('visible');

      const now = Date.now();
      items.forEach((item, idx) => {
        const div = document.createElement('div');
        const isUnread = idx < 3;
        div.className = `item ${isUnread ? 'unread' : 'read'}`;

        const time = new Date(now - item.minutesAgo * 60 * 1000);
        const timeStr = `${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}`;
        const cls = catClass[item.category] || 'cat-default';

        div.innerHTML = `
          <div class="item-body">
            <div class="item-title">${item.title}</div>
            <div class="item-summary">${item.summary}</div>
            <div class="item-meta">
              <span class="cat-tag ${cls}">${item.category}</span>
              <span class="sep"></span>
              <span>${timeStr}</span>
            </div>
          </div>
        `;
        list.appendChild(div);
      });
    }, themeName, promoItems, catClass);
  }

  await promoPage.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 2000));

  await promoPage.screenshot({ path: resolve(STORE_DIR, 'promo-440x280.png') });
  console.log('✓ promo-440x280.png');

  await promoPage.close();
  unlinkSync(promoWrapperPath);

  await browser.close();
  console.log(`\nDone! ${themes.length} screenshots + 1 promo tile saved to store/`);
})();
