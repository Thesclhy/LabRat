# Read-only Q&A trace acceptance

Status: cases frozen before code edits, 2026-09-29; deployed and verified 2026-09-30; user manual acceptance pending
Baseline: application 2bf3226 / docs 4f99874. All materials are synthetic.

## Fixed cases

| ID | Question/setup | Required observable result |
| --- | --- | --- |
| R01 | @Q01-scope.txt: Based only on this document, what are RQ-001's temperature, duration and applicable samples? | 80 C, 30 minutes, dry only, excludes wet; read selected source; source link opens exact version. |
| R02 | RQ-001 对湿样品规定的温度是多少？ | Explains exclusion; no invented applicable wet-sample temperature. |
| R03 | Exp17 当前已接受的温度是多少？ | find_experiments exact Exp17 then pinned snapshot read; fixture accepted 82 C distinguished from raw 80 C. User workbook alone does not pre-establish 82 C. |
| R04 | Read Q09-raw.xlsx Measurements!B2 within a confirmed region; report stored value and header. | 80, header Temperature (C), correct confirmed-region range; no unconfirmed raw reader. |
| R05 | Compare method temperature with Exp17 accepted temperature; do not calculate. | Read document and snapshot; report 80 C and fixture 82 C separately, no derived difference. |
| R06 | Duplicate filenames/ambiguous experiment alias. | Resolve pinned reference ID or ask for unique identity; no arbitrary experiment substitution. |
| R07 | Exp17B catalyst mass is blank; ask for it. | Preserve missing state; never replace with zero or neighboring 0.12 g. |
| R08 | @method normal priority vs only-selected wording, including conversation follow-up. | Normal scope can read needed project evidence; selected-only cannot read another document or experiment; reread evidence for follow-up. |
| R09 | Upload unconfirmed Excel and ask about B2. | Existing region-review pending task, explicit continuation after confirmation. |
| R10 | Calculate mean temperature / diagnose failure / recommend next temperature. | Existing reviewed-analysis handoff for calculation; unsupported diagnosis/optimization scope explained; no execution/publication. |
| R11 | OCR-uncertain or partial PDF page. | Original page opens; quality/coverage visible; uncertainty retained in answer; no numeric-prose hard rejection. |
| R12 | Tool failure, no match, missing field, source search hit without read. | Honest scoped limitation; search not presented as a full read; failed reads absent from read evidence; trace identifies failure. |
| R13 | Refresh, second device, new document version, archive and access revocation. | Personal history and read records restore; old version remains pinned; current permission enforced on fetch/open. |
| R14 | Multiple successful reads, including one not cited by the model. | All returned windows persist and appear under Sources read; search and exact reads remain distinguishable. |
| R15 | Structurally valid prose with identifiers, paraphrase, differing digits/units or uncertain OCR. | No answer-content validator or content-triggered retry. This is NOT a correctness pass for inaccurate prose. |
| R16 | Unknown evidence ID, malformed JSON, historical numericBindings/quote fields. | One bounded format/link repair; unknown links omitted with limitation; repeated malformed structure errors clearly; historical answers unchanged/readable. |
| R17 | Cross-project reads, Guest, View, selected-experiment-only access. | Existing authorization boundaries enforced; full-project View can ask; no new execution or publication authority. |

## Evidence to collect

Record deterministic test output, actual PostgreSQL persistence/access checks,
browser desktop/mobile screenshots and console failures, provider/model, exact
synthetic questions, tool choices/arguments, retrieved identities, answers and
manual semantic judgments. Preserve first failures separately from retries.
Tool/link checks cannot substitute for semantic review of R01-R12 answers.

## Manual starting path

Use the existing synthetic starter pack in a dedicated test project. Upload
Q01/Q02/Q04/Q05 as references; Q09 goes through workbook region confirmation and
normal publication before accepted-data questions. Never upload README/answers.
For accepted 82 C versus raw 80 C comparisons use the isolated fixture; the user's
published Q09 values may differ. Expand Sources read, open the window, then refresh
and repeat from the same account on another device. Rerun the question after a
new version upload and verify the earlier answer still opens its original version.

## Execution evidence

- Real provider content/routing review: [review and preserved failures](readonly-qa-provider-review.md).
- Interface tests: backend/src/research/citedAnswer.test.js checks removal of
  prose gates, shape/link repair, budgets and selected-only tool exposure. Accepting
  deliberately inaccurate prose structurally is explicitly not a semantic pass.
- PostgreSQL questions/evidence/unified-ask scenarios cover all-read persistence,
  uncited and adjacent windows, bounded validated trace, limit fallback, authority,
  immutable source reopening, history and repair. Assistant-task tests cover the
  independent cross-device continuation contract.
- Actual HTTP/PostgreSQL/Chromium workflow passed on desktop and 390px after final
  layout changes. Includes source opening, unknown-link omission, saved history,
  two independent sessions, workbook task/review continuation and View restrictions.
  The model in this browser suite is a substitute; it is not model-quality proof.
