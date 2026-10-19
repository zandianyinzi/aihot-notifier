# 文档索引

[项目 README](../README.md) 是当前使用方法、接口、存储和界面约定的入口；[AGENTS.md](../AGENTS.md) 是 Agent 工作约束的唯一源文件，[CLAUDE.md](../CLAUDE.md) 通过相对软链接指向该文件。当前版本以 [manifest.json](../manifest.json) 为准，发布历史以 Git 提交为准。

`reviews/` 保存带日期边界的工作区审查快照，用于追踪风险、证据和修复优先级；它们不替代现役合同，已修复或后续变化的结论须对照当前代码和测试重新验证。

`superpowers/` 保留历史设计、实施过程与事故依据。旧计划的复选框记录当时进度，不作为下一次会话的任务清单；接口、默认值和视觉细节以当前代码与测试为准。

| 文档 | 用途与边界 |
| --- | --- |
| [2026-10-19 多 Agent 对抗式项目审查与复审](reviews/2026-10-19-adversarial-project-review.md) | 当前工作区的 UI、性能、交互、可靠性、安全、测试与发布审查快照；包含已修复项和复审后的剩余风险，引用时须确认目标基线 |
| [全局历史与内容源设计](superpowers/specs/2026-07-27-global-history-cache-design.md) | 解释身份合并、投影、并发与迁移的设计依据；具体实现以后台和弹窗测试为准 |
| [列表 hover 设计](superpowers/specs/2026-07-10-popup-list-hover-feedback-design.md) | 保留整行反馈和状态分工的设计依据 |
| [列表布局回归记录](superpowers/specs/2026-09-13-popup-layout-regressions.md) | 保留固定高度估算引发位移的事故证据，性能结论有日期边界 |
| [特关首版设计](superpowers/specs/2026-06-26-watch-rules-design.md) | 历史设计；旧提醒节奏、已读后立即取消置顶等说法已被替代 |
| [v1 迁移设计](superpowers/specs/2026-07-26-v1-reliability-design.md) | 历史设计；临时 legacy fingerprint 依赖已退役 |
| [可靠性收尾设计](superpowers/specs/2026-09-12-reliability-closeout-design.md) | 历史设计；fingerprint 和 28px 状态栏等细节不再适用 |
| [全局历史实施计划](superpowers/plans/2026-07-27-global-history-cache.md) | 历史实现步骤 |
| [v1 迁移实施计划](superpowers/plans/2026-07-26-v1-reliability.md) | 历史实现步骤 |
| [可靠性收尾实施计划](superpowers/plans/2026-09-12-reliability-closeout.md) | 历史实现步骤 |
| [旧浅色主题方案](superpowers/plans/2026-07-04-sunny-field-highland.md) | 退役主题的历史记录，不应重新启用 |
