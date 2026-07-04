# 晴野主题高原晴空重构设计

日期：2026-07-04
状态：设计已通过 mockup 确认，待实现计划

## 背景

AI HOT Notifier 的“晴野”主题当前是 `clear-light` 对应的浅色主题。现有版本偏纸面白和中性绿灰，用户明确反馈不喜欢，希望朝“晴天、野外”的方向重构，并选择了“高原晴空 + 深草甸”作为最终方向。

本次设计已通过本地 mockup 预览：

- `preview/sunny-field-highland-mockup.html`
- `preview/sunny-field-highland-mockup.png`

## 目标

- 保留主题 key `clear-light` 和显示名“晴野”，不影响已有用户配置。
- 将晴野从普通浅色纸面主题重构为“白天户外阅读模式”。
- 体现晴天、野外、高原空气和深草甸的气质，但不引入图片、插画、复杂渐变或装饰性背景。
- 保持 420px × 600px 扩展弹窗的列表扫描效率，优先保证未读、特关、分类、时间和摘要的可读层级。
- 只调整晴野相关 token 和必要同步项，不重构其它主题或业务逻辑。

## 非目标

- 不新增主题数量，不修改主题选择项结构。
- 不引入外部字体、图片资源、构建工具或 npm 依赖。
- 不改变 `chrome.storage.local` 数据结构。
- 不修改轮询、通知、特关匹配、已读状态等业务逻辑。
- 不把晴野做成风景化界面；视觉应来自色彩和层级，而不是装饰物。

## 设计定位

晴野的新定位是：

> 高原晴空下的深草甸阅读界面。空气感来自浅蓝绿底色，稳定感来自深草甸文字，热度感只用少量日照橙点出。

它需要和其它四套主题拉开职责：

- 墨夜：默认热点雷达，黑底热感。
- 暗森：夜间长读，低蓝光。
- 铬墨：浏览器工具感。
- 石青：工程师高密度深色扫描。
- 晴野：白天浅色环境里的开阔、清透、低负担扫描。

## Token 方案

实现时应以现有 CSS 变量结构为准，仅替换 `clear-light` 的变量值。建议 token 如下：

```text
--color-scheme: light

--bg:              #f5f9f4
--bg-sub:          #fffefb
--bg-hover:        #edf5ec
--bg-item-hover:   #e6f0e7
--bg-unread:       #fbfdf7

--border:          #d7e5d6
--border-light:    #e8f0e7

--text:            #1d2b20
--text-2:          #4f604f
--text-3:          #647263
--text-unread:     #172619
--text-unread-2:   #425942
--text-unread-3:   #607160
--text-read:       #6b786b
--text-read-hover: #384a39

--accent:          #3f7d5a
--accent-soft:     rgba(63,125,90,0.11)

--scrollbar:       #cad8cb
--hot:             #d86f2f
--hot-soft:        rgba(216,111,47,0.12)
```

### 分类色

分类色需要保持小字号可读，不应全部转绿：

```text
--cat-model:       #6f65b7
--cat-products:    #3277a7
--cat-industry:    #996b24
--cat-paper:       #2f7d50
--cat-tips:        #a9573f
--cat-default:     #68766a
```

## 组件规则

### 列表

- 未读条目继续使用轻背景和 hairline 左侧轨道。
- 普通未读轨道使用 `--accent`，表达草甸青绿的主题主线。
- 特关未读可以继续使用现有统一机制；如果使用 `--accent` 回退，应避免额外定义晴野专属 rail 变量。
- 已读条目文字使用 `--text-read`，hover 恢复到 `--text-read-hover`。
- `--hot` 不作为普通列表主色，只负责 AI HOT 热度语义、特关标签或品牌点缀。

### 顶部和设置

- 顶部仍保持轻量工具栏，不新增装饰性图形。
- 设置分组、按钮、select、input 的 hover 继续使用轻量边框或文字响应。
- switch 可继续使用 `--accent`，因为它表示明确开启状态。
- 特关表单和规则卡片维持当前虚线、低灰盒方案，不恢复左侧色条。

### 日期浮标

- 日期浮标背景使用 `--bg-sub` 或接近 surface 的浅色，不能使用强 accent。
- 文本保持 meta 级，不和标题竞争。

### 文字与可读性

- 主文字必须比现有晴野更稳，避免浅色主题常见的发灰问题。
- 次级文字和已读文字必须可回看，不应过淡。
- 小号 meta、分类、来源在 420px 宽度下保持清晰。

## 实现范围

预计需要修改：

- `popup.html`：更新 `[data-theme="clear-light"]` token 和相关静态断言要求覆盖的 token。
- `popup-boot.js`：将 `clear-light` 首帧背景同步为 `#f5f9f4`。
- `popup.js`：将 `applyTheme()` 中 `clear-light` 背景同步为 `#f5f9f4`。
- `test-popup-ui.js`：更新晴野 token 断言，继续确认不定义 `--rail`、`--rail-strong`、`--rule-rail`。
- 如 README 或 store 文案仅描述主题数量，不需要改动；如描述晴野语义，可同步更新。

不应修改：

- `background.js`
- manifest 权限
- 存储 key
- 其它四套主题 token，除非测试要求同步变量结构
- 打包脚本和依赖流程

## 测试计划

实现后至少运行：

```bash
node test.js
node test-notification.js
node test-popup-ui.js
```

如果只修改静态主题 token，重点检查：

- `clear-light` 仍显示为“晴野”。
- `VALID_THEMES` 和 boot 白名单仍接受 `clear-light`。
- 晴野使用 light color-scheme。
- 首帧背景、运行时背景和 CSS `--bg` 一致。
- 主题变量结构与墨夜保持一致。
- 晴野不定义 rail 特例，继续走共同 Hot rail 机制。
- 特关表单和规则列表布局不被主题调整破坏。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 晴天感不足，仍像普通纸面浅色 | 使用 `#f5f9f4` 浅蓝绿背景、`#fffefb` 暖白 surface 和草甸 accent 拉开气质 |
| 绿色过多导致疲劳 | 保留蓝、紫、棕、红棕分类色，`--hot` 使用日照橙作为少量对比 |
| 文字过淡 | 主文字使用 `#1d2b20`，已读和 meta 仍保持中等灰绿 |
| 未读背景过重 | 未读只用接近白的 `#fbfdf7`，强调主要交给 hairline rail |
| 和暗森主题语义重叠 | 晴野是浅色、空气感、白天环境；暗森是深色、低蓝光、夜间长读 |

## 自检结果

- 无占位符或待定项。
- 保留 `clear-light` key 和“晴野”显示名，兼容已有配置。
- 设计只要求更新晴野 token、首帧背景和测试断言，不触碰业务逻辑。
- Token 取值与 mockup 方向一致：高原空气、深草甸文字、日照热度点缀。
- 测试范围覆盖主题白名单、首帧背景、变量结构和共同 Hot rail 机制。
