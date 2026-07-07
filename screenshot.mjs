/**
 * 生成 Chrome Web Store 全部商店素材：
 *   - 4 张主题截图（1280x800）
 *   - 1 张宣传图（440x280）
 *   - 1 张顶部宣传图块（1400x560 JPEG）
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

const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const PROMO_WIDTH = 440;
const PROMO_HEIGHT = 280;
const MARQUEE_WIDTH = 1400;
const MARQUEE_HEIGHT = 560;

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
    accentDot: '#f2bc90',
    frameShadow: '0 20px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
    frameBorder: '1px solid rgba(255,255,255,0.08)',
    subtitle: '墨夜主题，夜间阅读更舒适。',
  },
  {
    name: 'green-dark',
    filename: 'screenshot-green-dark.png',
    bg: 'linear-gradient(135deg, #0c0f10 0%, #1a2022 100%)',
    textColor: '#e0e8de',
    textColor2: '#99a5a7',
    featureColor: '#99a5a7',
    accentDot: '#8fb2b8',
    frameShadow: '0 20px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
    frameBorder: '1px solid rgba(255,255,255,0.08)',
    subtitle: '暗森主题，沉浸感十足。',
  },
  {
    name: 'chrome-dark',
    filename: 'screenshot-chrome-dark.png',
    bg: 'linear-gradient(135deg, #151922 0%, #222832 100%)',
    textColor: '#f1f3f4',
    textColor2: '#b4bac0',
    featureColor: '#b4bac0',
    accentDot: '#96c8ee',
    frameShadow: '0 20px 60px rgba(0,0,0,0.42), 0 4px 16px rgba(0,0,0,0.32)',
    frameBorder: '1px solid rgba(232,234,237,0.14)',
    subtitle: '铬墨主题，清晰克制的深色界面。',
  },
  {
    name: 'slate-night',
    filename: 'screenshot-slate-night.png',
    bg: 'linear-gradient(135deg, #0b1418 0%, #19262c 100%)',
    textColor: '#f0f6fc',
    textColor2: '#adb7c1',
    featureColor: '#adb7c1',
    accentDot: '#4bb6af',
    frameShadow: '0 20px 60px rgba(1,4,9,0.45), 0 4px 16px rgba(1,4,9,0.34)',
    frameBorder: '1px solid rgba(201,209,217,0.14)',
    subtitle: '石青主题，为高密度资讯扫描设计。',
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
    width: ${SCREENSHOT_WIDTH}px;
    height: ${SCREENSHOT_HEIGHT}px;
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
</style>
</head>
<body>
  <div class="phone-frame">
    <iframe id="popup-frame" src="popup.html"></iframe>
  </div>
</body>
</html>`;
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  for (const theme of themes) {
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT, deviceScaleFactor: 1 });

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
        list.innerHTML = '';
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
    width: ${PROMO_WIDTH}px;
    height: ${PROMO_HEIGHT}px;
    background:
      linear-gradient(112deg, #1a1a2e 0%, #16213e 25%, #0c0f10 25.2%, #1a2022 50%, #222832 50.2%, #151922 75%, #0b1418 75.2%, #19262c 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  .cards {
    position: relative;
    width: 392px;
    height: 252px;
  }
  .card {
    position: absolute;
    width: 158px;
    height: 228px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2);
  }
  .card iframe {
    width: 420px;
    height: 600px;
    border: none;
    transform: scale(0.3762);
    transform-origin: top left;
  }
  .card-1 {
    left: 0; top: 24px; z-index: 1;
    transform: rotate(-7deg);
    border: 1px solid rgba(255,255,255,0.1);
  }
  .card-2 {
    left: 78px; top: 6px; z-index: 2;
    transform: rotate(-2deg);
    border: 1px solid rgba(255,255,255,0.12);
  }
  .card-3 {
    left: 156px; top: 24px; z-index: 3;
    transform: rotate(3deg);
    border: 1px solid rgba(232,234,237,0.14);
  }
  .card-4 {
    left: 234px; top: 6px; z-index: 4;
    transform: rotate(7deg);
    border: 1px solid rgba(75,182,175,0.22);
  }
</style>
</head>
<body>
  <div class="cards">
    <div class="card card-1"><iframe src="popup.html" data-theme="dark"></iframe></div>
    <div class="card card-2"><iframe src="popup.html" data-theme="green-dark"></iframe></div>
    <div class="card card-3"><iframe src="popup.html" data-theme="chrome-dark"></iframe></div>
    <div class="card card-4"><iframe src="popup.html" data-theme="slate-night"></iframe></div>
  </div>
</body>
</html>`;

  const promoThemes = ['dark', 'green-dark', 'chrome-dark', 'slate-night'];
  const promoItems = mockItems.slice(0, 5);

  const promoPage = await browser.newPage();
  await promoPage.setViewport({ width: PROMO_WIDTH, height: PROMO_HEIGHT, deviceScaleFactor: 1 });

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
      list.innerHTML = '';
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

  // ---- 顶部宣传图块 / Marquee image 1400x560 ----
  console.log('');

  const marqueeHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${MARQUEE_WIDTH}px;
    height: ${MARQUEE_HEIGHT}px;
    background:
      radial-gradient(circle at 80% 42%, rgba(75,182,175,0.16), transparent 28%),
      radial-gradient(circle at 68% 42%, rgba(150,200,238,0.16), transparent 30%),
      linear-gradient(118deg, #151922 0%, #111827 38%, #0c0f10 68%, #0b1418 100%);
    overflow: hidden;
    position: relative;
    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: #f1f3f4;
  }
  .copy {
    position: absolute;
    left: 110px;
    top: 158px;
    width: 420px;
  }
  h1 {
    font-size: 56px;
    line-height: 1.02;
    font-weight: 700;
    letter-spacing: 0;
    margin-bottom: 22px;
  }
  h1 .brand-ai {
    color: #f1f3f4;
  }
  h1 .brand-hot {
    color: #f1f3f4;
  }
  h1 .brand-rest {
    color: #f1f3f4;
  }
  p {
    font-size: 24px;
    line-height: 1.45;
    color: #b4bac0;
  }
  .cards {
    position: absolute;
    right: 50px;
    top: 70px;
    width: 740px;
    height: 420px;
  }
  .card {
    position: absolute;
    width: 260px;
    height: 372px;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 22px 70px rgba(0,0,0,0.44);
  }
  .card iframe {
    width: 420px;
    height: 600px;
    border: none;
    transform: scale(0.619);
    transform-origin: top left;
  }
  .card-1 {
    left: 0;
    top: 32px;
    z-index: 1;
    transform: rotate(-6deg);
    border: 1px solid rgba(242,188,144,0.24);
  }
  .card-2 {
    left: 160px;
    top: 6px;
    z-index: 2;
    transform: rotate(-2deg);
    border: 1px solid rgba(143,178,184,0.22);
  }
  .card-3 {
    left: 320px;
    top: 32px;
    z-index: 3;
    transform: rotate(3deg);
    border: 1px solid rgba(150,200,238,0.24);
  }
  .card-4 {
    left: 480px;
    top: 6px;
    z-index: 4;
    transform: rotate(7deg);
    border: 1px solid rgba(75,182,175,0.22);
  }
</style>
</head>
<body>
  <div class="copy">
    <h1><span class="brand-ai">AI</span> <span class="brand-hot">HOT</span><br><span class="brand-rest">Notifier</span></h1>
    <p>实时监控 AI HOT 资讯，新内容即时桌面通知。</p>
  </div>
  <div class="cards">
    <div class="card card-1"><iframe src="popup.html"></iframe></div>
    <div class="card card-2"><iframe src="popup.html"></iframe></div>
    <div class="card card-3"><iframe src="popup.html"></iframe></div>
    <div class="card card-4"><iframe src="popup.html"></iframe></div>
  </div>
</body>
</html>`;

  const marqueeThemes = ['dark', 'green-dark', 'chrome-dark', 'slate-night'];
  const marqueeItems = mockItems.slice(0, 5);
  const marqueePage = await browser.newPage();
  await marqueePage.setViewport({ width: MARQUEE_WIDTH, height: MARQUEE_HEIGHT, deviceScaleFactor: 1 });

  const marqueeWrapperPath = resolve(__dirname, '_wrapper_marquee.html');
  writeFileSync(marqueeWrapperPath, marqueeHtml, 'utf-8');

  await marqueePage.goto(`file:///${marqueeWrapperPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const marqueeFrames = marqueePage.frames().filter(f => f.url().includes('popup.html'));
  for (let i = 0; i < marqueeFrames.length; i++) {
    const themeName = marqueeThemes[i] || 'dark';
    await marqueeFrames[i].evaluate((themeName, items, catClass) => {
      document.documentElement.setAttribute('data-theme', themeName);
      document.body.setAttribute('data-theme', themeName);

      const list = document.getElementById('historyList');
      list.innerHTML = '';
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
    }, themeName, marqueeItems, catClass);
  }

  await marqueePage.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 2000));

  await marqueePage.screenshot({
    path: resolve(STORE_DIR, 'marquee-1400x560.jpg'),
    type: 'jpeg',
    quality: 95,
  });
  console.log('✓ marquee-1400x560.jpg');

  await marqueePage.close();
  unlinkSync(marqueeWrapperPath);

  await browser.close();
  console.log(`\nDone! ${themes.length} screenshots + 1 promo tile + 1 marquee image saved to store/`);
})();
