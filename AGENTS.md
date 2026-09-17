# 项目 Agent 约定

适用于在本仓库工作的 Codex 与 Claude Code。AGENTS.md 是唯一规则源文件；CLAUDE.md 是指向 AGENTS.md 的相对软链接，修改约定时只维护 AGENTS.md。现役机制详见 [README](README.md)，历史记录见 [文档索引](docs/README.md)。

Windows 检出须设置 Git `core.symlinks=true` 并具备创建软链接权限，避免将链接检出为普通文本文件。

## 项目概述

Chrome 扩展（Manifest V3），通过 aihot.news API 获取 AI HOT 资讯并推送桌面通知。纯前端，运行时无构建步骤、无第三方依赖；截图工具需 Puppeteer，图标生成需 Pillow。

## 命令

```bash
# 打包为 zip（排除无关文件）
./pack.sh
# Windows/PowerShell 无 bash 时使用 Compress-Archive，保持包内只含 manifest、JS、HTML、fonts/、icons/

# 单元测试（纯逻辑验证，不需要浏览器）
node test.js
node test-notification.js
node test-popup-ui.js
node test-feed-state.js
node test-popup-reliability.js
node test-popup-scroll.js
node test-background.js

# 端到端测试（直接请求 API 验证数据逻辑）
node test-e2e.js

# 重新生成 Chrome Web Store 截图和宣传图
node screenshot.mjs
```

## 架构

- **background.js** — Service Worker。定时轮询 API、去重、存储 history、发通知、管理 badge 计数。核心函数：`pollForUpdates()`（定时触发）、`manualPoll()`（用户手动刷新）、`resetAndPoll()`（切换 feedMode 时拉取并合并 canonical history）、`updateBadge()`（badge 未读数）。
- **popup.html + popup.js** — 弹窗 UI。读取 storage 渲染资讯列表，管理已读状态和设置面板。通知开关/轮询间隔变更通过 `chrome.runtime.sendMessage` 通知 background；外观类设置仅本地保存和重渲染。设置面板按 `常规 / 外观 / 特关 / 调试` 分组，打开设置时默认不展开任何分组。
- **feed-state.js / popup-reliability.js** — 分别提供共享内容源投影，以及弹窗异步加载、回滚、特关会话置顶和滚动恢复控制器。
- **manifest.json** — 权限：alarms、notifications、storage。host_permissions 仅为 `https://aihot.news/*`。

## 代码风格与命名约定

使用原生 JavaScript、HTML 和 CSS。保持 2 空格缩进、语句分号、变量和函数使用 `camelCase`。固定配置可使用大写常量，例如 API 基础地址或时间限制。优先保持逻辑直观，必要时拆成小型 helper 函数。

修改 UI 时，将结构和样式留在 `popup.html`，状态管理和事件处理放在 `popup.js`。注意 Manifest V3 限制：`background.js` 是 Service Worker，不是持久后台页。

## 测试指南

修改逻辑前后至少运行 `node test.js`、`node test-notification.js` 和相关 UI/API 测试。涉及 background 消息、ETag、分页或失败语义时运行 `node test-background.js`；涉及线上 feed 假设时运行 `node test-e2e.js`。新增测试使用 `test-*.js` 命名，并确保可直接用 Node 执行。部分旧测试使用简化模拟，不能替代真实后台/弹窗测试。

## UI 约定

- 设置面板使用原生折叠分组，打开设置时默认不展开任何分组。
- 主列表 hover 只使用整行轻压暗反馈，不使用左侧或右侧 hover 颜色条；未读/特关未读只用未读底色和标题颜色作为状态信号。标题字重恒定 500，不随已读状态切换——字重会改变字宽，在 2 行 line-clamp 边界触发重排，导致标题位移。已读靠标题颜色变暗后退区分。
- 分组标题、按钮和标签沿用主题色与低对比度层级，不把说明性文字做成高亮主视觉。
- 日期浮标按本地日期显示补零 `MM/DD`，字体跟随设置；固定字号 10px、字重 500、内边距 `2px 6px`，宽度随内容自适应。菜单原生 `title` 提示由浏览器控制。
- 特关规则项首行保持 `来源 / 作者 / 停用 / 删除` 同行：来源完整显示，作者在操作按钮前省略；关键词只在存在时另起一行并横向展开，不为空关键词预留位置。
- 除输入框外，弹窗内其它交互区域不应出现文本插入光标。
- 全部已读按钮确认动效：750ms ease-out，轻微缩放(1.03)，渐进淡出。动效期间保持可见，结束后检查未读数再决定是否隐藏。

