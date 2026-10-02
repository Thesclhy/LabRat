# Docling PDF 按页存储：目标模式启动文本

Status: launch-ready reference — 尚未启动 Goal。
Date: 2026-10-01
实施和验收依据：[主计划](docling-pdf-pages-v1.md)。

## 使用方式

在能访问本计划及项目代码的 Codex 对话中，用下方正文创建目标。
本次只准备文档，不自动开始实施，也不指定模型或 token 预算。
如果在同一对话启动，继续使用已附加工作树；如果在其他工作树启动，先确认
主计划和诊断报告可读，并核实 main 及既有修改，不能直接在旧的脏主目录覆盖代码。

当前计划完整路径：

`C:/Users/liuha/.codex/worktrees/frontend-routing-phase1/LabRat-blank/doc/plans/docling-pdf-pages-v1.md`

本文按[OpenAI Goals 指引](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)
组织为结果、验证、边界和持续执行要求。具体范围和验收矩阵放在主计划，
恢复时以现有进度日志和当前里程碑为准。

## 可复制的 prompt

```text
完成 LabRat 的 Docling PDF 按页识别与存储 v1，以 C:/Users/liuha/.codex/worktrees/frontend-routing-phase1/LabRat-blank/doc/plans/docling-pdf-pages-v1.md 为范围和完成标准。目标是交付可本地运行、经过真实验证的完整版本：自部署 Docling 解析文字型/扫描型/混合 PDF，按页保存正文与必要定位信息，解析任务可恢复，问答读取连续页面窗口并打开正确引用，同时修复字节被当作 token 的预算问题。

先读取计划、AGENTS.md 和相关现行 v1 契约，核实工作树、main 基线及既有改动。优先复用本对话合适的已附加工作树，保护主目录和其他任务的工作。按 M0–M4 连续实施；每阶段验证、修复并更新 doc/PROGRESS.md 与 doc/current-milestone.md 后继续，不以原型、容器启动或单阶段完成代替整体交付。

遵守计划中的精简 metadata、历史版本、项目权限和科学审核边界。本次先完成页面原文层和现有关键词检索，后续再做语义切分、embedding 与 pgvector。普通实现选择自主依据代码和测试决定；新增外部服务、实质范围变化或必要条件缺失时说明原因，并继续不受影响工作。

使用用户已提供的 11 页公开论文和合成样例进行验证；允许沿用已有配置的问答 provider 按计划做有限真实问答测试，不把原文交给外部 OCR，不读取其他真实项目资料。完成 A01–A15，包括真实 Docling、隔离 PostgreSQL、实际浏览器、预算边界与完整 codex:verify；记录初次失败和修复后的证据。必要检查未运行或失败时，不宣布目标完成。

交付实现、迁移与契约、运行/回滚说明和 doc/qa/docling-pdf-pages-verification.md。交付范围是本地可审查版本，推送、合并 main 和生产部署另行安排。不自行指定 token 预算；若已有本目标则继续它。遇到阻碍或预算限制时按宿主 Goal 规则报告真实状态，不把它们当作完成。
```

## 启动后的完成判断

主计划 M0–M4 和 A01–A15 是验收依据。真实依赖缺失或必要验证未完成时，
记录明确缺口并遵守宿主 Goal 状态规则；不能用替身测试或较小里程碑替代终验。
实施完成与生产上线是不同交付状态，本目标交付本地可审查版本。
