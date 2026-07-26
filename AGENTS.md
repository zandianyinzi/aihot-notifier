# Repository Guidelines

## 项目结构与模块组织

本仓库是一个无构建依赖的 Chrome/Edge Manifest V3 扩展。核心文件位于仓库根目录：

- `manifest.json`：声明权限、图标、弹窗入口和后台 Service Worker。
- `background.js`：负责轮询 AI HOT API、分页、去重、通知、badge 和 `chrome.storage.local` 存储。
- `popup.html` / `popup.js`：实现弹窗界面、列表渲染、已读状态和设置交互。
- `icons/`：扩展图标，包含 16、32、48、128px 等尺寸。
- `store/`：Chrome Web Store 文案、隐私政策和截图素材。
- `test*.js`：独立 Node 测试脚本，目前没有单独的 `tests/` 目录。
- 设置面板按 `常规 / 外观 / 特关 / 调试` 分组，默认不展开任何分组；主列表 hover 只使用整行轻压暗反馈，不使用左侧或右侧颜色条；特关规则首行保持 `来源 / 作者 / 停用 / 删除` 同行，来源完整显示，作者在操作按钮前省略，关键词只在存在时另起一行；除输入框外，弹窗内其它区域不应出现文本插入光标。

## 构建、测试与开发命令

- `node test.js`：运行纯逻辑测试，覆盖去重、排序、时间窗口和 API URL。
- `node test-notification.js`：使用 mock 的 Chrome API 验证通知和 badge 逻辑。
- `node test-background.js`：直接加载真实 `background.js`，验证消息通道、fingerprint、分页和失败语义。
- `node test-e2e.js`：请求 `https://aihot.virxact.com`，验证线上 API 数据假设。
- `bash pack.sh`：生成用于分发的 `aihot-notifier.zip`；Windows 无 bash 时使用 PowerShell `Compress-Archive`，保持包内只含清单、JS、HTML、`fonts/`、`icons/`。
- `node screenshot.mjs`：重新生成商店截图；首次使用前执行 `npm install --no-save puppeteer`。

仓库没有 `package.json`。除非明确切换到 Node 包管理流程，否则不要新增依赖清单。

## 代码风格与命名约定

使用原生 JavaScript、HTML 和 CSS。保持 2 空格缩进、语句分号、变量和函数使用 `camelCase`。固定配置可使用大写常量，例如 API 基础地址或时间限制。优先保持逻辑直观，必要时拆成小型 helper 函数。

修改 UI 时，将结构和样式留在 `popup.html`，状态管理和事件处理放在 `popup.js`。注意 Manifest V3 限制：`background.js` 是 Service Worker，不是持久后台页。

## 测试指南

修改逻辑前后至少运行 `node test.js`、`node test-notification.js` 和相关 UI/API 测试。涉及 background 消息、fingerprint、分页或失败语义时运行 `node test-background.js`；涉及线上 feed 假设时运行 `node test-e2e.js`。新增测试使用 `test-*.js` 命名，并确保可直接用 Node 执行。

## 发布流程

常规代码或文档改动不要自动升级 `manifest.json` 版本号。只有明确准备发布 / 上架新包时，才升级版本号并打包。

发布时按顺序执行：
1. 按发布语义升级 `manifest.json` 中的版本号
2. 打包（`bash pack.sh` 或 PowerShell `Compress-Archive`）
3. commit + push

## 提交与 Pull Request 规范

近期提交多为简短祈使句，部分使用 Conventional Commit 前缀，例如 `perf: eliminate theme FOUC`、`fix polling miss due to insufficient API delay buffer`。提交标题应说明具体行为变化。

PR 需包含变更摘要、已运行的测试命令。涉及界面变化时附截图或更新 `store/` 素材；涉及权限、存储结构或 API 行为变化时需单独说明。

## 安全与配置提示

保持 `host_permissions` 限定为 `https://aihot.virxact.com/*`。不要提交 `node_modules/`、生成的 zip、密钥或本地浏览器 profile。变更存储 key 时，尽量兼容已有 `chrome.storage.local` 数据。
