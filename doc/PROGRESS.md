# Progress Log

Status: active
Read when: checking recent work, verification status, and follow-up items.
Last reviewed: 2026-07-23

Use this file for recent progress only. Older entries live in `doc/reports/progress-archive-2026-06.md`.

Keep entries concise, newest first, and include:

- user request or milestone
- meaningful changes
- verification
- follow-ups or residual risk

## 2026-07-23

- Rebuilt reviewed chart analysis around exact confirmed workbook selections.
  The planning model now pages through active accepted regions and persists only
  `sourceSelections`, structured review meaning, and readable display steps.
  Plan acceptance creates a queued run without Python; execution materializes
  one typed/display/formula table per selection and then asks the model to write
  `labrat-python-v2` against the real `inputs.tables` dictionary. Large source
  selections are tiled through bounded reads, so an 8,881-cell confirmed region
  no longer hits an aggregate 500-cell limit.
- Replaced result-table/field/lineage output with backend-validated
  authoritative Plotly. Validation now covers serialization, finite values,
  Plotly safety, x/y shape, limits, stable trace ids, source ownership, and only
  explicitly reviewed invariants. ChartSpec v3 stores complete Plotly, reviewed
  source selections, a flat curve catalog, and default `visibleTraceIds`;
  Result, Canvas reload, and PPTX export use placement-local curve visibility.
- Removed the old AnalysisSelection/AnalysisToolRegistry runtime and tests,
  stopped persisting Python and review hashes in PlanRevision, and added
  migration 017 to clear development analysis artifacts plus drop retired plan
  columns. Updated API, database, architecture, AI-boundary, canonical-data,
  current-milestone, and project-state docs to the v2/v3 contracts.
- Verification: backend 202/202 passed with one optional PostgreSQL integration
  skip before browser QA. The final `npm run codex:verify` passed frontend
  243/243, backend 203/203 with one optional PostgreSQL integration skip, and
  the production build with only the existing Plotly chunk-size warning.
- Completed a fresh real Anthropic plus local-Python browser E2E in an isolated
  development project. The model selected two exact non-contiguous inputs,
  `Runs!A1:A5` and `Runs!D1:F5`; Source displayed both red ranges and no Python,
  acceptance materialized two input tables, and Python produced a validated
  12-point, three-series stacked Plotly chart. Result Select all/Clear and the
  zero-series acceptance guard worked, acceptance created one ChartSpec, and
  two Canvas placements retained independent 2/3 and 3/3 curve visibility
  after save and reload. Browser console verification reported no warnings or
  errors.
- The real E2E exposed one calculation-constraint bug: per-experiment stacked
  normalization was incorrectly expressed as a whole-trace sum. Added
  `x_group_y_sum` for cross-trace totals at each shared X category, retained
  `trace_y_sum` for whole-series totals, updated provider instructions and
  schemas, and added focused validation coverage. A configured PostgreSQL
  migration run remains operational follow-up work.
- Replaced the three-stage Analysis Review UI with a two-page `Source` and
  `Result` workflow. Source keeps exact Excel red-box evidence and the readable
  plan; accepting it immediately opens Result and executes Python. Result now
  renders only the validated Plotly chart, readable point/series/exclusion
  status, searchable multi-series defaults, and Accept chart/feedback controls.
  Removed the old result-row table, row/source-ref pagination, lineage ids,
  hashes, and separate Chart tab without changing AnalysisResult persistence,
  validation, lineage, or publication APIs. Result feedback still creates an
  immutable plan revision and returns to Source; the exact AnalysisResult id
  and at least one visible trace id gate ChartSpec publication.
- Added focused coverage for the Exp33 19-point wide-to-long chart, readable
  title/axis/hover semantics, no technical-id leakage, zero-series blocking,
  Select all/Clear, validation failures, historical-result reopening, exact
  publication inputs, and the LabRat-to-Manuscript golden workflow. Frontend
  verification passes 243/243, backend verification passes 246 tests with one
  optional PostgreSQL skip, and the production build passes with the existing
  Plotly chunk-size warning.
- Ran a real Anthropic plus local-Python browser E2E in `test 1`. The model
  selected `Calculation Exp33.xlsx` `Sheet1!Q69:AI69`, Source showed the exact
  range, plan acceptance opened Result, and the validated Plotly chart rendered
  C1-C19 as 19 points with readable Carbon number and Distribution value axes.
  Source remained available after execution, Result reported one series and no
  exclusions, and Accept chart created one active ChartSpec.

## 2026-07-22

- Diagnosed the latest Exp33 chart-plan failure from a real Anthropic response:
  the selected confirmed region was only 40 cells and was read correctly, but
  generated Python imported `uuid` and used nondeterministic result ids, so the
  backend policy rejected it. Strengthened the provider contract for
  deterministic ids/order, Python-native literals, and exact input accounting;
  added static rejection of JSON literals and unordered `list(set(...))`
  output; filtered identity-only fields from the scientific catalog; and added
  one bounded model repair attempt driven by exact backend errors. A final
  failure now returns the concrete policy message and line occurrence to the
  UI. Backend verification passed 246 tests with one optional PostgreSQL skip,
  frontend verification passed 241/241, and the production build passed with
  the existing Plotly chunk warning. Restarted the current backend, restored
  `test 1`, `Calculation Exp33.xlsx`, and accepted `Sheet1!P68:AI69`, then ran a
  real Anthropic request for `draw a chart of carbon number distribution`. It
  produced revision 1 in 26.8 seconds with no warnings, selected exactly
  `Sheet1!Q69:AI69` (19 cells), and generated policy-compliant deterministic
  Python without UUID, random, JSON literals, or unordered set conversion. The
  plan remains awaiting user review; it was not accepted or executed.
- Restarted the local backend on `127.0.0.1:8787` and the Vite frontend on
  `127.0.0.1:5173/LabRat/` from the current workspace after the user accepted
  loss of the stale in-memory project. Both HTTP checks returned 200, the
  seeded `labuser` login succeeded, and the fresh memory store reports zero
  projects.
- Diagnosed the chart-planning `Requested range contains 8881 cells; maximum
  is 500` report as a mixed-version local runtime, not a current selection
  contract failure. The active `test 1` project on port `8787` has one accepted
  40-cell region (`Sheet1!P105:AI106`), but its older no-watch backend fell back
  to the workbook used range `A1:CE107`. Added an authenticated route regression
  covering a confirmed `A1:CE107` region and verified current analysis planning
  completes through bounded reads without a `source_range_too_large` warning.
  Full backend verification passed 242 tests with one optional PostgreSQL skip.
  The stale `8787` process was intentionally
  left running because restarting its in-memory store would discard the user's
  current project; switch to a fresh current-code instance or persistent
  Postgres before replacing it.
- Fixed wide-to-long analysis validation for charts such as Exp33 carbon-number
  distributions. Model-drafted plans now declare `one_to_one` or `one_to_many`
  row cardinality, use long output fields for chart encoding, return
  `result_table` as an array, keep trace lineage on accepted input ids, and
  count exclusions by input record. The validator deterministically unwraps
  the common `{rows: [...]}` result-table shape, permits repeated source rows
  only for reviewed one-to-many plans, and resolves known output-row lineage
  back to accepted source ids while preserving strict unknown-lineage blocking.
  Failed-result UI now reads counts from run validation instead of showing
  `Unknown / 0 / 0`. Full frontend verification passed 241/241, full backend
  verification passed 241 tests with one optional PostgreSQL skip, the focused
  wide-to-long validator passed 16/16, and the production build passed with the
  existing Plotly chunk-size warning. A fresh real-provider run remains the
  final live check.
- Simplified the Analysis Review Chart Plan to retain only readable processing,
  calculation, missing-value, and validation steps plus necessary warnings.
  Removed the redundant Selected data block because the Excel red boxes already
  identify the evidence, and removed Chart setup because raw X/Y field lists
  were not user-readable. Field coverage counters, scalar/series counts, exact
  Python, and source hashes also remain hidden from the ordinary plan UI while
  the frozen backend artifacts are retained for execution and audit. Focused
  workspace coverage passed 21/21; the preceding browser QA confirmed the same
  Exp33 plan and `Sheet1!Q69:AI69` red-box behavior before this final reduction.
- Verified the current confirmed-region analysis path against real Anthropic
  with zero accepted DataSnapshots: `i want carbon number distribution of
  exp33` selected the exact `Calculation Exp33.xlsx` `Sheet1!Q69:AI69` source
  rectangle and produced an awaiting-review plan. The reported
  published-data-only message came from an older no-watch in-memory backend;
  a parallel current-source environment preserved that process and its data.
  Fixed Analysis Review so its embedded Workbook workspace resolves the active
  plan rectangle's SourceDocument instead of receiving an empty review state.
  Browser QA now shows the workbook, focuses row 69, and highlights all 19
  source cells in red. The focused workspace suite passed 21/21 and the
  production build passed with the existing Plotly chunk-size warning.
- Replaced LabRat chat's per-region workbook buttons with one persisted
  filename link per upload. The link stores only the exact
  WorkbookReviewSession id, SourceDocument id, filename, and region count;
  clicking it reloads that session and leaves all region focus/revise/confirm/
  ignore/delete controls in Workbook Review. Added restored-history coverage
  and removed newly generated `Select Sheet!Range` chat controls. Also unified
  result validation and ChartSpec publication on one reviewed record-order
  helper, so `inputSnapshotRefs`, traces, and result rows remain aligned even
  when experiment heads were inserted out of order.
