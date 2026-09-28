# Unified Ask verification and manual checks

Date: 2026-09-28. Branch: `codex/unified-ask`, based on integrated release 1c06923.
Status: local implementation accepted; production remains f317265.

## Executed verification

| Check | Result |
| --- | --- |
| Repository preflight | Passed |
| Full `npm run codex:verify` | Passed: generated API check, 427 frontend tests, 395 Node tests (9 existing skips), 72 Nest tests, backend build, production entry smoke, frontend build |
| Dedicated PostgreSQL scenarios | 5 files / 6 tests passed: documents, questions, evidence, supported retrieval and unified mentions |
| Final focused frontend checks | 11 passed, including explicit continuation after current region confirmation and original workbook name propagation |
| Citation/routing regression | 13 passed; existing reported means/method explanations remain reads; mixed read-plus-new-computation requires review |
| Archived request replay | Same personal request returns the original answer without another provider invocation |
| Actual browser acceptance | Passed against production frontend build, real HTTP/Nest/PostgreSQL, synthetic files and deterministic model substitute |
| Screenshot review | Desktop 1440px and mobile 390px inspected; single composer, compact filters, correct viewport boundaries |
| Whitespace verification | `git diff --check` passed |

One screenshot rerun encountered a local connection interruption while reopening
the project. The final complete rerun passed; the earlier two full runs also
passed. Development hot reload interrupted an earlier run, so acceptance uses
the stable production build and installed Chromium rather than live-edited Vite.

The browser run covers + TXT upload, @ selection, cited answer, exact source
viewer, library search, new version, version history, archive, old citation after
archive, personal history after refresh, read-only View Q&A, calculation review
handoff, Excel upload through original Workbook Review, pending question after
refresh, and mobile navigation into the library. No browser page errors, retired
unversioned API calls, automatic scientific calculations or new snapshots occurred.

`backend/scripts/unified-ask-browser-check.mjs` is the reproducible acceptance
script. Set `LABRAT_TEST_DATABASE_URL` to a dedicated loopback test database and
`LABRAT_QA_PLAYWRIGHT` / `LABRAT_QA_CHROMIUM` to installed Playwright/Chromium paths.
Use `LABRAT_QA_FRONTEND_MODE=preview` after `npm run build` and backend build.
It creates an isolated schema, uses synthetic accounts/files, and cleans up its
schema/server/browser/file store. Captures and result JSON are under
`.tmp/unified-ask-browser/`; full verification output is `.tmp/unified-ask-verify.log`.

## 人工测试清单

准备独立测试项目、具有项目权限的 Edit/Approve 与 View 账户，以及不含真实研究
信息的 PDF、DOC/DOCX、TXT、XLS/XLSX。平台 admin 身份本身不代替项目授权。

| 操作 | 预期 |
| --- | --- |
| 从 Overview / Browser 打开 Ask | 只有一个 Ask 标题、聊天记录和输入框，无问答/分析双入口切换 |
| 输入问题；中文输入法按 Enter 确认候选字 | 正常输入，候选字确认不会误发送；Shift+Enter 换行 |
| 点击 +，选择 PDF/Word/TXT 后发送 | 添加参考资料，显示紧凑上传回执；解析完成后可用于问答 |
| 上传损坏文件或超过 25 MiB 文件 | 显示明确错误；无成功假象，原问题可恢复 |
| 输入 @ 加文件名片段 | 下拉搜索项目资料，显示版本和状态；上下键/Enter/Escape 可用 |
| 选择一份或多份资料 | 显示可移除标签；超过两份折叠，最多八份；处理中的资料不可选 |
| 提问“@方法资料，和 Exp17 已接受结果比较” | 优先读取所选资料；需要时可读取项目其他证据，并分别引用 |
| 提问“仅根据 @方法资料回答……” | 检索限制在所选版本；没有依据时明确不足 |
| 移除实验或图表上下文标签后发送 | 该上下文不再随本次请求发送 |
| 点击答案引用 | 打开对应版本及原位置；PDF 原页/高亮、Word 段落/TXT 行号可核对 |
| 点击 Library / References | 在主工作区管理文件，聊天栏不展开永久文件列表 |
| 搜索、类型/状态筛选、排序、翻页 | 列表正确；更改筛选后不会混入旧请求结果 |
| 上传与现有资料同名的新文件 | 创建独立资料，不静默替换现有资料 |
| 在一行选择 New version | 版本追加到该资料；版本历史可读取旧版；旧答案引用不漂移 |
| 在另一个窗口更新后提交旧的 New version 操作 | 提示刷新冲突，不覆盖他人的版本 |
| Archive 一份资料 | 后续检索和 @ 列表排除它；已有答案引用仍可读 |
| Retry 部分可读/失败文件 | 继续原版本解析，显示状态；不伪造未读内容 |
| + 上传 Excel，同时写一个问题 | 进入原区域选择/理解确认链路；不进入参考资料库 |
| 区域未确认或新修改使确认失效 | 原问题保留为待继续任务，继续按钮不可用 |
| 确认所需区域后回到 Ask | 需要显式点击 Continue；问答只能读取实际已确认的范围 |
| 上传多个 Excel，其中一个失败 | 保留每个文件的状态和重试；全部成功并有当前确认区域后才能继续 |
| 刷新并重新打开同一项目 | 原 Excel 问题和上传回执保留；恢复同一账户的个人问答 |
| New conversation | 清空当前会话视图与选择，项目资料和已保存答案仍保留 |
| 登录 View 成员 | 可提问、@ 和查看引用；无上传、归档、新版本或分析执行权限 |
| 切换账户/项目，撤销项目权限 | 不显示其他账户会话；引用和新读取重新鉴权 |
| 询问文献如何计算 / 读取已报告平均值 | 作为带引用的读取请求处理 |
| 请求重新计算平均值、拟合或新图 | 要求审核分析计划；不会直接执行或发布 |
| 请求稿件段落/图注或明确画布操作 | 进入原稿件工作流及原审核边界 |
| 390px 宽度及展开/收起 Ask | 输入框/按钮不超出视口；打开 Library 可完整管理资料 |

## Limits and release notes

- No real-provider semantic evaluation was rerun for this UI/scope extension.
  Browser/provider substitutes establish routing, persistence and citation wiring,
  not open-ended scientific answer quality.
- The old 30-question corpus includes raw Excel read cases. Those cases now assert
  review-required rejection; the supported retrieval subset keeps Recall@8 >= 0.9.
  Its denominator differs from the archived pre-unification report, so old scores
  must not be advertised as validation of this extension.
- Pending upload tasks are local to the browser and actor/project. Server-backed
  personal questions/citations remain durable; local pending tasks do not promise
  cross-device recovery. Initial server question recovery is bounded to 20.
- Word/TXT source inspection shows extracted passages and original locators; PDF
  inspection also renders original pages. This is not a full Word layout editor.
- Release must apply migration 036 after existing 034/035. This work has not been
  committed, pushed or deployed; original checkout changes remain separate.
- Existing large Plotly bundle warning remains. No dependency was added.