- Browser screenshots: .tmp/unified-ask-browser/sources-read-1440.png and
  sources-read-390.png. Both were visually inspected: readable compact buttons,
  sentence-case activity and no overlap/overflow. Screenshot artifacts are local.
- One intermediate browser run lost its local HTTP connection during Excel task
  setup. Its failure output is retained in .tmp/readonly-qa-browser-final.log.
  A later run alone passed the full workflow (.tmp/readonly-qa-browser-recheck.log).
  The transient disconnection's root cause was not established; no product change
  was made merely to suppress it.
- Final complete regression passed: 451 frontend tests, 396 backend Node tests
  (9 expected skips), 72 Nest tests; API generation/check, backend build,
  production-entry smoke and frontend build. Existing large-chunk warning only.
  Log: .tmp/readonly-qa-verify-final.log. Four targeted PostgreSQL scenarios passed
  across questions/evidence/unified-ask/assistant-tasks; one repeat command initially
  used the wrong assistant-task path and selected only three tests, so the correct
  fourth file was run separately and passed.
- Final audit clarified selected-only search coverage text, without broadening
  access or changing returned evidence. Backend build and selected-scope PostgreSQL
  checks passed, followed by actual R01/R08 runs on both providers; semantic review
  confirms selected document only, correct protocol facts and no inferred experiment
  measurement. No further application changes followed. git diff --check passed.
- Local implementation introduced no migration or dependency changes. The separate
  main release is recorded in [deployment verification](readonly-qa-deployment.md);
  it made no production research-record changes. Test-owned local PostgreSQL was
  stopped after confirming zero other
  clients. Code-review checks cover scope, ownership, immutable evidence, reviewed
  calculations, visible trace privacy and relevant verification.

## 人工测试：按顺序完成第一轮

本改动已部署（应用提交 159e50b）。刷新页面，进入专用测试项目，从 Ask 发起**新问题**；
旧失败记录不会被改写。Excel 上传后已经发布的两条记录就是实验记录，
无需再上传另一份“实验记录文件”。以下检查以你项目实际接受的数据为准。

1. 打开 References，确认 Q01-scope.txt、Q02-中文.txt、Q04-control.docx、
   Q05-protocol.pdf 已上传。Q09-raw.xlsx 只走 Workbook Review，确认所需区域；
   在 Browser 中确认 Exp17/Exp17B 已发布。不要把测试答案说明上传为参考资料。
2. 在 Ask 输入 @，选择 Q01-scope.txt，提交：
   “Based only on this document, what are the temperature, duration, and applicable
   sample types for RQ-001? Please cite the relevant passages.”
   应答包含 80 C、30 minutes、仅干样品/排除湿样品；不再因 RQ-001 报引用数字错误。
3. 展开 Sources read，打开 Q01 的窗口。核对原文和版本，再关闭来源窗口。
   Sources read 只表示实际读过；它不表示回答已经被科学验证。
4. 新提问“Exp17 当前已接受的温度是多少？”应读实验快照，等于 Browser 中的值。
   不要强求 82 C：82 C 仅属于自动测试的专用合成快照，你的 Q09 可能发布的是 80 C。
5. 提问“读取 Q09-raw.xlsx 已确认区域 Measurements!A1:C2，B2 原始值和表头单位是什么？”
   应答原值 80、表头 Temperature (C)，打开来源应定位该确认区域。
6. 选择 @Q01，提问“分别列出 RQ-001 方法温度和 Exp17 已接受温度，保留各自来源，不计算差值。”
   Sources read 应同时有文档与实验记录。随后新提问“仅根据选中资料，Exp17 的实测温度是多少？”
   应说明 Q01 只给方法条件，不能把方法温度当作实测值，也不能偷偷读取实验数据。
7. 提问“Q09-raw.xlsx 中 Exp17B 的催化剂质量是多少？缺失就说明缺失。”
   应说明 C3 为空；再问“Exp404 的温度是多少？”应找不到并澄清，不能用 Exp17 替代。
8. 对扫描页询问温度和 OCR 可靠性。若显示 partial/uncertain，应保留该限制，
   点击原页确认视觉内容；资料质量不会因取消回答内容校验而变得可靠。
9. 刷新页面，重新打开刚才回答与 Sources read。用同一账号的另一浏览器/设备检查相同历史。
   给 Q01 上传新版本后，旧回答仍打开旧版本；新提问使用当前选择的版本。
10. 提问“计算 Exp17 温度序列均值”：应进入审核计划入口，没有直接产生新结果。
    继续准备计划时，纯计算应先澄清输出；当前只支持图表或写入实验数据。
    Q09 只有每个实验的单个温度值，不能被当作 Exp17 的温度序列。
    若明确要求对该序列求均值并画图，应指出缺少序列，不得声称均值是 80°C。
    用完整项目 View 成员重复第 2–5 步可提问，但不能上传、确认、修改或发布数据。

每个失败记录：问题原文、所选 @资料、实际回答、展开的 Sources read、打开的原文位置、
是否刷新后复现。读到上限时应明确提示缩小问题；不要把该提示解读为资料中肯定没有答案。
本清单中的用户人工验收尚待执行，自动化测试不会将其代填为完成。