- Cut LabRat over to three supported chat dispositions: workbook upload/region
  review, read-only project Q&A, and reviewed analysis/chart planning. All
  chart wording, including explicit Excel ranges, now selects confirmed region
  and/or active DataSnapshot evidence through one AnalysisThread plan-review,
  Python-execution, result-review, and ChartSpec publication flow. Removed the
  SourceExtractProposal/ChartProposalSet routes, stores, modules, migrations,
  frontend action cards, proposal-review UI, browser API helpers, and
  sourceSnapshot renderer compatibility. Chart Review, Manuscript, and PPTX now
  render only validated `analysis_result.traceCatalog` data. Full
  `npm run codex:verify` passes with frontend 239/239, backend 239 passed plus
  one optional PostgreSQL skip, and a successful production build with the
  existing Plotly chunk warning. Browser smoke on the live `test 1` project
  confirms the three supported Overview entries and the reviewed chart modal;
  a fresh real Anthropic plus local-Python replay remains the external E2E
  gate.
- Fixed AgentRun routing for natural-language experiment chart requests such as
  `draw chart of carbon number distribution in experiment 33`. Distribution
  wording plus a generic `chart` verb no longer diverts the request into the
  legacy source-extract path or guesses an uploaded workbook's entire used
  range. Only an explicit row/range or workbook/sheet reference selects source
  extraction; ordinary experiment requests enter the reviewed DataSnapshot
  analysis flow. The 500-cell source-preview safety bound remains unchanged.
  Added a regression with an `A1:CE107` calculation workbook and preserved the
  explicit-row source-extract case. Targeted tests passed 2/2, the full backend
  suite passed 253 tests with one optional PostgreSQL skip, all 272 frontend
  tests passed, and the production build passed with the existing Plotly chunk
  warning. The running no-watch backend was not restarted because it uses the
  in-memory store and currently contains uploaded workbook review state.
- Made manual Workbook Review selection creation optimistic without inventing a
  client-only region. `POST .../regions` can now persist and immediately return
  an exact versioned `interpreting` region, while the frontend starts bounded
  AI interpretation through a separate endpoint. The right dock immediately
  shows the sheet/range, an AI-interpreting spinner, and usable Ignore/Delete
  actions; interpretation results update the same card without stealing focus
  from newer selections. Version/disposition checks discard late AI results
  after Ignore/Delete. Targeted frontend, service, and route tests passed;
  frontend passed 270/270 and the production build passed with the existing
  Plotly chunk warning. Live browser QA observed the pending `Sheet1!C3` card,
  both actions, in-place Anthropic result replacement, and no console errors.
  The complete backend run still has one unrelated existing failure: the golden
  conversational-analysis fixture emits source records in the reverse of its
  required natural experiment order; the route suite containing the new region
  coverage passes independently.
- Changed Overview `View confirmed regions` from opening one inferred latest
  session to an uploaded-workbook chooser backed by every project
  WorkbookReviewSession. The dialog shows the workbook filename, sheet count,
  updated date, confirmed-region count, and pending-region count; selecting a
  row reuses the exact-session loader and closes the chooser. Pending-region
  actions still open the session containing the latest pending region directly.
  Browser QA against the live `test1` project listed
  `Reaction_Rate_Exp45.xlsx`, `Calculation Exp31.xlsx`, and
  `MasterTable_updated.xlsx` with their real counts, then opened the Reaction
  Rate session on its `Exp45` sheet. Verification passed with 60/60
  ProjectDashboard tests, 269/269 full frontend tests, and the production build
  with the existing Plotly chunk warning.
- Fixed workbook-region creation after opening another upload and switching its
  worksheet. WorkbookReviewWorkspace previously exposed every project
  SourceDocument and retained the prior selected document across review-session
  changes, so a new red box could be posted to the current session with the old
  SourceDocument id and correctly fail with `source_document_mismatch`. The
  workspace is now locked to its WorkbookReviewSession SourceDocument; the
  project document list is used only to hydrate missing metadata for that exact
  document, while worksheet tabs remain freely switchable. A regression now
  switches from one session/document to another, opens its `Results` sheet, and
  verifies a `C3:D4` drag creates a region against the second SourceDocument.
  Verification passed with 60/60 ProjectDashboard tests, 269/269 full frontend
  tests, and the production build with the existing Plotly chunk warning.
- Compared the current server-backed Experiment Browser with `origin/main`
  (`UX-ExpBrowser`) and adopted its dense left-workspace and direct table-header
  interaction model without restoring the retired local dataset path. Saved
  views, search, filters, and hidden columns now share the sidebar; headers sort
  on click and support context actions, resize, auto-fit, and drag reorder; full
  rows open source-backed detail while checkboxes remain comparison-only. The
  accepted-DataSnapshot query, virtual paging, BrowserView persistence, detail
  drawer, and comparison tray remain authoritative. Browser QA against the
  isolated 63-experiment `test1` data found and fixed a zero-width virtual table
  body, then verified visible rows, backend sorting, hide/restore, full-row
  detail, and comparison selection at 1280px. Frontend verification passed
  269/269 tests and the production build with the existing Plotly chunk warning.
- Re-ran the complete browser E2E against the isolated 63-head `test1` clone
  with real Anthropic `claude-sonnet-4-5` and the development local Python
  executor. The reviewed source correctly highlighted `Sheet1!L3:N63`; the
  conversational revision loop worked; the final execution validated 57 rows,
  3 traces, 6 labeled exclusions, and the 100% row-sum invariant; the chart used
  natural Exp1-to-Exp61 order and rendered 171 bar paths; one durable
  analysis-result ChartSpec and one one-page/one-block Manuscript survived a
  hard reload with no browser warnings or errors. The gate is still blocked by
  real-integration defects: the first model plan was rejected with only the
  generic `analysis_python_policy_failed` warning, subsequent accepted programs
  used JSON `null` and then a nonexistent `labrat.generate_result_id` runtime
  method, and both required another paid model revision before Python succeeded.
  At 1280px the modification textbox ends at 1313px and Send occupies
  1313-1371px, outside the viewport. Approved-chart management loads the right
  3-trace data but constrains Plotly to about 79px wide. Inserting before a page
  exists creates the inconsistent `0 pages with 1 blocks` state; a page must be
  added manually. The backend persisted one manuscript, but the project list
  still reports `No manuscript` / 0 manuscripts. Lower-severity gaps are the
  plan's per-field 61/63 coverage implying only two exclusions when the joint
  intersection yields six, and validated result rows reporting `No lineage
  returned` despite source-backed trace refs. Starting the isolated backend also
  requires loading both `.env` (model credentials) and `.env.local` (executor),
  otherwise the runtime status correctly reports the model as unavailable.
- Repaired the real DataSnapshot-to-ChartSpec E2E defects found during the
  63-head `test1` run. Analysis planning now describes the executor input as a
  Python dictionary, requires the exact trace/unit/missing-policy contract,
  excludes identity-only fields from scientific selection, and records an
  explicit natural-label or workbook-index order. Validation now rejects order
  drift, groups repeated diagnostics, exposes Python policy/rule/line details,
  and labels exclusions with experiment names. The frontend now lazy-loads
  nested `detailRequired` ChartSpecs, renders and snapshots their complete
  traces for Manuscript/Canvas, distinguishes validated analysis evidence from
  missing source snapshots, and manages durable approved ChartSpecs separately
  from proposals. Project-list summaries report published experiments/specs
  before a project is opened; the 1280px review layout is bounded; long AgentRun
  requests show phase, elapsed time, and a real cancel action propagated to the
  backend provider request. Full verification passed with frontend 268/268,
  backend 250 passed plus 1 optional PostgreSQL skip, and the production build
  with the existing Plotly chunk warning. Browser QA at 1280px against the
  isolated 63-head clone confirmed 63 experiments in the unopened project row,
  backend model/Python/data status, the separate Approved ChartSpecs surface,
  and no console warnings/errors. Automated regressions cover complete
  analysis ChartSpec detail loading, nonblank preview inputs, immutable Canvas
  snapshots, insertion, cancellation, and grouped diagnostics. A fresh real
  Anthropic plus local-Python artifact replay remains the final acceptance gate.
- Ran the real Anthropic plus local-Python DataSnapshot-to-ChartSpec browser
  workflow against an isolated in-memory clone of `test1` with 63 active
  experiment heads. The UI showed exact `Sheet1!A3:A63` identity and
  `Sheet1!L3:N63` selectivity rectangles, accepted conversational revisions,
  executed the frozen program, validated 57 result rows and 3 traces with 6
  explicit exclusions and a passing 100% row-sum invariant, toggled reviewed
  default traces, published exactly one `origin: analysis_result` ChartSpec,
  and reloaded it with 63 input snapshot refs, 246 source refs, and 3 default
  traces. The initial AgentRun used Anthropic `claude-sonnet-4-5`, 7,901 input
  tokens, 3,012 output tokens, and 50,249 ms latency. The browser console had
  no warnings or errors. The acceptance gate remains open because the real run
  exposed blocking integration defects: the model prompt incorrectly describes
  the runtime dict as `tables.records`; the result trace and missing-policy
  wire shapes are under-specified, causing a second validation failure; policy
  failures hide their actionable rule; validation renders roughly one repeated
  error per trace; `Manage approved charts` shows zero items despite one
  persisted ChartSpec; and both the Manuscript insert preview and inserted
  Canvas chart are blank while reporting `Missing source snapshot`. Additional
  UX findings: project-list data/chart counts remain stale until opening the
  project, the review composer is outside the clickable viewport at the default
  1280px width, long provider waits show only `Thinking...`, source-order bars
  are not experiment-number ordered, exclusions expose internal ids instead of
  experiment labels, and the trace selector says `Default visible experiments`
  for component traces.
