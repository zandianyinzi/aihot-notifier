# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Chrome 扩展（Manifest V3），监控 aihot.virxact.com AI 资讯并推送桌面通知。纯前端，无构建步骤，无依赖。

## 命令

```bash
# 打包为 zip（排除无关文件）
./pack.sh

# 单元测试（纯逻辑验证，不需要浏览器）
node test.js

# 端到端测试（直接请求 API 验证数据逻辑）
node test-e2e.js
```

## 架构

- **background.js** — Service Worker。定时轮询 API、去重、存储 history、发通知、管理 badge 计数。核心函数：`pollForUpdates()`（定时触发）、`manualPoll()`（用户手动刷新）、`resetAndPoll()`（切换 feedMode 时全量重拉）、`updateBadge()`（badge 未读数）。
- **popup.html + popup.js** — 弹窗 UI。读取 storage 渲染资讯列表，管理已读状态和设置面板。通知开关/轮询间隔变更通过 `chrome.runtime.sendMessage` 通知 background；外观类设置仅本地保存和重渲染。设置面板按 `常规 / 外观 / 特关 / 调试` 分组。
- **manifest.json** — 权限：alarms、notifications、storage。host_permissions 限制为 aihot.virxact.com。

## UI 约定

- 设置面板使用原生折叠分组，默认只有 `常规` 展开，其他组收起。
- 分组标题、按钮和标签沿用主题色与低对比度层级，不把说明性文字做成高亮主视觉。
- 除输入框外，弹窗内其它交互区域不应出现文本插入光标。

## 关键设计决策

- **已读状态**：`readIds`（单条标记）+ `readAllBefore` 时间戳（批量清除）。两者共同决定是否已读。
- **存储 vs 显示**：storage 保留 `Math.max(historyDays, 7)` 天数据避免切换天数时丢失；UI 和 badge 按用户设置的 `historyDays` 过滤显示。
- **API 轮询缓冲**：定时轮询回退 2 倍间隔时间（`bufferMs`），避免 API 入库延迟导致漏条目。
- **feedMode 切换**：调用 `resetAndPoll()` 全量重拉并替换 history，成功后才提交新的 feedMode；失败时保留旧 history 和旧 feedMode，避免状态不一致。

## API

```
GET https://aihot.virxact.com/api/public/items?mode={selected|all}&since={ISO-8601}&take=100&cursor={nextCursor}
```

响应：`{ items: [...], hasNext: bool, nextCursor: string }`

## 发布流程

每次改动后，按顺序执行：
1. 升级 `manifest.json` 中的版本号
2. 打包（`./pack.sh` 或 PowerShell `Compress-Archive`）
3. commit + push

## 发布

- GitHub: https://github.com/nayexinqing/aihot-notifier
- 隐私政策: https://nayexinqing.github.io/aihot-notifier/privacy-policy.html
- Chrome Web Store 素材在 `store/` 目录
