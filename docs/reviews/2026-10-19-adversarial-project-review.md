# AI HOT Notifier 多 Agent 对抗式审查与复审报告

> 原始审查：2026-10-16 至 2026-10-19  
> 独立复审基线：2026-10-19 10:22 当前未提交工作区  
> 性质：带日期边界的审查证据，不是现役行为合同。当前行为仍以 [`README.md`](../../README.md)、[`AGENTS.md`](../../AGENTS.md)、代码和可执行测试为准。

## 1. 执行摘要

原始审查通过多条独立审查线覆盖 UI 与主题、交互与无障碍、弹窗性能与加载速度、后台可靠性、数据模型、安全与隐私、测试质量、发布工程和可维护性。复审再次按发布、后台数据、UI/性能三条路径核验，并由主会话读取当前代码、发布 ZIP、Git 工作区和测试结果进行裁决。

复审发现原报告生成后，当前未提交工作区已经修复多项原始问题。因此本报告以复审基线重新定级：**当前工作树没有 Critical 或 High 级发现**。仍成立的主要问题是全量 `innerHTML` 重建和超大字号嵌套滚动，均为 Low–Medium；普通通知窄终止窗口和来源 title 测量为 Low。

### 1.1 当前仍成立的发现

| 严重度 | 类型 | 当前结论 |
| --- | --- | --- |
| Medium（条件性） | Release risk | 旧 ZIP 与开发中工作树不同；开发期符合项目约定，仅在误把旧 ZIP 当作新发布候选时构成风险 |
| Low–Medium | Performance risk | 内容变化时仍会全量拼接并替换列表 `innerHTML` |
| Low–Medium | UX risk | 超大字号、特关规则较多时存在隐藏滚动条与嵌套滚动 |
| Low | Reliability gap | 普通通知在 history 提交后、通知入队前存在窄 worker 终止窗口 |
| Low | Performance cost | 全量渲染后逐条测量来源宽度，会增加首次布局成本 |
| Low | Product presentation | 商店截图主要展示同一列表换色，未覆盖特关、设置和通知旅程 |

### 1.2 原始审查后已在当前工作树修复

| 原始发现 | 当前状态与证据 |
| --- | --- |
| 2500 条裁剪清空缓存外 `readIds` | 已修复；裁剪后保留缓存内 key 与最近 100 个缓存外 key，`test-background.js` 已覆盖 |
| 渲染签名包含标题和摘要全文 | 已修复；当前使用 32 位 FNV-1a 压缩渲染文本字段 |
| 主列表 scroll 事件未合并 | 已修复；当前按 `requestAnimationFrame` 合并，并有 burst 回归测试 |
| 未读跳转后焦点遗失 | 已修复；目标条目获得 `focus({ preventScroll: true })`，并有焦点测试 |
| 剪贴板拒绝时无反馈 | 已修复；按钮显示失败并向状态栏发布可读错误 |
| 弹窗性能日志无界增长 | 已修复；日志限制为最新 500 条 |
| 四主题保留未消费 token | 已修复；死 token 已删除，主题结构测试同步更新 |
| 当前包仍包含未使用 Fraunces 字体 | 已修复；当前源码和 `pack.sh` 已移除字体，只有旧 ZIP 仍保留历史资源 |

## 2. 审查方法与边界

### 2.1 审查范围

- UI、四套主题、字体、对比度、信息层级、密度和商店截图
- 键盘操作、ARIA、焦点、读屏、动效和滚动体验
- 弹窗冷启动、热缓存、DOM 构建、布局读取、日志和资源体积
- MV3 Service Worker 生命周期、alarm、并发、ETag、分页、退避和 quota
- identity/alias、时间字段、已读水位、watch rules 和 feed 投影
- manifest、CSP、XSS、URL、消息边界、隐私政策和打包白名单
- mock 与真实 Chrome/API 的差异、测试盲区和发布产物一致性

### 2.2 证据标准

每项结论区分 confirmed bug、plausible risk 和 design improvement，并要求给出代码路径、触发条件、影响、反证和最小修复方向。复审不把旧提交或旧 ZIP 的行为直接归因于当前工作树，也不使用文件修改时间作为发布一致性的硬判据。

### 2.3 未执行项目