- Implemented the DataSnapshot-to-ChartSpec frontend-closure runtime slice.
  Added authenticated project analysis capabilities, an editor-only
  evidence-blocked retry with durable warning proof, required server-side
  idempotency receipts, and atomic memory/Postgres provider-call claims with a
  six-minute abandoned-claim lease, strict HTTPS worker readiness, and
  development-only local executor documentation/configuration. Added compact
  LabRat model/Python/data
  status, real AgentRun-warning retry, project-switch isolation, and
  fail-closed model/executor UI gates that leave feedback usable. Analysis plan
  drafting now uses a provider-enforced JSON Schema and a 6400-token plan
  budget after the first real 63-head attempt preserved a 2400-token truncation
  failure. The final `npm run codex:verify` passed with frontend 263/263,
  backend 245 passed plus 1 optional PostgreSQL skip, and a production build with the
  existing Plotly chunk warning. A no-provider diagnostic on an isolated clone
  of `test1` exercised the actual local `python -I` adapter across 63 active
  heads on a fresh clone: 57 validated rows, 6 reasoned exclusions, 3 traces,
  passing row-sum invariants, exactly one atomically persisted
  `origin: analysis_result` ChartSpec after reload, 63 input snapshot refs, and
  184 source refs. This diagnostic does not satisfy
  the real-provider/UI acceptance gate. Starting the real Anthropic clone is
  pending explicit user approval to send bounded project/experiment/field
  metadata to the external provider; scalar DataSnapshot values remain local.
- Approved and documented the real DataSnapshot-to-ChartSpec frontend closure
  milestone. The plan enables the local Python adapter only in development,
  preserves the production-local prohibition, adds backend model/executor
  capability visibility, provides `Retry with published data` for
  `analysis_evidence_required` threads, blocks plan acceptance before an
  executor is available, and requires a real Anthropic plus local-Python E2E
  through red-box plan review, validated result review, and atomic ChartSpec
  publication against all 63 active `test1` experiment heads. The focused plan
  is `doc/plans/datasnapshot-to-chartspec-frontend-closure-plan.md`.
  Documentation-only checkpoint; no runtime configuration, code, real model
  request, Python execution, or project artifact was changed.
- Approved and documented the chat workbook file-entry redesign. Future chat
  uploads will show one filename button per WorkbookReviewSession rather than
  one button per detected region. The button will reload the exact historical
  session and open the existing Workbook Review region list, preventing both
  chat clutter and cross-file active-state mistakes. The focused design is in
  `doc/plans/chat-workbook-file-entry-design.md`; implementation is now the
  first recommended slice. Documentation-only checkpoint; implementation and
  behavior verification have not started.

## 2026-07-21

- Grounded row-oriented workbook summaries in a deterministic read of the
  complete experiment-identity column when it fits the 500-cell evidence
  boundary. A 63-row, two-header-row regression now proves `A3:A63` contains
  61 identified rows with first/last ids `Exp1`/`Exp61`; model claims based on
  the 25-row inspection sample (such as Exp1-Exp18 or sample-only numeric
  ranges) are excluded from the visible summary. Full identity evidence now
  participates in the revision source hash. Region confidence preserves the
  deterministic structural score, capped at 85% for truncated inspections,
  and the UI labels it as structure confidence rather than general scientific
  confidence. Verification: backend 236 passed plus 1 optional PostgreSQL
  skip, frontend 252/252 passed, and production build passed with the existing
  Plotly chunk-size warning. Three known full-sheet timing tests initially
  timed out under concurrent backend/test/build load, then passed individually
  and in the complete standalone frontend run.
- Fixed workbook-region interpretation failures reported for
  `MasterTable_updated.xlsx` (`Sheet1!A1:Y63`). Anthropic region requests now
  use provider-enforced JSON Schema output, return a compact correction patch
  over the deterministic proposal instead of copying all detected fields, and
  distinguish token-limit truncation from malformed output. The production
  Schema was reduced to Anthropic's accepted complexity and constrains field
  roles/value types to backend-supported values; empty required wire values are
  stripped before the patch reaches scientific-data validation. A real
  Anthropic smoke request with a synthetic 25-column, 63-row master-table shape
  returned valid structured output. Verification: backend 235 passed plus 1
  optional PostgreSQL skip, frontend 252/252 passed, and the production build
  passed with the existing Plotly chunk-size warning.

## 2026-07-20

- Fixed local backend startup so the documented development accounts are
  actually available after `npm --prefix backend run dev`. The dev script now
  loads root `.env` and Git-ignored `.env.local`; `.env.example` documents the
  seed-account switch, local session secret, and optional backend model config.
  Production startup remains environment-managed and still rejects development
  account seeding. Direct login smoke on the restarted in-memory backend passed
  for `labuser`; focused startup/config tests passed 7/7, the backend suite
  passed 234 with 1 optional PostgreSQL skip, and the production build passed
  with the existing Plotly chunk-size warning.
- Completed region-understanding implementation Task 8 and the full cutover.
  `npm run codex:verify` passed with frontend 252/252, backend 234 passed plus
  1 optional PostgreSQL integration skip, and a successful production build
  with the existing Plotly chunk-size warning. Desktop browser QA uploaded the
  repository synthetic master workbook, reviewed backend-bounded summaries,
  created immutable revision 2 from user feedback, confirmed Runs, ignored
  README, bulk-created four experiment identities, published Exp28-Exp31, and
  verified reload plus Solid/Liquid/Gas Browser columns and source values. QA
  found and fixed initial active-region/sheet desynchronization with a focused
  regression test. At 390x844, Overview and Workbook Review now stack without
  page-level overflow (`scrollWidth === clientWidth`); a clean page reported
  zero console errors or warnings. The QA provider was a local deterministic
  stub and no workbook data was sent externally. Follow-up: exercise migrations
  013/014 against configured PostgreSQL in CI or staging.
- Completed region-understanding implementation Task 7. Reconciled the active
  README/agent guidance, roadmap, milestone, checklist, API/database/project-
  state/data-dictionary contracts, architecture/AI boundaries, durable
  decisions, and approved design/implementation plans around
  WorkbookReviewRegion plus immutable RegionUnderstandingRevision. The docs now
  specify bounded model context, independent lifecycle decisions, exact accepted
  revision DataPlan dependencies, logical-delete history retention, region-only
  project state, aggregate-route `404` behavior, migrations 013/014, and the two
  current ChartSpec origins. Verification: documentation diff check passed with
  line-ending notices only; region and golden route selection passed 4/4; active
  source scanning found no aggregate production API/data dependency. Next: full
  verification and desktop/mobile browser QA.
- Completed region-understanding implementation Task 6. Retired aggregate
  WorkbookUnderstanding persistence, project-state fields, session revision /
  confirmation handlers, project listing route, frontend API helpers, and the
  obsolete client review-state compatibility module. Migration 014 drops the
  aggregate table and embedded session columns; WorkbookReviewSession now only
  groups source review activity and exposes transient upload-time candidates.
  Project Overview derives review progress from active region statuses, opens
  the session containing the latest pending region, and never claims an entire
  workbook is accepted. Tests now pin the retired routes to 404 and require
  region-only project state. Verification: backend region/session/route coverage
  passed 37/37; frontend API, region dock, and ProjectDashboard coverage passed
  75/75; syntax and diff checks passed. The optional Postgres route test was
  skipped because no test database is configured. Three full-sheet UI tests
  were confirmed independently before their condition-wait budgets were made
  robust for cumulative JSDOM execution. Next: reconcile active contracts and
  golden workflow docs, then run full verification and browser QA.
- Completed region-understanding implementation Task 5. Workbook Review now
  keeps the full progressively loaded Excel grid beside compact LabRat region
  cards. Each server-owned region independently shows its range, 2-4 sentence
  backend AI summary, confidence, notices, revision state, feedback input,
  revise, exact-revision confirm, ignore, and logical delete; accepted deletion
  requires confirmation. Drag/right-click creates a new backend region, card
  focus alone controls the blue range, and Ctrl-drag no longer toggles or
  removes prior regions. DataPlan review collects every active accepted revision
  in the current session. Removed the checkbox set, structured fallback editor,
  and workbook-wide confirmation from the UI. Verification: frontend API/dock/
  complete ProjectDashboard coverage passed 75/75, the long-range focus case
  passed independently, and the production build passed with the existing
  Plotly chunk warning. Next: retire aggregate WorkbookUnderstanding storage,
  routes, helpers, and project-state fields.
- Completed region-understanding implementation Tasks 1-4. Added migration 013
  plus memory/Postgres parity for stable workbook regions and immutable
  revisions; backend-only bounded model interpretation; independent nested
  create/revise/confirm/ignore/logical-delete APIs; project accepted-region
  listing; and session seeding of detected region cards. Evidence retrieval,
  DataPlan schemas/tools/drafting, deterministic preview execution, stale
  checks, idempotent publish, DataSnapshot lineage, Browser heads, and the
  grouped-header golden paths now depend on exact active accepted region
  revision ids instead of aggregate WorkbookUnderstanding facts. Verification:
  focused evidence/DataPlan/executor/publish coverage passed 36/36, the complete
  SaaS route suite passed 30/30, syntax and diff checks passed. Next: replace
  the old Workbook Review dock with compact independent region cards, then
  remove the aggregate persistence/routes and finish full QA.
