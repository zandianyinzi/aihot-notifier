# AI HOT Notifier

Chrome 浏览器扩展，监控 [aihot.virxact.com](https://aihot.virxact.com/) 新内容并推送桌面通知。

## 功能

- 定时轮询 AI 资讯，发现新内容弹出桌面通知
- 点击通知或列表条目跳转原文
- 资讯列表带标题 + 摘要，按日期分组
- 已读/未读状态持久化，重启不丢失
- 支持自由浏览或打开时定位到第一条未读内容
- 支持一键全部已读，并使用与主题一致的短确认动画
- 支持四套主题（墨夜/暗森/铬墨/石青）
- 支持字体风格切换（系统/宋体/楷体）
- 支持字号调节（小/默认/大/特大/超大）
- 支持特关规则（来源/作者/关键词，多关键词支持中英文逗号分隔，英文不区分大小写）
- 可配置轮询间隔和显示天数

## 安装

### Chrome / Edge

1. 下载或克隆本项目
2. 打开浏览器，地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`）
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择 `aihot-notifier` 文件夹
6. 安装完成，工具栏出现 AI HOT 图标

### 更新

重复上述步骤，或在扩展管理页点击刷新按钮。

## 使用

- 点击工具栏图标打开资讯列表
- 点击标题「AI HOT」跳转官网
- 点击刷新按钮立即拉取最新内容
- 有未读内容时，点击右上角「全部已读」按钮可批量清除当前内容源的未读状态
- 点击设置按钮展开配置面板：
  - **常规**：通知推送、检查频率、定位、内容源、显示天数
  - **外观**：主题、字体、字号
  - **特关**：来源 / 作者 / 关键词（支持中英文逗号分隔，英文不区分大小写）；规则列表首行展示来源、作者和启停/删除操作，关键词仅在已设置时另起一行
  - **调试**：拷贝日志

## 开发与发布

- `node test.js`：运行纯逻辑测试，覆盖去重、排序、时间窗口和 API URL。
- `node test-notification.js`：使用 mock 的 Chrome API 验证通知和 badge 逻辑。
- `node test-background.js`：直接加载真实 `background.js`，验证消息通道和失败语义。
- `node test-popup-ui.js`：验证弹窗设置、特关和光标等 UI 约束。
- `node test-e2e.js`：请求 `https://aihot.virxact.com`，验证线上 API 数据假设。
- `python3 scripts/generate-logo.py`：重新生成扩展图标 PNG；需要 `Pillow`。
- `node screenshot.mjs`：重新生成 Chrome Web Store 截图和宣传图；首次使用前执行 `npm install --no-save puppeteer`。
- `bash pack.sh`：生成可上传 Chrome Web Store 的 `aihot-notifier.zip`；Windows 无 bash 时可用 PowerShell `Compress-Archive` 打包同一文件集合。

## 界面约束

弹窗使用轻量的主题与控件状态模板，避免不同按钮各自定义一套反馈：

- 主题强调反馈使用 `--accent` / `--accent-soft`，失败反馈使用 `--state-fail`。
- 主列表 hover 只使用整行轻压暗反馈；未读和特关未读不使用左侧/右侧颜色条，状态由未读底色、标题权重、置顶和标签表达。
- 图标按钮使用语义状态类：`is-loading`、`is-result-accent`、`is-result-danger`、`is-result-ok`、`is-confirmed`。
- 动效时长集中在 CSS token 中：点击反馈 `--motion-tap`、加载旋转 `--motion-loading`、本地确认 `--motion-confirm`、异步结果 `--motion-result`。

## 通知不弹出排查

- Windows 需要同时允许系统通知和 Chrome 通知发送方：打开「设置」→「系统」→「通知」，确认总开关已开启，并在应用列表中开启「Chrome」通知。
- 扩展内的「通知推送」也需要保持开启。
- 点击弹窗里的刷新按钮只会立即更新列表和角标，不会弹出桌面通知；桌面通知只在后台定时轮询发现新内容时弹出。

## 技术说明

- Manifest V3，Service Worker 后台运行
- 使用 `chrome.alarms` 定时轮询，系统重启后自动恢复
- 数据存储在浏览器本地存储中，主要使用 `chrome.storage.local`
- API 轮询采用 fingerprint-first：先请求 `GET https://aihot.virxact.com/api/public/fingerprint`，有变化或兜底到期后再请求 `GET https://aihot.virxact.com/api/public/items?mode=<selected|all>&since=<ISO-8601>&take=100&cursor=<nextCursor>`
- 已读/特关状态优先使用稳定 key（`id` / `permalink` / `url`），并兼容旧 URL 数据

## 文件结构

```
aihot-notifier/
├── manifest.json    # 扩展配置
├── background.js    # 后台轮询与通知逻辑
├── popup-boot.js    # 弹窗首屏主题/字体预加载
├── popup.html       # 弹出窗口界面
├── popup.js         # 弹出窗口交互逻辑
├── screenshot.mjs   # 商店截图和宣传图生成脚本
├── scripts/         # 开发辅助脚本
├── store/           # Chrome Web Store 文案与截图素材
├── fonts/           # 内置标题字体
├── icons/           # 扩展图标 (16/32/48/128px)
├── test*.js         # 可直接用 Node 执行的测试脚本
├── pack.sh          # 扩展打包脚本
└── README.md
```
