# AI HOT Notifier

Chrome 浏览器扩展，监控 [aihot.virxact.com](https://aihot.virxact.com/) 新内容并推送桌面通知。

## 功能

- 定时轮询 AI 资讯，发现新内容弹出桌面通知
- 点击通知或列表条目跳转原文
- 资讯列表带标题 + 摘要，按日期分组
- 已读/未读状态持久化，重启不丢失
- 支持双深色主题（墨夜/暗森）
- 支持字体切换（思源黑体/思源宋体/霞鹜文楷/系统默认）
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
  - **字体**：思源黑体 / 思源宋体 / 霞鹜文楷 / 系统默认
  - **字号**：小 / 默认 / 大 / 特大
  - **显示天数**：1 / 2 / 3 / 5 天

## 技术说明

- Manifest V3，Service Worker 后台运行
- 使用 `chrome.alarms` 定时轮询，系统重启后自动恢复
- 数据存储在 `chrome.storage.local`，本地持久化
- API：`GET https://aihot.virxact.com/api/public/items?mode=selected&since=<ISO-8601>`

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