- Approved the written region-level Workbook Understanding specification and
  started the executable TDD plan at
  `doc/plans/workbook-region-understanding-redesign-implementation-plan.md`.
  The plan covers Region/Revision persistence, bounded backend model
  interpretation, nested per-region APIs, accepted-region evidence/DataPlan
  cutover, simplified cards, aggregate contract retirement, and golden QA.
  Preflight passed. The initial full baseline run passed 260/262 frontend tests;
  the two full-sheet timing cases failed at the five-second boundary, then both
  passed independently (1/1 each), identifying existing full-suite concurrency
  sensitivity rather than a product regression. Implementation now proceeds on
  the existing feature branch; unrelated untracked tool files remain untouched.
- Approved the region-level Workbook Understanding redesign and documented the
  contract cutover in
  `doc/plans/workbook-region-understanding-redesign-design.md`. The design keeps
  SourceDocument evidence and WorkbookReviewSession grouping, replaces aggregate
  WorkbookUnderstanding acceptance with immutable per-region revisions and one
  accepted pointer, adds independent create/revise/confirm/ignore/logical-delete
  APIs, wires bounded backend model interpretation, and changes evidence/DataPlan
  dependencies to exact accepted region revision ids. Historical source and
  downstream artifacts never cascade-delete. Documentation-only checkpoint;
  implementation and API/schema changes have not started.
- Completed progressive full-sheet Workbook Review loading and
  checkbox-controlled blue highlights. The current sheet now keeps its complete
  metadata `usedRange`, loads visible 40-by-12 tiles first, hydrates every
  remaining tile through a three-worker queue, retains normalized cells plus
  empty/completed tile state per document/sheet, ignores late responses from
  inactive sheets, reports loaded/incomplete progress, and retries only failed
  ranges while every backend read remains at or below 500 cells. Checked region
  ids are now the sole editable-blue-highlight state: ordinary drag replaces
  them, Ctrl/Command drag adds or toggles, and activating another review card
  only focuses its source range. Browser QA on `Calculation Exp19.xlsx`
  confirmed `A1:CE73` completed as 14/14 ranges without scrolling, a second
  `A1:CE108` sheet completed as 21/21, returning to Sheet1 immediately restored
  14/14 and loaded cells, checkbox/blue-cell correspondence, independent card
  activation, ordinary replacement, Ctrl addition, and Ctrl toggle removal.
  QA found and fixed a `red_box_click` focus regression before completion.
  Independent review added frozen-request coverage for visible-before-
  background ordering, the three-worker concurrency ceiling, top-tile priority
  after Sheet switches, and latest-selection use when a drag ends on the global
  mouseup handler. Verification: frontend 262/262, backend 230 passed with 1
  optional Postgres skip, and production build success with the existing Plotly
  chunk warning.
  Remaining risk: the grid still renders the complete usedRange DOM, so
  unusually large sheets need a future virtualized rendering architecture.
- Approved the written full-sheet Workbook Review specification and created the
  executable TDD plan at
  `doc/plans/workbook-full-sheet-selection-highlights-implementation-plan.md`.
  The plan separates pure full-sheet tile ordering, controlled checked-region
  state, three-worker background hydration with per-sheet cell/completion
  caches, usedRange-preserving focus, retry/progress UI, full verification, and
  browser QA. Planning checkpoint only; no product code changed yet.
- Approved the design direction for full-sheet Workbook Review loading and
  checkbox-controlled blue selection highlights. The written specification at
  `doc/plans/workbook-full-sheet-selection-highlights-design.md` keeps the
  backend 500-cell evidence boundary, prioritizes visible 40-by-12 tiles, fills
  the rest of the current sheet with bounded concurrency, retains normalized
  cells across navigation, and separates active-region focus from checked
  revision/highlight state. Ordinary drag becomes exclusive while Ctrl/Command
  drag remains additive/toggle. Documentation-only checkpoint; preflight
  passed. Follow-up: written-spec review, then create the TDD implementation
  plan.
