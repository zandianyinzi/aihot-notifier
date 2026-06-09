# AI HOT Notifier

Chrome 浏览器扩展，监控 [aihot.virxact.com](https://aihot.virxact.com/) 新内容并推送桌面通知。

## 功能

- 定时轮询 AI 资讯，发现新内容弹出桌面通知
- 点击通知或列表条目跳转原文
- 资讯列表带标题 + 摘要，按日期分组
- 已读/未读状态持久化，重启不丢失
- 支持双深色主题（墨夜/暗森）
- 支持字体风格切换（黑体/宋体/楷体/默认）
- 支持字号调节（小/默认/大/特大）
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
- 点击设置按钮展开配置面板：
  - **通知推送**：开关桌面通知
  - **检查频率**：2 / 5 / 15 / 30 / 60 分钟
  - **外观**：墨夜 / 暗森
  - **字体**：黑体 / 宋体 / 楷体 / 默认（优先使用本机已安装字体）
  - **字号**：小 / 默认 / 大 / 特大
  - **显示天数**：1 / 2 / 3 / 5 天（默认 2 天）

## 通知不弹出排查

- Windows 需要同时允许系统通知和 Chrome 通知发送方：打开「设置」→「系统」→「通知」，确认总开关已开启，并在应用列表中开启「Chrome」通知。
- 扩展内的「通知推送」也需要保持开启。
- 点击弹窗里的刷新按钮只会立即更新列表和角标，不会弹出桌面通知；桌面通知只在后台定时轮询发现新内容时弹出。

## 技术说明

- Manifest V3，Service Worker 后台运行
- 使用 `chrome.alarms` 定时轮询，系统重启后自动恢复
- 数据存储在浏览器本地存储中，主要使用 `chrome.storage.local`
- API：`GET https://aihot.virxact.com/api/public/items?mode=selected&since=<ISO-8601>`

## 测试

- `node test.js`：运行纯逻辑测试，覆盖去重、排序、时间窗口和 API URL。
- `node test-notification.js`：使用 mock 的 Chrome API 验证通知和 badge 逻辑。
- `node test-background.js`：直接加载真实 `background.js`，验证消息通道和失败语义。
- `node test-e2e.js`：请求 `https://aihot.virxact.com`，验证线上 API 数据假设。

## 文件结构

```
aihot-notifier/
├── manifest.json    # 扩展配置
├── background.js    # 后台轮询与通知逻辑
├── popup.html       # 弹出窗口界面
├── popup.js         # 弹出窗口交互逻辑
├── icons/           # 扩展图标 (16/48/128px)
└── README.md
```