- 未运行 `node test-e2e.js`，因为它会访问线上 API；本次审查没有向外发送请求。
- 未启动真实 Chrome Performance 录制，因此全量 DOM 重建和嵌套滚动的用户可感知程度仍需真机量化。
- 未重新打包、未修改 manifest 版本，也未修改产品实现。

## 3. 当前仍成立的发现

### 3.1 Medium（条件性）：开发期 ZIP 与工作树不同

**事实**

- 仓库中的 `aihot-notifier.zip` 和当前 [`manifest.json`](../../manifest.json) 都声明版本 `1.2.7`。
- ZIP 是可自洽运行的已发布旧实现：规则逻辑仍内置于旧 `background.js` 和 `popup.js`，不会因缺少 `watch-rules.js` 直接崩溃。
- 当前未提交工作树已把规则逻辑拆到 `watch-rules.js`，当前 [`pack.sh`](../../pack.sh) 也已将其纳入白名单。
- 旧 ZIP 仍含历史 Fraunces 字体；当前工作树已删除字体目录，当前 `pack.sh` 也不再打包字体。

**反证与定级**

当前差异来自 1.2.7 发布后尚未提交的开发改动。根据 [`AGENTS.md`](../../AGENTS.md)，常规代码和文档改动不应自动升级版本或重打 ZIP；只有明确准备发布时才升级、测试和打包。因此“工作树领先旧 ZIP”在开发期是预期状态，不是当前发布故障。

只有在准备新发布时仍误用旧 ZIP，才会出现同版本不同代码或漏发新功能，因此定为条件性 Medium，而非 High release blocker。

**建议**

1. 仅在明确发布时升级 manifest 版本并按当前 `pack.sh` 重新打包。
2. 发布流水线内校验所有 `importScripts()` 和 `<script src>` 引用均存在于 ZIP。
3. 发布流水线内比较 ZIP 与待发布源码的内容哈希；不要把“开发期工作树必须与旧 ZIP 同哈希”设为日常仓库不变量。
4. 不使用 mtime 判断产物新旧；跨机器检出、解压和复制都会改变时间戳。

### 3.2 Low–Medium：内容变化时仍全量重建列表 DOM

[`popup.js`](../../popup.js) 的 `renderHistory()` 在签名变化时仍会：

1. 投影并过滤全部 history；
2. 排序和拼接全部条目 HTML；
3. 执行 `historyList.innerHTML = html`；
4. 恢复滚动位置并刷新导航；
5. 测量全部来源节点的截断状态。

当前签名已经用 `hashRenderedText()` 压缩标题、来源、分类和摘要，不再创建包含全文摘要的巨大 JSON 字符串；signature skip 也会避免内容未变化时重复重建。因此原报告关于“10 MiB 全文签名”的量化不再适用于当前代码。

剩余风险是首次打开、history 变化、切换内容源或显示天数时的全量 DOM 替换。默认 1 天和常规数据量下可能无感，接近 2500 条上限时才可能成为明显卡顿；没有真实 Chromium 性能数据前不应定为 High。

**建议**

- 先建立 100、1000、2500 条的冷启动、切源、刷新和滚动基线。
- 若基线超预算，优先考虑分批渲染或具有稳定高度模型的窗口化。
- 不直接使用未经验证的 `content-visibility`/固有高度估算；历史布局事故表明它可能破坏滚动锚点。

### 3.3 Low–Medium：超大字号下的嵌套滚动

[`popup.html`](../../popup.html) 将 `.settings.open` 和 `.settings-inner` 都限制为 420px，特关规则列表另有独立滚动区域；这些区域均隐藏滚动条，主要依靠渐隐提示剩余内容。

在“超大字号 + 展开特关 + 多条规则”下，可能出现滚轮目标不明确和剩余内容不易发现。默认字号和规则较少时影响有限。

**建议**

- 尽量收敛为单层设置滚动；或按字号和剩余视口动态提升设置面板上限。
- 在真实 Windows Chrome 中验证滚轮、键盘和触控板跨嵌套区域的行为。

### 3.4 Low：普通通知的持久化后终止窗口

普通新内容的处理顺序大致为：持久化 canonical history → 更新 badge → 创建或入队普通通知。如果 MV3 worker 恰在 history 提交成功后、普通通知进入持久 pending queue 前被终止，该条目下次轮询不再属于 freshly inserted，桌面通知可能永久丢失。