- Completed conversational-analysis implementation Task 9 and the first-party reviewed analysis chart milestone. Added a real grouped-selectivity workbook golden route test covering accepted DataSnapshot heads, natural-language routing, feedback revision 2, exact-hash plan acceptance, deterministic execution, row-sum validation, atomic analysis-result ChartSpec publication, reload, full trace catalogs, and source lineage without legacy artifacts. Added a stateful frontend golden workflow from LabRat request through red-box plan review, result acceptance, Manuscript insertion, and placement-local trace filtering; reconciled API/schema/data/architecture/AI contracts for both ChartSpec origins. Browser QA confirmed direct project answers, exact `Sheet1!L3:N4` red cells, no pre-accept execution, 2 inputs/2 outputs/0 exclusions, two default-visible experiment traces, one published chart, independent duplicate placements after save/reload, desktop/mobile layouts, and no new console errors. QA also found and fixed three frontend integration defects: persisted chart blocks now render from their complete immutable snapshots instead of bounded project summaries, unchanged selected-chart context no longer causes a React update loop, and chart preview title/legend spacing no longer overlaps. Verification: frontend passed 250/250 with a four-worker Vitest cap for stable Windows execution and an explicit 15-second budget for the intentional 1,200-trace pagination case; backend passed 230 with 1 optional Postgres skip; and the production build passed with the existing Plotly chunk warning. The first default-concurrency verification attempt recorded two existing 5-second jsdom timeouts; both passed alone before the repeatability settings were applied. Production still requires the hardened external worker and deployment-managed provider credentials; PPTX trace filtering is covered by automated export tests.
- Completed conversational-analysis implementation Task 8. Added a shared `normalizeChartView(chartSpec, persistedView)` and trace catalog projection that migrate legacy source `selectedExperimentIds`/`excludedExperimentIds` into stable ids while inheriting analysis-result reviewed defaults. Manuscript insertion now lazy-loads `detailRequired` ChartSpecs before storing a complete immutable snapshot; every placement persists only its own `visibleTraceIds`, renders independently, contributes a bounded trace catalog/current view to LabRat context, and exposes searchable trace checkboxes plus Select all/Clear in the inspector. Changes participate in history, so two placements of one ChartSpec remain independent through undo/redo. PPTX export and shared previews use the same normalized view, including legacy source compatibility, while hidden arrays remain in the immutable snapshot. Verification: focused chart-view/renderer/Canvas/export/ProjectDashboard coverage passed 100/100, full frontend passed 247/247, syntax and diff checks passed, and production build succeeded with the existing Plotly chunk-size warning. Next: Task 9 golden workflow, final contracts, full verification, and browser QA.
- Completed conversational-analysis implementation Task 7. Added strict `labrat.chartSpec.v2` `origin: analysis_result` validation and a backend publisher that binds exact thread/plan/run/result/hash provenance, accepted input snapshot refs, complete finite trace catalogs, source-record lineage, and the reviewed default-visible trace subset. `POST /api/analysis-runs/:id/accept-and-create-chart` now atomically locks/rechecks active heads, updates only existing result/run/thread workflow metadata, creates one ChartSpec, links artifacts, records audit/receipt data, and supports exact idempotent replay while rejecting stale heads, hash/trace mismatches, duplicate publication, and viewer writes. Memory/Postgres stores share the boundary; optional Postgres route coverage exercises it when a test database is configured. Project/list responses whitelist bounded trace metadata/counts while `GET /api/chart-specs/:id` returns full arrays. The Analysis Review acceptance control is wired to the real backend; analysis-result charts are active project artifacts and render through the shared preview with default/local trace filtering and separate axes for incompatible units. Stabilized the large-workbook viewer regression by waiting for fetched cell content instead of a pre-fetch window label. Verification: `npm run codex:verify` passed with frontend 239/239, backend 229 passed plus 1 optional Postgres integration skip, and a production build with the existing Plotly chunk-size warning; post-review focused hardening passed 43 backend and 87 frontend tests plus syntax/diff checks. Next: Task 8 placement-local Canvas trace visibility and export.
- Completed conversational-analysis implementation Task 6. The Analysis Review workspace now loads exact run/result identities and complete paged trace catalogs, exposes Source/Result/Chart tabs, shows input/output/exclusion counts, missing-value policy, warnings, invariants, validated values, per-row lineage/source navigation, independently paged source evidence, immutable hashes, and unit-compatible chart panels. The split LabRat composer accepts only a validation-passing hash-matched result view or sends result-hash-bound feedback to a later immutable plan revision; revision/run history can rehydrate earlier results without stale async preview responses crossing runs. Users can choose the default visible trace subset while retaining the complete validated trace domain. Verification: focused workspace edge coverage passed 14/14, related API/workspace/conversation/ProjectDashboard coverage passed 63/63, `git diff --check` reported only existing Windows line-ending warnings, and the production build passed with the existing Plotly chunk-size warning. The acceptance button remains intentionally disabled in the real app until Task 7 wires the atomic result-plus-ChartSpec publication route.
- Completed conversational-analysis implementation Task 5. Added a versioned static Python policy plus runner-side AST checks, canonical accepted-run packages, backend-only disabled/local/hardened-worker executor adapters, transactional active-head verification, claim-token lease recovery, and atomic AnalysisRun finalization in memory/Postgres stores. Deterministic validation now enforces the supported output encoding, finite declared fields, plottable x/y values, exact experiment/snapshot identity, declared units, accepted-record lineage, complete output-or-reasoned-exclusion accounting, missing policy, limits, and manifest invariants. Added execute/detail/independently paged preview/revise routes with viewer/editor coverage; only valid output creates one immutable `awaiting_review` AnalysisResult, while stale, failed, or invalid execution persists no result or ChartSpec. Result feedback is bound to the exact visible result hash and creates a later immutable plan revision. Verification: full frontend passed 222/222, full backend passed 223 with 1 optional Postgres integration skip, focused executor/policy/validator/thread/route coverage passed, an actual local-runner smoke check and syntax checks passed, and the production build passed with the existing Plotly chunk-size warning. Next: Task 6 result review UI and revision loop.
- Completed conversational-analysis implementation Task 4. Added authenticated analysis thread/revision/selection/accept API helpers and normal LabRat analysis-plan cards that open a full Source/Result/Chart review workspace. Source review reuses the Excel grid, preserves every non-contiguous accepted source rectangle as a separate selector, and renders reviewed cells in red without making them editable drafts. The conversation rail shows the request, readable field coverage, processing steps, warnings, revision history, and expandable exact Python; its split composer sends feedback as a new immutable revision or accepts only the visible revision's exact plan/selection/dependency hashes. Reopening a stale conversation card now resolves the latest non-superseded server revision. Result and Chart stay disabled after acceptance while the queued-run notice explicitly says no result/chart exists. Browser QA used repository-owned synthetic workbook data and a local deterministic provider stub only: it verified analysis routing without a Browser action, `C2` plus `C5:C6` red ranges, revision supersession, acceptance/queueing, desktop split layout, corrected mobile stacked layout, and no page-level horizontal overflow. No external provider received QA data. Verification: targeted frontend analysis/API/workspace/AgentPanel tests passed 51/51, production build passed with the existing Plotly chunk-size warning, and `git diff --check` reported only existing Windows line-ending warnings. Next: Task 5 versioned executor policy, sandbox adapter, and result validation.
- Completed conversational-analysis implementation Task 3. Added migration 012 and memory/Postgres parity for durable AnalysisThreads, immutable numbered AnalysisPlanRevisions, idempotent queued AnalysisRuns, reserved AnalysisResults/publication receipts, and an atomic future result-plus-ChartSpec store boundary. Added project/thread/revision/selection/accept routes with editor authorization, bounded lists/selection pages, exact plan/selection/dependency hashes, active-head stale detection, immutable feedback revisions, and no calculation/chart side effects. AgentRun analysis requests now create a durable thread and, when accepted data plus the backend provider are available, a backend-drafted first revision; feedback-only requests are redrafted on the backend. Model-selected plans receive backend-owned selection, source-rectangle, and Python hashes. Updated API/schema/data/architecture/AI/state contracts. Verification: `npm run codex:verify` passed with frontend 212/212, backend 192/192 plus 1 optional Postgres integration skip, and a successful production build with the existing Plotly chunk-size warning. Next: Task 4 LabRat conversation/Excel plan review UI.
- Completed conversational-analysis implementation Task 2. Added `AnalysisPlanRevision` schema/frozen hash validation, exact Python source hashing, result-array rejection, accepted-head-only `AnalysisSelection`, unit/value-type-aware field ids, explicit coverage and limits, ambiguous alias blockers, stable dependency/selection hashes, and non-contiguous source rectangle compression. Added a pre-allocation 100,000-cell source-rectangle guard after a RED test demonstrated an OOM risk. Added a project-scoped framework-independent six-tool AnalysisToolRegistry with bounded previews/inspection and no execution tool, mounted once in backend server context, and reused the Browser active-head resolver. Updated canonical-data/API/architecture/AI contracts. Verification: 19 task/regression tests passed and full backend passed 181 plus 1 optional Postgres skip. Next: Task 3 persistence and plan revision routes.
- Completed conversational-analysis implementation Task 1. Added a backend-only Anthropic provider adapter with structured JSON validation and bounded provider metadata; added deterministic/model-assisted intent routing; changed AgentRun and compatibility planning so project-purpose/overview questions answer directly, derived trends/comparisons/calculations/charts enter `analysis_planning`, unknown messages clarify, explicit Browser navigation remains an action, and source-extract requests retain their reviewed path. Removed browser provider key/model settings and direct provider fetch/streaming; legacy stored provider keys are cleared on load. Updated API/architecture/AI contracts. Verification: frontend 212/212, backend 166 passed plus 1 optional Postgres skip, production build passed with the existing chunk-size warning. Next: Task 2 accepted-snapshot selection schemas and framework-independent planning tools.
- Approved the written backend conversational-analysis design and created the executable TDD implementation plan at `doc/plans/backend-conversational-analysis-chart-implementation-plan.md`. The active milestone now covers backend intent/provider migration, accepted-data planning tools, immutable analysis persistence, Excel red-box plan review, versioned execution/result validation, atomic analysis-result ChartSpec publication, and placement-local Canvas trace visibility. Implementation is in progress; no production behavior is claimed by this planning checkpoint.
- Added the written design for backend conversational analysis, reviewed Python calculation, DataSnapshot-backed ChartSpecs, and placement-local Canvas trace visibility at `doc/plans/backend-conversational-analysis-chart-design.md`. The approved workflow moves provider access to the backend, routes ordinary questions to direct answers when scope is unambiguous, shows model-selected accepted data as Excel red boxes beside the LabRat conversation, freezes a machine-readable calculation manifest plus exact Python only after plan acceptance, executes it in a LabRat-managed sandbox, validates and re-reviews the result, and atomically accepts the result plus ChartSpec. ChartSpecs retain the complete accepted trace catalog while each Manuscript placement independently controls visible traces and inherits the result-review view. Recorded the durable architecture decision and updated the short plan/current milestone. Documentation-only; preflight passed. Follow-up: written-spec review, then create a milestone implementation plan; no implementation started.

## 2026-07-19

- Fixed the workbook-review and Experiment Browser regression batch. Project-content questions now return a direct project summary without proposing a confirmation-gated Browser action while explicit upload/chart requests retain action priority; Experiment Browser has one horizontal scroll owner; Ctrl/Meta drag adds or toggles workbook ranges while normal drag replaces the active range; accepted/published reviews show accepted state and published counts instead of `Continue review` and mixed pending/accepted projects open the selected session; and merged two-row headers such as `Selectivity (%)` over `Solid`, `Liquid`, and `Gas` preserve merge evidence, parent/leaf header refs, and all three source-backed fields through publish. Added planner conflict, route, grouped-header provenance, mixed Overview-state, range-selection, and scrollbar regressions; updated the API/data contracts. Independent review findings were fixed and rechecked. Verification passed with frontend 211/211, backend 150 passed plus 1 optional Postgres skip, production build success with the existing chunk warning, and `git diff --check` with existing line-ending warnings only. Browser QA confirmed the direct Chinese summary, accepted-review Overview state, all three Selectivity columns and exact values for two experiments, one horizontal scroll owner with no page overflow, and no browser warnings/errors. Ctrl/Meta range behavior remains listed for hands-on pointer QA in a real workbook.

## 2026-07-17

- Added bulk ExperimentIdentity review and stable Excel preview tile loading. `DataPlanReviewPanel` now summarizes new/reused/unresolved/conflict counts, creates all unmatched identities in one action, accepts unique exact matches together, supports selected-row create/reuse/clear actions, filters decision states, and undoes the latest batch while keeping Apply and Publish as separate explicit confirmation boundaries. Existing identities now match and display their canonical labels. `WorkbookReviewWorkspace` now reads stable 40-by-12 tiles capped at 480 cells, coalesces scroll updates, waits for scroll settling, reuses pending requests, keeps fulfilled tiles in a bounded LRU cache, prefetches one directional neighbor, retains prior cells, and shows local skeletons for missing visible tiles. Workbook/Sheet/range changes reset the actual Data Grid scroll element, and workbook changes adopt the selected workbook's own `usedRange`. Added 60-identity, canonical-label reuse, selection/filter/undo, workbook-switch, stable-scroll/cache-return, 500-cell-limit, LRU, prefetch, red-box, and edge-scroll coverage. Verification passed: `npm run codex:verify` with frontend 206/206, backend 144 passed plus 1 optional Postgres skip, production build success with the existing chunk warning, and `git diff --check` with existing line-ending warnings only. Browser QA on `MasterTable_600.xlsx` confirmed right-side tile loading, immediate return to cached A-column values without another loading state, no layout overflow, and no browser warnings/errors. Remaining risk: React Data Grid still renders the complete selected range DOM with virtualization disabled, so very large selected ranges need a later rendering architecture change.

- Fixed workbook upload failure for detected master-table regions between 501 and 600 cells. WorkbookUnderstanding inspection had a 600-cell window while the SourceDocument range contract capped every read at 500, so a 24-column by 25-row candidate generated an invalid 600-cell request and aborted WorkbookReviewSession creation. Exported the canonical 500-cell range limit from `sourceDocuments.js`, reused it in `workbookUnderstandingPreview.js`, and retained the full selected red-box range while inspecting a bounded window (`A1:X25` -> `A1:X20`, 480 cells). Added a regression reproducing the exact failure. Verification passed: targeted preview tests 8/8, full backend 143 passed plus 1 optional Postgres skip, production build with the existing Plotly/chunk warning, and a live authenticated API smoke test where a generated 600-cell workbook upload and WorkbookReviewSession creation both returned 201 with the full `A1:X25` review range. The local in-memory backend was restarted for the fix, which cleared prior development sessions and project state.

