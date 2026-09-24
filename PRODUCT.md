# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是需要持续跟进 AI 领域动态的个人 AI 从业者、研究者和重度关注者。他们通常在浏览器工作，希望在不持续打开资讯网站的情况下及时发现值得阅读的新内容，并保留自己的阅读进度。

## Product Purpose

AI HOT Notifier 是一个 Chrome 浏览器扩展，通过 aihot.news 的公开 API 获取 AI 资讯，在发现新内容时发送桌面通知，并在弹窗中提供可持续浏览的本地资讯历史。产品成功的标准是让用户及时看到重要更新、能够快速打开原文，并在浏览器重启或内容源切换后保留阅读和偏好状态，同时保持轻量、不打扰。

## Positioning

产品以本地优先的方式把 aihot.news 的 AI 资讯监测、桌面通知、持久历史和可配置的特关规则组合在浏览器工具栏中；用户无需账号或额外服务即可持续跟进动态，个人偏好和阅读状态留在设备上。

## Operating Context

用户从 Chrome 或 Edge 工具栏打开扩展弹窗，扫描按时间组织的资讯标题、摘要、来源和本地时间，点击条目跳转原文。后台通过 Chrome alarms 定时轮询公开 API，发现新内容时发送通知并更新角标；用户也可以手动刷新、切换全部或精选内容源、调整显示窗口、定位到未读内容，以及配置特关规则来优先查看匹配的资讯。

## Capabilities and Constraints

- 支持定时轮询、手动刷新、桌面通知、角标未读数和点击通知或条目打开原文。
- 保存资讯历史、已读状态、阅读位置、内容源设置和特关规则；切换内容源不会清空既有历史或已读状态。
- 支持全部/精选内容源、未读优先/自由浏览、轮询间隔和显示天数设置。
- 支持四套主题、三种字体风格和五级字号作为用户偏好；设置面板按常规、外观、特关、调试分组。
- 特关规则可按来源、作者和关键词匹配，支持多关键词及规则排序、启停和删除；特关提醒有次数和时间限制。
- 运行于 Manifest V3 Service Worker，无构建步骤和运行时第三方依赖；使用原生 JavaScript、HTML 和 CSS。
- 权限限定为 `alarms`、`notifications`、`storage`，网络访问限定为 `https://aihot.news/*`；不收集或上传用户个人信息、偏好、阅读记录或本地日志。
- 资讯请求直接使用 aihot.news v1 items API；本地缓存、分页、ETag、失败重试和存储限额必须保持现有可靠性语义。
- 需要兼容 Chrome 扩展弹窗的固定尺寸和 Service Worker 生命周期；发布包只包含 manifest、运行时代码、字体和图标等白名单文件。

## Brand Commitments

- 产品名称为 AI HOT Notifier，资讯来源品牌为 AI HOT / aihot.news。
- 对用户的核心承诺是及时、轻量、不打扰；通知、状态反馈和设置文案应保持直接、克制、可理解。
- 现有产品提供中文界面，并保留英文商店文案与隐私政策；后续改动不得虚构数据来源、用户规模、效果指标或第三方背书。

## Evidence on Hand

- [README.md](README.md) 记录当前使用方式、功能、API、存储和发布约定。
- [manifest.json](manifest.json) 记录 Manifest V3 配置、权限和扩展入口。
- [popup.html](popup.html)、[popup.js](popup.js) 和 [background.js](background.js) 是当前弹窗界面、状态交互和后台轮询实现。
- [store/description_zh.txt](store/description_zh.txt)、[store/description_en.txt](store/description_en.txt) 提供商店功能说明。
- [privacy-policy.html](privacy-policy.html) 说明本地存储、网络请求和权限边界。
- 当前没有用户评价、客户案例、定量效果数据或可用于宣传的第三方证明；未来内容不得自行补造这些材料。

## Product Principles

1. 及时发现重要 AI 动态，但控制通知频率和打扰程度。
2. 本地优先保存偏好、历史和阅读状态，减少数据暴露面。
3. 让资讯扫描、筛选、打开原文和恢复阅读位置保持直接顺畅。
4. 内容源切换、网络失败和浏览器重启都不应破坏已有记录。
5. 以公开 API 和最小权限实现可验证、可维护的浏览器扩展体验。