该窗口很窄，数据和 badge 不会丢失，仅普通通知可能缺席。特关通知有持久化的 `watchNotifyState`，可在后续轮询补发，不共享此缺口。

**建议**

若普通通知被定义为 best effort，可保留现状并在可靠性边界中说明；若要求可恢复投递，则将待发送通知和 history 放入同一次持久提交。

### 3.5 Low：来源截断提示增加首次布局成本

`updateSourceTitles()` 在列表重建后遍历所有 `.item-source`，读取 `scrollWidth/clientWidth`，仅对真正被省略的来源设置原生 `title`。它不属于滚动热路径，但在大列表首次渲染后会增加一次全量几何读取。

**建议**

只有真机基线证明该阶段显著时再优化，可考虑仅测量视区附近条目或在空闲阶段分批处理；不应为消除一次布局读取而牺牲完整来源提示。

### 3.6 Low：商店截图未覆盖核心产品旅程

现有四张主题截图布局稳定、层级清楚，但主要是相同列表的主题换色。1280×800 画布中的 420×600 主体在商店缩略图下偏小，也没有展示特关规则、设置、通知和未读导航。

建议增加一张“特关规则管理”和一张“通知/未读导航”场景，而不是继续增加相同内容的主题截图；宣传画布颜色可从真实主题 token 生成，减少物料漂移。

## 4. 原始发现的修复复核

### 4.1 2500 条 readIds 裁剪

当前 `boundCanonicalStorageState()` 始终通过 `retainReadIdsForHistory(state.readIds, history)` 保留所有缓存内 key，以及按首次标记顺序计算的最近 100 个缓存外 key。

当前 `test-background.js` 已明确验证：

- 裁剪后保留缓存内已读 key；
- 最近读过的被裁条目可以作为缓存外 key 保留；
- 缓存外 key 上限为最近 100 个；
- 较早读过、超出最近 100 个的被裁条目按文档允许丢弃。

原始缺陷真实存在于旧基线，但已不适用于当前工作树。

### 4.2 渲染签名

当前 `popup-reliability.js` 使用 32 位 FNV-1a 对渲染文本字段做哈希，签名只保存小型哈希而非标题和摘要全文。原始 1500 条探针生成约 10 MiB 临时字符串的数据只描述旧实现，不应作为当前性能证据。

### 4.3 主列表 scroll 处理

当前主列表 scroll listener 只记录是否存在可信事件，并通过 `requestAnimationFrame(handleHistoryScrollFrame)` 将一帧内的事件合并为一次布局读取。`test-popup-scroll.js` 已验证一组 scroll burst 每帧只处理一次。

处理函数每帧仍可能扫描未读节点，但“每个原始 scroll 事件都同步扫描”的原报告表述已经失效。只有真实性能录制显示每帧扫描仍超预算时，才需要进一步改为 IntersectionObserver。

### 4.4 未读跳转焦点

当前 `jumpToUnread()` 在目标进入视口后调用 `next.focus({ preventScroll: true })`。`test-popup-scroll.js` 已验证焦点转移且不会触发二次滚动。原 Medium 无障碍发现已关闭。

### 4.5 日志、剪贴板与主题清理

- `popup-log.js` 将内存日志限制为最新 500 条。
- 剪贴板写入拒绝时，按钮显示“失败”并通过状态栏提示重试。
- 未消费主题 token 已删除，四主题结构测试已同步。
- 当前源码和 `pack.sh` 已移除未使用字体；旧 ZIP 中的字体只是已发布旧包的历史内容。

## 5. UI、主题、安全与后台结论

### 5.1 UI 与主题

值得保留的实践：

- 四套主题结构一致，常用小字号文字对比度测试达到至少 4.5:1。
- `popup-boot.js` 配合 html/body 内联暗色背景，抑制白闪和明显 FOUC。
- 标题字重恒定为 500，避免已读切换触发 line-clamp 重排。
- `prefers-reduced-motion` 覆盖 Logo、骨架、加载、反馈、规则移动和跳转动画。
- 设置面板具备 `inert`、`aria-expanded` 和焦点闭环。
- 图标按钮、规则操作和表单字段具有程序化名称。