- Completed Workbook-to-Browser Milestone 7 legacy retirement and golden workflow. Removed the active DatasetCommit/MappingSet/AnalysisView/ObservationSeries and generic import/chart contracts from stores, routes, frontend helpers, renderers, and tests; retired unscoped import/normalize/semantic-map/generic chart endpoints; added migration 011 to drop legacy persistence; and made ChartSpec validation, previews, Manuscript insertion, and PPTX export source-snapshot-only. Added golden route coverage proving uploaded workbook evidence can be reviewed, confirmed, compiled into a deterministic experiment-record DataPlan/DataSnapshot, published atomically, reloaded, and projected into Browser without legacy artifacts. Rewrote the active API/schema/data/architecture/AI/QA docs around the accepted WorkbookUnderstanding -> DataPlan -> DataSnapshot -> experiment heads -> Browser chain. Browser QA on `LabRat_Test_Master.xlsx` confirmed the docked red-box conversation, natural-language README exclusion, read-only accepted semantics, four-record preview, explicit Exp28-Exp31 identity decisions, Browser publish, dense cross-experiment table, four-experiment comparison, source return to `Runs!A1:K5`, source-range-only chart prompt, and Manuscript approved-ChartSpec boundary; browser logs contained no warnings or errors. QA also found and fixed `ignored` phrasing classification and stopped backend `npm run dev` from watch-restarting the in-memory session during uploads/review. Updated the synthetic workbook instructions to the active review/publish workflow. Verification passed: `npm run codex:verify` with frontend 198/198, backend 142 passed plus 1 optional Postgres skip, and production build success with the existing Plotly/chunk warning. Follow-up: define accepted DataSnapshot-backed chart proposal and ChartSpec planning.

## 2026-07-16

- Completed Workbook-to-Browser Milestone 6 personal views and comparison. Added owner-isolated viewer-authorized BrowserView CRUD with bounded display-only payload validation and single-default behavior; added frontend CRUD helpers; replaced the temporary column menu with a keyboard-aware drawer supporting visibility, order, width, reset, and focus restoration; and added save/update/rename/default/delete controls that preserve valid columns, filters, sort, and selected experiment ids while pruning deleted columns. Cross-experiment selection now survives search/filter changes in a fixed tray and lazily opens a source-backed scalar/series inventory table; fields with incompatible units remain separate and no scientific values are persisted in BrowserViews. Fixed a controlled-selection feedback-loop risk found during integration review. Verification passed: targeted frontend 14/14, full frontend 246/246, backend 209 passed with 1 optional Postgres test skipped, SaaS routes 19/19, production build, and `git diff --check` with existing LF/CRLF warnings only. Follow-up: retire active DatasetCommit/generic paths and prove the golden workbook workflow.

- Completed Workbook-to-Browser Milestone 5 Snapshot-backed Experiment Browser. Added the accepted-snapshot/head projection, stable unit-aware columns and deterministic recommendations, opaque cursor pagination, typed search/filter/sort, project-isolated list/detail routes, bounded list rows without point arrays, and lazy full experiment detail. Replaced the active generic-import Browser call site with a dense virtualized table, recommended/user-visible columns, persistent in-view row selection, and a right-side detail drawer with scalar fields, series inventory, warnings, and source links. Source navigation now reloads the accepted WorkbookReviewSession and focuses evidence without creating or mutating a semantic red box. Browser QA used a real 1,000-row workbook: publish created 1,000 accepted experiment records and no legacy/chart/manuscript artifacts; the Browser loaded 200 rows per page while rendering 22 DOM rows, searched `Exp0999`, opened source-backed detail, and returned to the accepted two-red-box structured interpretation. Fixed null numeric filters, restored `sourceDocuments` in project state, and removed duplicate unit suffixes in headers. Verification passed: backend 208 passed with 1 optional Postgres test skipped, frontend 238/238, production build, and `git diff --check` with existing LF/CRLF warnings only. Follow-up: implement personal saved views and the persistent scalar/series comparison tray.

- Completed Workbook-to-Browser Milestone 4 transactional publish and persistence. Added migration 010, memory/Postgres parity for accepted DataPlans, immutable DataSnapshots, stable ExperimentIdentities, active experiment snapshot heads, BrowserViews, and idempotency receipts; implemented one atomic `publishExperimentSnapshot(...)` boundary with backend evidence re-read/re-execution, canonical stale-preview checks, exact retry replay, conflicting-key rejection, affected-head-only advancement, rollback validation, editor authorization, audit recording, and no DatasetCommit/chart/manuscript side effects. Wired publish progress, stale-review refresh, double-submit prevention, and a locked success state into the DataPlan review panel. Browser QA published four real workbook experiments and confirmed 1 accepted plan, 1 accepted snapshot, 4 heads, and zero legacy/output artifacts. Also restored `sourceDocuments` summaries to project state so Overview reports uploaded evidence correctly, and replaced one random-id-sensitive test assertion. Targeted publish/route/frontend tests and production build passed; full-suite verification follows before Milestone 5 completion. Postgres integration remains conditionally skipped without `LABRAT_TEST_DATABASE_URL`. Follow-up: build the cursor-paginated Snapshot-backed Experiment Browser and lazy detail drawer.

- Completed Workbook-to-Browser Milestone 3 experiment-record DataPlan preview. Added `labrat.dataPlan.v2` and `labrat.dataSnapshot.v2`, deterministic row- and region-oriented extraction from accepted WorkbookUnderstanding evidence, canonical dependency/plan/preview hashing, typed scalar and series values, canonical Excel dates, exact source refs, explicit skipped rows, bounded 500-cell reads with a 50,000-cell plan cap, visible parse warnings, and strict create/reuse identity blockers for blank, duplicate, or unresolved aliases. Replaced the active draft route with backend-owned accepted-understanding reload and SourceDocument reads, kept previews transient, and added the dense DataPlan review panel with field/unit coverage, source navigation, explicit identity decisions, and publish gating that rejects unconfirmed local changes. Independent code review findings were resolved, including canonical hashes, generic result-array rejection, aggregate read limits, warning promotion, and stale UI decisions. Browser QA covered a real four-experiment workbook, source navigation, identity resolution, and a 768px layout without page overflow. Verification passed: targeted backend tests 40/40, related frontend tests 66/66, full backend tests 198 passed with 1 optional Postgres test skipped, full frontend tests and production build exited 0, and `git diff --check` reported only existing LF/CRLF warnings. Follow-up: persist accepted plans/snapshots and experiment heads through one idempotent publish transaction.

- Completed Workbook-to-Browser Milestone 2 structured WorkbookUnderstanding interpretation. Added bounded backend SourceDocument inspection for row- and region-oriented experiments; validated experiment axis, identity binding, fields, roles, value types, units, series, included/skipped rows, warnings, blockers, confidence, and exact source refs; converted scoped conversational corrections and structured controls into the same typed interpretation patches; re-read a bounded window when a corrected header falls outside the initial 25-row inspection; blocked confirmation for unresolved identity/unit decisions and required explicit low-confidence acknowledgement; and made accepted interpretations read-only in the dock. Browser QA on a real synthetic workbook covered two red boxes, active-box switching, natural-language ignore, structured role correction, confirmation, accepted-state locking, and a 768px layout with no horizontal page overflow. QA also found and fixed dock flex compression so the red-box list, messages, and interpretation editor remain reachable through one stable scroll surface. No provider call, token cost, persistence side effect, DatasetCommit, generic import, chart, or manuscript artifact was added. Updated the SaaS API contract. Verification passed: preview tests 7/7, frontend `npm test` 222/222, backend `npm --prefix backend test` 186 passed with 1 optional Postgres test skipped, `npm run build` with the existing Plotly/chunk warning, and `git diff --check` with existing LF/CRLF warnings only. Follow-up: compile accepted interpretations into transient `experiment_records` DataPlan previews.

- Completed Workbook-to-Browser Milestone 1 continuous workbook review. Added a docked `WorkbookReviewDock` beside the stable workbook grid, moved workbook correction/confirmation controls out of the global Agent, kept active-only revisions with explicit multi-box selection, made conversational text update typed red-box semantics, preserved complete red-box state across revisions, seeded detected SourceRegions as stable draft regions, linked dock activation to workbook sheet/range focus without breaking drag resize, kept confirmation in place, and added `Continue review` recovery from Project Overview after reload. Browser QA used a real synthetic workbook: `Runs` became `experiment_table`, README became `ignored_region`, both boxes survived revisions, confirmation produced `Review extracted experiments`, and a 768px viewport had no horizontal page overflow (`bodyScrollWidth === viewport width`). Screenshot capture timed out in the in-app browser, so visual verification used live DOM state plus measured desktop/narrow layout geometry. Verification passed: frontend `npm test` (218/218), backend `npm --prefix backend test` (176 passed, 1 optional Postgres test skipped), `npm run build` (`BUILD_EXIT=0`, existing Plotly chunk warning), and `git diff --check` (existing LF/CRLF warnings only). Follow-up: implement Milestone 2 structured WorkbookUnderstanding interpretation and confirmation blockers.

- Completed Workbook-to-Browser Milestone 0 contract cutover. Updated the canonical data dictionary, SaaS API/database contracts, server project-state contract, architecture, AI boundaries, and task checklist so the active source of truth is accepted WorkbookUnderstanding -> reviewed `experiment_records` DataPlan -> explicit publish -> accepted immutable DataSnapshot -> experiment snapshot heads -> cursor-paginated Experiment Browser. DatasetCommit/generic import references are now marked deprecated rather than valid new-path inputs. Also fixed a pre-existing workbook range race where a late source-region response overwrote a manual range; added a deterministic delayed-response regression. Verification passed: `npm run codex:preflight`, contract-content assertions, `git diff --check`, frontend `npm test` (207/207), backend `npm --prefix backend test` (173 passed, 1 optional Postgres test skipped), and focused BackendScanPanel tests (18/18). Follow-up: implement the continuous docked WorkbookReview conversation.