## 关键设计决策

- **已读状态**：`readIds` 保存单条稳定 key（优先 `id`，再 `permalink`，再 `url`，并兼容旧 URL）+ `readAllBefore` 时间戳（批量清除）。两者共同决定是否已读。
- **存储 vs 显示**：storage 保留 `Math.max(historyDays, 5)` 天数据避免切换天数时丢失；UI 和 badge 按用户设置的 `historyDays` 过滤显示。
- **API 轮询缓冲**：自动轮询和手动刷新对完整 v1 items URL 使用 URL 级 `ETag`/`If-None-Match`；304 跳过内容处理，200 成功持久化后保存该 URL 的 ETag。v1 请求固定使用 7 天窗口，不携带 legacy `since` 参数；手动刷新 items 最多拉 3 页。
- **feedMode 切换**：弹窗先投影已有缓存，后台拉取并合并 canonical history，持久化成功后才提交新的 feedMode；失败保留旧 history 和旧模式。旧请求结果不能覆盖新选择，不能因切换清空历史。
- **canonical history 限额**：内容源切换和轮询都合并既有 history，不因切换清空记录；持久化前最多保留 2500 条最新条目，标题/来源/摘要分别限制 500/300/3000 字符。history、readIds、watchNotifyState、lastItems 合计控制在 6 MiB UTF-8 JSON，quota 失败时只重试一次更小 history。
- **内容源默认值**：`normalizeFeedMode()` 默认返回 `all`（全部），未明确设置时显示全部内容。

## API

- 请求直接使用 v1 items；不再依赖 legacy fingerprint 端点。同名 helper 和存储 key 仅为兼容命名。
- `GET https://aihot.news/api/v1/items?mode={selected|all}&window=7d&limit=100&cursor={nextCursor}`：v1 items 端点。响应为 `{ items: [...], page: { hasMore: bool, nextCursor: string|null } }`；以 `page.hasMore` 和 `page.nextCursor` 驱动分页，`cursor` 视为 opaque，原样传回。条目来源使用 `source.name`，链接使用 `links.original`（优先打开）和 `links.aihot`（permalink / HTTPS 回退）。

只有 items 分页未截断且 history 持久化成功后，才提交新的 URL 级 ETag / `lastItemsPollAt`。

`SUPPORTS_CONSISTENT_SELECTED_SNAPSHOT` 当前为 false；API 未保证一致快照前，不得依据响应中缺失某条目取消其精选标记。

## 发布流程

常规代码或文档改动不要自动升级 `manifest.json` 版本号。只有明确准备发布 / 上架新包时，才升级版本号并打包。

发布时按顺序执行：
1. 按发布语义升级 `manifest.json` 中的版本号
2. 打包（`bash pack.sh` 或 PowerShell `Compress-Archive`）
3. commit + push 源码；ZIP 仅保留本地，上传商店及审核是独立步骤

## 提交与 Pull Request 规范

近期提交多为简短祈使句，部分使用 Conventional Commit 前缀，例如 `perf: eliminate theme FOUC`、`fix polling miss due to insufficient API delay buffer`。提交标题应说明具体行为变化。

PR 需包含变更摘要、已运行的测试命令。涉及界面变化时附截图或更新 `store/` 素材；涉及权限、存储结构或 API 行为变化时需单独说明。

## 安全与配置提示

保持 `host_permissions` 限定为 `https://aihot.news/*`。不要提交 `node_modules/`、生成的 zip、密钥或本地浏览器 profile。变更存储 key 时，尽量兼容已有 `chrome.storage.local` 数据。

Chrome 不允许扩展加载目录出现自建的下划线前缀文件（例如 `_click-check.mjs`）；临时产物优先放在项目外，`.gitignore` 不会让 Chrome 忽略文件。打包严格沿用 `pack.sh` 白名单。

## 发布

- GitHub: https://github.com/zandianyinzi/aihot-notifier
- 隐私政策发布目标: https://zandianyinzi.github.io/aihot-notifier/privacy-policy.html （发布前确认可访问；推送不等于 Pages 已部署）
- Chrome Web Store 素材在 `store/` 目录
