# AI HOT Notifier

Chrome 浏览器扩展，通过 [aihot.news](https://aihot.news/) 的公开 API 获取 AI HOT 新内容并推送桌面通知。扩展运行无需构建步骤或第三方依赖；截图等开发工具需要另行安装依赖。

## 功能

- 定时轮询 AI 资讯，发现新内容弹出桌面通知
- 点击通知或列表条目跳转原文
- 资讯列表带标题 + 摘要，每条资讯按本地时间显示 `MM/DD HH:mm`
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

也可解压本地生成的 `aihot-notifier.zip`，加载其中直接包含 `manifest.json` 的目录。若提示 `Filenames starting with "_" are reserved`，检查加载目录中的临时文件：不要把 `_click-check.mjs` 这类以下划线开头的自建文件留在扩展目录里；加入 `.gitignore` 不会影响 Chrome 的加载检查。

### 更新

重复上述步骤，或在扩展管理页点击刷新按钮。

## 使用

- 点击工具栏图标打开资讯列表
- 点击标题「AI HOT」跳转官网
- 点击刷新按钮立即拉取最新内容
- 自由浏览模式会保存阅读位置，刷新或重新打开时优先恢复原条目位置
- 显示天数默认为 1 天，范围按最近 N × 24 小时计算；日期分组按本地自然日计算，因此显示 1 天也可能跨两个日期
- 特关未读内容在顶部单独按日期分组；本次弹窗内读完后仍保持位置，重新打开后已读特关回到普通时间线
- 有未读内容时，点击右上角「全部已读」按钮可批量清除未读状态；切换内容源后同一条目仍保持已读
- 点击设置按钮展开配置面板：
  - **常规**：通知推送、检查频率、定位、内容源、显示天数
  - **外观**：主题、字体、字号
  - **特关**：来源 / 作者 / 关键词（支持中英文逗号分隔，英文不区分大小写）；规则从上到下代表优先级，可用右侧上移/下移按钮调整；命中多条规则时按最高优先级置顶，规则列表首行展示来源、作者和启停/删除操作，关键词仅在已设置时另起一行
  - **调试**：拷贝日志

设置面板每次打开时，四个分组默认全部收起。

## 开发与发布

- `node test.js`：运行纯逻辑示例与兼容性测试；其中仍有历史重建模型，当前内容源切换行为以 `test-background.js` 对真实代码的验证为准。
- `node test-notification.js`：使用 mock 的 Chrome API 验证通知和 badge 逻辑。
- `node test-background.js`：直接加载真实 `background.js`，验证消息通道和失败语义。
- `node test-popup-ui.js`：验证弹窗设置、特关和光标等 UI 约束。
- `node test-feed-state.js`：验证全部/精选内容源的共享投影规则。
- `node test-popup-reliability.js`：验证异步加载、设置回滚和特关置顶等控制器行为。
- `node test-popup-scroll.js`：加载真实弹窗脚本，验证刷新、重开和特关场景下的阅读位置。
- `node test-e2e.js`：请求 `https://aihot.news/api/v1/items`，验证线上 API 数据假设；其中的简化模拟不替代真实后台回归测试。
- `python3 scripts/generate-logo.py`：重新生成扩展图标 PNG；需要 `Pillow`。
- `node screenshot.mjs`：重新生成 Chrome Web Store 截图和宣传图；首次使用前执行 `npm install --no-save puppeteer`。
- `bash pack.sh`：生成可上传 Chrome Web Store 的 `aihot-notifier.zip`；Windows 无 bash 时可用 PowerShell `Compress-Archive` 打包同一文件集合。

仅在明确发布时升级 `manifest.json` 版本号，随后运行测试、打包、提交并推送源码与发布 ZIP；推送不代表已上传或通过 Chrome Web Store 审核。打包文件白名单以 `pack.sh` 为准，禁止打入调试脚本、测试、依赖或浏览器 profile。

`check-changes.sh` 是语法和基础逻辑的快速检查，不替代上面的通知、后台及弹窗测试。公开隐私政策源文件为根目录 [privacy-policy.html](privacy-policy.html)，`store/privacy-policy.html` 是商店素材副本，修改时同步内容。

## 界面约束

弹窗使用轻量的主题与控件状态模板，避免不同按钮各自定义一套反馈：

- 主题强调反馈使用 `--accent` / `--accent-soft`，失败反馈使用 `--state-fail`。
- 主列表 hover 只使用整行轻压暗反馈；未读和特关未读不使用左侧/右侧颜色条，状态由未读底色、标题颜色、置顶和标签表达。标题字重始终为 500，避免已读切换时字宽变化导致换行位移。
- 日期与时间在条目元信息中统一补零显示为 `MM/DD HH:mm`，沿用元信息的次级文字层级；主列表不显示悬浮日期胶囊。
- 菜单图标使用原生 `title` 悬浮提示，字体和字号由浏览器/操作系统决定，不跟随扩展设置。
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
- 权限为 `alarms`、`notifications`、`storage`，API 的 `host_permissions` 仅为 `https://aihot.news/*`。弹窗品牌链接目前仍指向 `https://aihot.virxact.com/`，它不参与 API 请求。
- 自动轮询和手动刷新直接请求 v1 items。首个完整 URL 使用 URL 级 `ETag` / `If-None-Match`，304 时跳过内容处理；当前不请求独立的 legacy fingerprint 端点，代码中的同名 helper/存储 key 是兼容命名。
- API URL 为 `https://aihot.news/api/v1/items?mode=<selected|all>&window=7d&limit=100&cursor=<nextCursor>`（首页不带 cursor）。响应为 `{ items, page: { hasMore, nextCursor } }`，cursor 作为 opaque 值原样传回。请求固定使用 7 天窗口，不携带 `since`，单次请求含响应解码限时 15 秒。条目来源为 `source.name`，原文链接优先使用 HTTPS 的 `links.original`，否则回退到 HTTPS 的 `links.aihot`；发布时间无效时回退 `indexedAt`，二者均无效则跳过。
- 手动刷新最多拉 3 页。切换到全部内容时先拉 1 页，后续通过可恢复的 `allFeedContinuation` 续拉；自动全部轮询达到单批页数上限时也保存续拉状态。只有分页未截断且 history 持久化成功，才提交新的 URL 级 ETag / `lastItemsPollAt`。
- 内容源切换先在弹窗内按目标模式投影已有缓存，再请求网络。后台合并 canonical history 并成功持久化后才提交新的 `feedMode`；失败保留旧 history 和旧模式，过期切换结果不能覆盖后来的选择。
- 精选请求返回的条目标记为 `selected: true`；全部请求仅在响应明确给出 `selected` 时更新该字段。`SUPPORTS_CONSISTENT_SELECTED_SNAPSHOT` 当前为 false，不能仅因某条目未出现在精选响应中就取消其精选标记。
- 扩展保留 canonical history，不因内容源切换清空既有记录。存储保留 `Math.max(historyDays, 5)` 天窗口内的数据（同时考虑发布时间与发现时间），UI 和 badge 仅按发布时间过滤最近 `historyDays` 天。每次持久化最多保留 2500 条最新内容，并限制标题 500、来源 300、摘要 3000 字符。history、已读、特关提醒和最近条目的合计 JSON 使用 6 MiB UTF-8 预算，遇到 quota 会以更小 history 重试一次。
- 已读/特关状态优先使用稳定 key（`id` / `permalink` / `url`），并兼容旧 URL 数据
- 全局 `readAllBefore` 和单条 `readIds` 共同决定已读状态，切换内容源不重置已读。后台负责串行持久化；打开条目时先创建标签页，成功后再提交已读/已查看状态。
- 特关同一规则内的来源、作者和关键词条件同时满足才命中，多个关键词命中任意一个即可。未查看的特关最多提醒 3 次，计划时间相对 `firstMatchedAt` 为立即、8 小时、24 小时，到期后由轮询检查，每轮最多发送 3 条。查看、全部已读或停用对应规则会抑制后续提醒；手动刷新与内容源切换当次不弹通知。

## 文件结构

```
aihot-notifier/
├── manifest.json    # 扩展配置
├── background.js    # 后台轮询与通知逻辑
├── feed-state.js    # 后台与弹窗共享的内容源投影
├── popup-reliability.js # 异步加载、回滚与滚动位置控制器
├── popup-log.js     # 本地弹窗性能日志
├── popup-boot.js    # 弹窗首屏主题/字体预加载
├── popup.html       # 弹出窗口界面
├── popup.js         # 弹出窗口交互逻辑
├── screenshot.mjs   # 商店截图和宣传图生成脚本
├── scripts/         # 开发辅助脚本
├── store/           # Chrome Web Store 文案与截图素材
├── fonts/           # 随包保留的字体资源与许可
├── icons/           # 扩展图标 (16/32/48/128px)
├── test*.js         # 可直接用 Node 执行的测试脚本
├── pack.sh          # 扩展打包脚本
└── README.md
```

## 文档入口

当前使用方法与实现约定以本 README 为准；历史设计、实施计划和回归记录见 [文档索引](docs/README.md)。历史文档中的未勾选步骤不代表当前待办，旧接口、主题和尺寸须对照当前代码验证。