- Consolidated the approved workbook-to-table direction into `doc/plans/workbook-review-to-experiment-browser-plan.md`. The plan joins the conversational red-box review loop, structured WorkbookUnderstanding semantics, deterministic `experiment_records` DataPlan previews, transactional accepted DataSnapshot publish, stable experiment identities, a snapshot-backed Experiment Browser, recommended/user-configurable columns, personal saved views, detail provenance, and a persistent comparison tray. Updated the short plan, current milestone, and durable decisions to retire DatasetCommit/genericImports from the new product path and to defer chart/manuscript work until the Browser path is complete. Verification passed: `npm run codex:preflight`, plan-content sanity checks, and `git diff --check`; diff check retained the repository's existing LF/CRLF warnings. Follow-up: execute Milestone 0 contract cutover, then the continuous WorkbookReviewDock milestone.

## 2026-06-30

- Reorganized active planning docs. `doc/plan.md` now separates the Workbook Understanding First product mainline from the Tool-Governed DataPlan Agent engineering mainline, `doc/current-milestone.md` now owns active execution state, and `doc/task-checklist.md` is back to a reusable execution checklist rather than a milestone log. Marked Tool-Governed Evidence Retrieval as implemented/reference, clarified the DataPlan Agent plan as Phase 3 next, and updated README/START_HERE/AGENTS/preflight routing to include the current milestone file. Verification passed: `npm run codex:preflight` and `git diff --check`; diff check kept existing LF/CRLF warnings.

- Improved WorkbookReviewWorkspace repeat-load behavior for the Excel preview. Added a frontend range-window cache keyed by source document, sheet, and A1 range, plus pending request reuse so returning to a previously loaded visible range no longer calls the SourceDocument `/range` API again. The preview now keeps the previous loaded window visible while a new window is loading. Added a regression test that failed before the cache and passed after implementation. Verification passed: targeted range-cache regression, targeted `WorkbookReviewWorkspace` tests, full `npm test`, `npm run build`, and `git diff --check`; build kept the existing Plotly chunk-size warning and diff check kept existing LF/CRLF warnings. Follow-up: true large-range render performance still needs replacing the current full-range `react-data-grid` render path with a windowed canvas/tile viewer. A direct `react-data-grid` virtualization flip was tested and reverted because it broke existing drag/cell availability tests.

## 2026-06-29

- Implemented Tool-Governed Evidence Retrieval plus the transient Tool-Governed DataPlan Agent Phase 1-2 slice. Added backend evidence retrieval tools/orchestrator, project-scoped `POST /api/projects/:projectId/evidence/retrieve`, DataPlan/DataSnapshot schemas, DataPlan agent tools/orchestrator, deterministic snapshot preview execution, project-scoped `POST /api/projects/:projectId/data-plans/draft`, frontend server API helpers, API contract notes, and route/helper/unit coverage. Usable retrieval results are accepted `WorkbookUnderstanding` evidence only; unconfirmed suggestions are rejected for DataPlan use. DataPlan draft output is transient and does not persist DataPlans/DataSnapshots or create chart proposals/ChartSpecs. Verification passed: targeted retrieval/DataPlan/route/helper tests, full `npm --prefix backend test`, full `npm test`, `npm run build`, and `git diff --check`; build kept the existing Plotly chunk warning and diff check kept existing CRLF warnings. Follow-up: implement persisted DataPlan/DataSnapshot review objects and wire Chart Review/Ask LabRat chart requests to this review path before creating chart proposals.

## 2026-06-26

- Added `doc/plans/tool-governed-dataplan-agent-transition-plan.md` for the transition from Tool-Governed Evidence Retrieval to scheme 5: a Tool-Governed DataPlan Agent. The plan defines backend-owned DataPlan tools, DataPlan/DataSnapshot schemas, deterministic snapshot execution, transient draft API, persistence phase, DataSnapshot-to-chart proposal flow, frontend review integration, LLM planner adapter, cross-compare support, golden workbook tests, and cleanup boundaries. Documentation-only change; scoped `git diff --check` passed.

- Added `doc/plans/tool-governed-evidence-retrieval-plan.md` for the agent-tool retrieval direction. The plan replaces the pure deterministic retrieval approach with a read-only backend tool registry, tool-governed retrieval orchestrator, strict accepted-WorkbookUnderstanding-only usable results, non-usable unconfirmed suggestions, verifier checks for experiment/source mismatches, frontend API helper coverage, contract updates, and manual QA. Marked the older deterministic retrieval plan as superseded. Documentation-only change; scoped `git diff --check` passed.

## 2026-06-25

- Added `doc/plans/evidence-retrieval-mvp-plan.md` for the first accepted-red-box-only retrieval slice. The plan defines a read-only `POST /api/projects/:projectId/evidence/retrieve` endpoint, deterministic query parsing/scoring, accepted `WorkbookUnderstanding`-only usable results, unconfirmed `SourceRegion` suggestions with `canUseForDataPlan: false`, frontend helper coverage, contract updates, and verification. Documentation-only change; scoped `git diff --check -- doc/plans/evidence-retrieval-mvp-plan.md` passed.

- Scoped Ask LabRat chat history per project. `AgentPanel` now stores active chat messages under `labrat_blank_chat_history_v2_project_<projectId>` or a local fallback key, reloads the correct history when the active project changes, and ignores the old shared `labrat_blank_chat_history_v1_react` key for server projects so historical residue no longer leaks across workspaces. Added AgentPanel regression coverage and cleaned chat-history storage between tests. Verification: RED project-scoped history test first failed by showing legacy shared history; then targeted AgentPanel tests, `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manual browser QA should switch between two real projects and verify each keeps its own chat.

- Closed the active workbook review loop after accepted confirmation. Confirming a WorkbookUnderstanding from Ask LabRat now emits a completion callback, clears the active workbook review workspace/draft red boxes, switches back to Overview, and restores the normal Ask LabRat composer. Verification: RED targeted test first failed for the missing completion callback; then `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manual browser QA should confirm the accepted-confirmation assistant message remains visible while the Excel review closes.

- Added workbook review edge auto-scroll for red-box drag selection. The existing `react-data-grid` preview now listens for drag-selection mouse movement near the grid edge, scrolls in that direction, and extends the pending red-box range before mouseup; this keeps the current WorkbookReviewSession/revision flow unchanged and avoids adding a new spreadsheet dependency. Removed the trial `@fortune-sheet/react` dependency from the aborted方案 C check, with no `fortune-sheet` references remaining. Verification: RED test first failed because edge drag still produced `A1`; then `npm test -- src/components/ProjectDashboard.test.jsx -t "auto-scrolls and extends drag selection"`, `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manual browser QA should confirm scroll speed and drag feel on a large real workbook.

- Added a selected-range chip to the Ask LabRat workbook review composer. While a WorkbookReviewSession is active, the current pending Excel red box now appears above the revision textarea as a compact blue range label such as `C1:D2`, while the textarea still contains only the user's natural-language correction. Verification: RED targeted test failed before implementation for the missing active range display; then `npm test -- src/components/ProjectDashboard.test.jsx -t "active pending red box"`, `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manual browser QA should confirm the chip updates when selecting a different red box.

- Fixed workbook review revision targeting. Ask LabRat now submits only the active/current Excel red box with `revisionMode: "replace_current"` and `activeDraftRegionId`, the workbook preview replaces the active local draft range when the user drags a new selection, and successful revisions keep the changed region selected so a follow-up clarification reply remains bound to the same source range. Backend revision responses now expose `changedRegions`, describe only the current revision, and ask a scoped clarification for `unknown_region` instead of replying with accumulated `as unknown_region` summaries. Updated the SaaS API contract for the revision payload/response. Verification: RED tests failed first for active red-box replacement, active-only revision payload, backend current-selection reply, and server API helper payload preservation; then targeted frontend/API tests, targeted SaaS route tests, full `npm test`, full `npm --prefix backend test`, `npm run build`, and `git diff --check` passed. Backend kept the optional Postgres skip; build kept the existing Plotly chunk warning; diff check kept existing LF/CRLF warnings. Follow-up: manual browser QA should verify that selecting a new Excel range, submitting a vague correction, then replying with a clearer description keeps the same red box active.

- Completed workbook review MVP interaction cleanup. Excel preview now supports local left-drag red-box selection, and Ask LabRat switches its fixed input area to a workbook review composer during active WorkbookReviewSession review. Confirm calls the existing confirm API; revision submits natural-language text plus pending red-box updates through the existing revision API. Verification: RED tests failed first for missing drag/composer behavior, then `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manual Docker QA should verify drag feel, scrolling, suggestion click, revision loop, confirm, and reload.

- Added `doc/plans/mui-ui-migration-plan.md` as the long-term frontend migration plan for adopting Material UI. The plan sets MUI + Emotion + LabRat dense theme + wrapper components as the target, defers MUI X until table needs justify it, preserves canvas/source-grid/Plotly custom internals, phases the migration across shell/dashboard, dialogs, workbook review, chart review, Browser, Manuscript shell, and CSS retirement, and defines test/manual QA gates. Documentation-only change; no tests were run.

- Added an executable plan for workbook upload review MVP interaction cleanup at `doc/plans/workbook-review-selection-composer-plan.md`. The plan covers left-drag Excel red-box selection, fixed Ask LabRat input-area confirm/revision composer, TDD steps, existing API reuse, docs updates, verification, and manual QA. Verification: scoped `git diff --check` passed with existing LF/CRLF warnings.

- Migrated the active workbook Excel preview to a mature React 19-compatible grid. Tried Glide Data Grid first, but skipped it because its current peer dependency excludes React 19; installed `react-data-grid` instead. `WorkbookReviewWorkspace` now renders `react-data-grid` rather than the old hand-built HTML table, keeps bounded SourceDocument reads, and preserves detected/draft red-box cell styling. Verification: the new RED assertion failed before implementation; after implementation `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: browser QA should confirm horizontal/vertical scrolling and right-click red-box creation feel correct on large real workbooks.