### 5.2 安全与隐私

没有发现实质性高危安全问题：

- `host_permissions` 仅包含 `https://aihot.news/*`；
- 没有 content script、`externally_connectable`、远程脚本、`eval` 或内联事件处理器；
- 动态 HTML 字段在进入 `innerHTML` 前统一转义；
- 打开条目经过 HTTPS 校验，标签页创建成功后才提交已读状态；
- 根目录与 `store/` 的隐私政策副本一致；
- 性能日志和存储数据没有自动外传。

`runtime.onMessage` 当前未检查 `sender.id`，但 manifest 没有外部消息入口，现阶段不可利用。若以后新增 content script 或 `externally_connectable`，应同时增加消息来源校验。

### 5.3 后台可靠性

以下设计经代码和测试交叉验证，未发现高危并发或数据丢失问题：

- canonical mutation queue 与 badge queue 分离并各自串行；
- 内容源切换使用 generation/latest-wins，旧请求不能覆盖新选择；
- stale 最终写入有权威快照补偿；
- 首页 ETag 与续页 ETag 隔离，304 不推进完整补拉水位；
- 请求和响应解码共享 15 秒 deadline；
- API、通知、badge 和 durable commit 的失败语义分离；
- quota 失败只做一次更小 history 重试；
- 特关通知逐条保存进度；
- continuation 可在 worker 重启后恢复。

`allFeedContinuation.expiresAt` 只控制 UI 状态提示寿命，不限制后台长 `Retry-After`。当前测试明确锁定这一语义，因此不列为缺陷；若担心误读，可在未来重命名字段。

## 6. 测试与验证证据

复审重新运行了全部无需网络的正式测试：

```text
node test.js                              115 passed
node test-notification.js                 53 passed
node test-notification-reliability.js     28 passed
node test-popup-ui.js                    586 passed
node test-feed-state.js                   12 passed
node test-watch-rules.js                   9 passed
node test-popup-reliability.js            suite passed
node test-popup-scroll.js                 17 passed
node test-background.js                  243 passed
```

所有入口均为 0 failed。有明确计数的套件合计 1063 项通过，另有 popup reliability 套件整体通过。测试故意注入 API、storage、badge、alarm 和 deadline 失败时会输出预期错误日志，不代表测试失败。

### 6.1 当前主要测试盲区

- 发布流水线尚未自动验证 ZIP 的依赖闭环和内容哈希。
- 没有真实 Chrome 中 1000/2500 条列表的启动、重建和滚动性能基线。
- 没有真实系统下原生 `chrome.storage` quota 错误形态和通知时序验证。
- 普通通知在 durable history commit 后、pending queue commit 前的 worker 终止无法由普通单进程 mock 精确模拟。
- 商店截图测试主要验证文件和源码约束，没有评价核心产品旅程覆盖率。

## 7. 推荐后续顺序

### 发布时 P0

- 明确发布后再升级版本和重打 ZIP。
- 在打包流程中增加脚本依赖与内容哈希校验。

### P1：基准驱动的渲染优化

- 建立 100、1000、2500 条真实 Chromium 性能基线。
- 只有基线超预算时，再实施分批渲染或稳定高度窗口化。

### P2：体验与可靠性选择

- 收敛超大字号下的嵌套滚动。
- 根据产品是否承诺普通通知可恢复投递，决定是否持久化普通通知意图。
- 若来源 title 测量在基线中显著，再改为视区或分批测量。

### P3：商店表达

- 增加特关、设置、通知和未读导航截图。
- 让宣传素材颜色从真实主题 token 派生。

## 8. 复审结论

原始审查成功发现了多项真实问题，但报告生成后工作区继续演进，导致部分结论迅速过时。复审确认当前工作树已关闭 readIds 裁剪、全文签名、scroll 事件合并、未读焦点、clipboard、日志上限、死 token 和字体清理等问题。

当前剩余风险整体为 Low–Medium，没有 Critical 或 High。最值得继续投入的是：发布时的产物验证、真实浏览器大列表基线，以及超大字号设置体验。后续每次引用本报告时，都应先确认目标是已发布的 1.2.7、当前未提交工作树，还是未来发布候选，避免跨基线混用结论。