- Ensured LabRat chat workbook upload replies are English. Replaced Chinese assistant upload success copy, changed workbook suggestion button labels to English, cleaned mojibake in the agent context strip, and updated the upload-chat regression. Verification: frontend CJK scan returned no matches in `src`, targeted `npm test -- src/components/ProjectDashboard.test.jsx -t "attaches spreadsheet files"` passed, `npm run build` passed with the existing large Plotly chunk warning, and `git diff --check` passed with existing LF/CRLF warnings.

- Cleaned the workbook review UI so Ask LabRat no longer obscures the Excel preview by default. Overview `Upload workbook` now only opens Ask LabRat, uploads still happen from the chat `+` attachment flow, entering or focusing workbook review closes the chat overlay, and the active workbook review page no longer renders the old WorkbookReviewModal/Source workbook card UI. Replaced the active workspace with a clean Excel-only grid that reads bounded source ranges, shows sheet/range controls, and highlights detected/draft red boxes. Verification: targeted RED tests failed before implementation for the old button routing and legacy source-panel rendering; after implementation `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, full `npm --prefix backend test`, `npm run build`, and `git diff --check` passed. Build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manually QA the Docker browser flow for Ask LabRat `+` upload, click a range suggestion, confirm the chat closes, and inspect horizontal/vertical Excel scrolling on a large workbook.

- Implemented Ask LabRat workbook upload and clickable red-box suggestions. The Ask LabRat `+` button now attaches spreadsheet files as pending message attachments, uploads and creates a WorkbookReviewSession only when the user sends, switches the main workspace to an Excel-like workbook review surface, and renders deterministic clickable source-range suggestions that focus/create local red boxes. Workbook review revisions still submit natural-language text plus red-box updates together, and confirm now stores accepted display status inside accepted draft regions and region summaries. Verification: targeted RED tests failed before implementation, then `node --test backend/src/saas/routes/saasRoutes.test.js`, `npm test -- src/components/ProjectDashboard.test.jsx`, `npm test -- src/components/ProjectDashboard.test.jsx src/components/BackendScanPanel.test.jsx src/data/serverApi.test.js`, full `npm test`, full `npm --prefix backend test`, `npm run build`, and `git diff --check` passed; build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manually QA the full Docker browser flow, especially `+` attachment, suggestion click, right-click/drag red-box editing, revision submit, confirm, and reload.

- Implemented the Conversational Workbook Understanding MVP. Added workbook review revision and confirm APIs, accepted `workbook_understandings` persistence/migration, deterministic red-box validation and understanding draft compilation, frontend API helpers, and a chat-style Workbook Review panel where pending red boxes plus natural-language correction submit together before confirmation. Confirming understanding does not create DatasetCommits, SourceExtractProposals, ChartSpecs, or manuscript content. Verification: targeted SaaS route tests, optional Postgres test skipped without `LABRAT_TEST_DATABASE_URL`, targeted frontend API/UI tests, full `npm --prefix backend test`, full `npm test`, `npm run build`, and `git diff --check` passed; build kept the existing Plotly chunk warning and diff check kept existing LF/CRLF warnings. Follow-up: manually QA right-click drag/multi-red-box selection in a real browser.

- Added a Postman smoke-test bundle for the local LabRat API. Created `postman/labrat-workbook-review.postman_collection.json`, `postman/labrat-workbook-review.postman_environment.json`, and `postman/README.md` covering login, project creation/state, workbook upload/review sessions, SourceDocument inspection, source extract proposal acceptance, ChartSpec creation, evidence search, chart interpretation, and planned WorkbookUnderstanding revision/confirm placeholders. Verification: collection/environment JSON parsed successfully and scoped `git diff --check` passed.

- Cleaned active docs around the Workbook Understanding First direction. Updated the short plan, start-here guide, long-form workflow plan, API contract, data dictionary, architecture, AI boundaries, roadmap, README, AGENTS, and task checklist so upload defaults to SourceDocument evidence indexing plus WorkbookReviewSession/WorkbookUnderstanding review, while DatasetCommit, SourceExtractProposal, DataPlan/DataSnapshot, ChartSpec, FigurePackage, and Manuscript remain later reviewed actions. Verification: `npm run codex:preflight`, targeted old/new term scans, and `git diff --check` passed; old normalize/relationship endpoint names remain only in removed/legacy notes, and diff check kept existing LF/CRLF warnings.

- Cleaned up the legacy import chain. Removed active master/supplement/refresh/relationship/normalize/apply product paths, deleted old import/supplement frontend helpers and backend workflow modules, added `WorkbookReviewSession` persistence/routes, switched Overview/chat upload planning to one `Upload workbook for review` path, kept SourceDocument/SourceRegion/range/source extract/chart/manuscript boundaries, and rewrote stale tests/docs around the new workflow. Verification: `npm --prefix backend test`, `npm test`, `npm run build`, and `git diff --check` passed; optional Postgres route test skipped without `LABRAT_TEST_DATABASE_URL`, build kept the existing Plotly chunk warning, and diff check kept existing LF/CRLF warnings.

- Fixed Source workbook local draft extract preview and oversized detected-region extract errors. Added read-only `POST /api/source-documents/:sourceDocumentId/extract-preview`, added the matching frontend helper, made the local draft range card preview the selected sheet/range instead of the detected region, disabled direct extract preview for detected regions over the 500-cell cap with a smaller-range hint, and updated the SaaS API contract. Verification: targeted `npm test -- src/data/serverApi.test.js src/components/BackendScanPanel.test.jsx`, targeted `node --test src/saas/routes/saasRoutes.test.js`, full `npm --prefix backend test`, full `npm test`, and `npm run build` passed; backend kept the optional Postgres skip and build kept the existing large Plotly chunk warning.

- Implemented Phase 1.1 minimal Excel-like Source Workbook viewer. Large detected/source ranges such as `A1:Y63` now remain visible as selected evidence ranges while the frontend reads bounded sheet windows through the existing `/api/source-documents/:sourceDocumentId/range` API, staying under the backend cell cap. Added scrollable row/column sheet navigation, red detected-region overlays, local-only draft selection overlays, and bounded-window regression tests. Verification: targeted `npm test -- src/data/serverApi.test.js src/components/BackendScanPanel.test.jsx`, full `npm test`, `npm run build`, and scoped `git diff --check` passed with existing large Plotly and LF/CRLF warnings. Follow-up: manually QA right-click drag selection and edge auto-scroll in a real browser because jsdom pointer tests were too brittle for that interaction.

- Reorganized LabRat documentation into AI-agent-friendly folders, added `doc/START_HERE.md`, moved long-form plans/contracts/references into `doc/plans`, `doc/contracts`, `doc/arch`, `doc/qa`, and `doc/reports`, shortened `doc/plan.md` and `doc/PROGRESS.md`, and updated documentation entrypoint references. Updated `scripts/codex-preflight.mjs` so the long-task preflight checks the new doc paths. Verification: `npm run codex:preflight`, old-path reference scan, and `git diff --check` passed; diff check kept existing LF/CRLF warnings.

- Implemented Phase 1 read-only Workbook Source Review UI. Import/scan review now shows indexed SourceDocument workbooks, a source document picker, sheets/ranges, detected source-region cards styled as red evidence boxes, bounded source range grids with row/column labels, warning/confidence metadata, local-only draft range previews, and source-region extract previews without creating ImportReviewSessions, persisted red boxes, SourceExtractProposals, ChartSpecs, or Manuscript blocks. Verification: targeted `npm test -- src/data/serverApi.test.js src/components/BackendScanPanel.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed with existing large Plotly and LF/CRLF warnings.

- Implemented Project Evidence Retrieval API v0. Added deterministic read-only `POST /api/projects/:projectId/search`, backed by compact project evidence search over project profile, file objects, source documents/regions, dataset commits/generic imports/fields/mappings, source extracts, observation series, analysis views, chart proposals/specs, and manuscripts without AI, embeddings, raw workbook payloads, or full source cell grids. Verification: `npm run codex:preflight`, targeted SaaS route tests, `npm --prefix backend test`, `npm test`, `npm run build`, and `git diff --check` passed with existing optional Postgres skip and warnings.

- Clarified future Agent retrieval/RAG/MCP architecture in active docs. Added read-only project search, evidence result shapes, structured-first retrieval, optional embedding use, MCP as a future adapter rather than source of truth, and MCP tool categories. Verification: `npm run codex:preflight` and `git diff --check`.

- Created a project-local Codex `ui-design` skill under `.codex/skills/ui-design` with LabRat workflow UI rules, Excel/source review guidance, workflow surface rules, chart/manuscript boundaries, and validation checklist. Verification: preflight and skill validator passed.
