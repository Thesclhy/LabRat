# Decisions

Status: reference
Read when: checking durable architecture or product decisions.
Last reviewed: 2026-08-19

Durable decisions for LabRat architecture, product workflow, and Codex execution belong here. Keep entries newest first. Each entry should explain the decision, the context, the consequences, and any follow-up.

## 2026-08-19 — Primitive Stored Type Is Provider-Independent

- Decision: deterministic source evidence owns primitive Browser type, while
  AI providers may suggest scientific semantics but cannot override an
  evidenced numeric type through a model patch.
- Decision: numeric percentage fields distinguish `percent_points` from
  `fraction`; magnitude alone never chooses the scale.
- Decision: type or scale correction publishes a new immutable snapshot rather
  than rewriting accepted history.
- Reason: reusable template binding must behave identically across Anthropic,
  DeepSeek, and later providers, while retaining exact raw source evidence and
  explicit human review for ambiguous conversions.

## 2026-08-18 - Reusable Charts Extend The AnalysisResult Path

Status: Accepted

Decision:
LabRat keeps reviewed natural-language analysis as the authoring path for new
scientific intent and adds a deterministic reusable-template path for repeating
an approved comparison with compatible accepted experiments.

Style, reusable recipe, experiment selection, and immutable chart instance are
separate. A template is a structured immutable version, not a saved prompt.
Template reuse records ordinary analysis lineage with
`executionStrategy: chart_template_v1`, makes no provider call, generates no
Python, produces a normally validated AnalysisResult, and still requires
explicit ChartSpec acceptance.

Context:
The completed chart workflow is auditable but too slow and prompt-sensitive for
routine cross-experiment comparison. Replaying prompts or allowing fuzzy field
matching would improve speed at the cost of scientific reliability. Existing
opaque Browser column identities are reliable within preserved lineage but do
not prove semantic equivalence across unrelated publications.

Consequences:

- V1 fast reuse accepts active accepted Experiment Browser fields/series only.
- Exact stable identity or an unchanged prior reviewed binding may auto-bind;
  unique metadata candidates require first-use confirmation and ambiguity
  blocks.
- The bounded recipe language contains no arbitrary code or Plotly arrays.
- Missing values, units, X alignment, experiment cardinality, comparison mode,
  palette overflow, margins, plot-area minimums, and legend fallbacks are
  accepted template policy.
- Existing ChartSpecs remain `origin: analysis_result`; optional template
  lineage does not create a second chart origin.
- Reference-chart extraction creates a draft style only and is implemented
  after persistence, execution, geometry, fast reuse UI, and authoring.
- The legacy manuscript-local `chartTemplates` shape is not reused.
- The implementation source is
  `doc/plans/reusable-chart-creation-plan.md`; the contract is
  `doc/contracts/reusable-chart-template-contract-v1.md`.

## 2026-08-11 - AI Providers Use A Deployment-Selected In-Process Gateway

Status: Accepted

Decision:
LabRat keeps provider credentials and calls in the backend behind one
provider-neutral gateway. A deployment explicitly selects either Anthropic or
DeepSeek at process startup. There is no automatic failover, per-user provider
choice, arbitrary OpenAI-compatible endpoint, or external gateway service.

Context:
Anthropic connectivity is unreliable from the current mainland-China Docker
environment, while DeepSeek is reachable. DeepSeek's Anthropic compatibility
endpoint does not support the JSON Schema form used by LabRat, so changing only
the base URL would weaken the structured-output contract.

Consequences:

- DeepSeek uses its stable Chat Completions endpoint and V4 Pro model.
- Classification, explanation, read-only answers, and Experiment Browser plan
  drafting disable thinking. Chart planning and code generation enable high
  thinking and replay reasoning only transiently when a tool loop requires it.
- Output-limit truncation gets at most one concise same-provider non-thinking
  retry. Provider-reported usage remains visible even when both attempts fail.
- Backend JSON Schema validation and one bounded same-provider repair remain
  authoritative for both adapters.
- Every environment must explicitly select a supported provider. Development
  may expose it as unconfigured when its selected key is empty; production
  starts only with the corresponding key.
- Local Docker reads ignored `.env` settings; Lightsail reads
  `/etc/labrat/backend.env`; GitHub Actions never receives provider keys.
- The required GitHub Repository Variable `LABRAT_AI_PROVIDER` controls the
  next production deployment without triggering one by itself.
- Deployment atomically replaces only the provider line after verifying the
  server-side selected key. Startup or health failure restores the old
  environment file and old release before restarting the old backend.

## 2026-07-23 - Experiment Browser Writes Use Reviewed Record Patches

Status: Accepted

Decision:
New Experiment Browser data uses AnalysisThread
`outputTarget: experiment_browser`. Planning selects accepted workbook ranges
and/or active snapshot fields and stores only a user-readable plan. After plan
acceptance, Python receives the real materialized inputs and returns
source-backed field/series patches. The backend merges patches with complete
frozen active records; explicit result acceptance atomically publishes a new
DataSnapshot v3 and BrowserView.

Context:
Full-record replacement loses previously appended fields, while the former
deterministic DataPlan path was difficult to understand and could not support
iterative natural-language additions and replacements. Display-only column
changes should not create scientific revisions.

Consequences:

- Unmentioned fields and series are preserved; matching stable selectors are
  replaced with visible before/after changes.
- Same field key/unit with conflicting types is blocked; different units remain
  separate columns.
- Every new value cites accepted workbook cells or selected snapshot fields.
- Stale snapshot heads, forged sources, invalid values, and unresolved identity
  conflicts block publication.
- Hiding, showing, sorting, filtering, and reordering remain BrowserView-only.
- Python execution/output-contract errors receive one bounded automatic code
  repair inside the same run because users did not change the accepted
  scientific plan. A scientific change still requires a new PlanRevision.
- Published analysis views open directly but never replace the user's default
  BrowserView.
- Old DataPlan draft/publish write routes and UI are retired; historical
  accepted snapshots remain read-only.

## 2026-07-20 - Region-Level Workbook Understanding Replaces Aggregate Acceptance

Status: Accepted

Decision:
WorkbookReviewSession only groups review activity for one SourceDocument.
WorkbookReviewRegions own stable sheet/range identity and mutable disposition;
immutable RegionUnderstandingRevisions own AI/user-reviewed semantics. Users
revise, confirm, ignore, or logically delete each region independently. DataPlan
and evidence tools consume exact active accepted revision ids. There is no
workbook-wide confirmation, aggregate WorkbookUnderstanding, legacy migration,
or dual-write path.

Context:
A workbook may contain unrelated tables, notes, and multiple experiment areas.
One aggregate confirmation made partial progress ambiguous, coupled independent
corrections, and left Overview showing the workbook as unfinished after useful
regions were already accepted. Passing a complete workbook to the model also
weakened context bounds and auditability.

Consequences:

- Backend model input is one bounded selected range, limited neighbors, and a workbook manifest; the complete workbook is not model context.
- Region revisions preserve summaries, typed semantics, source refs, source/dependency hashes, provider metadata, confidence, warnings, and validation.
- Confirmation targets one exact revision; ignore/delete never cascade to revision history or existing downstream artifacts.
- Project state exposes `workbookReviewRegions` and accepted `regionUnderstandings`; aggregate routes and state fields remain retired with `404` behavior.
- Migration 013 adds region/revision persistence and migration 014 removes the aggregate table and embedded session columns.
- The written design is `doc/plans/workbook-region-understanding-redesign-design.md`.

## 2026-07-20 - Reviewed Backend Analysis And Placement-Local Chart Views

Status: Accepted

Decision:
Natural-language calculations and DataSnapshot-backed charts use a backend-owned, two-review workflow. The model drafts exact accepted-data selection, a human-readable processing explanation, and frozen Python; the frontend shows the source evidence as Excel red boxes beside the normal LabRat conversation; plan acceptance authorizes only LabRat-managed sandbox execution; backend validation precedes result review; and `Accept result and create chart` atomically accepts the immutable result and creates the ChartSpec. A ChartSpec retains every accepted available trace, while each Manuscript placement independently stores which traces are visible.

Context:
Selection-only chart intents cannot express normalization, fitting, statistics, or later analysis requests. Letting the model directly fill plotted arrays would weaken reproducibility and source lineage. Provider code execution would also make it harder to guarantee that the exact user-reviewed program ran. The existing Manuscript chart block and Inspector already provide a placement-local `chartView` foundation.

Consequences:

- Provider credentials and model calls move to the backend; ordinary read-only questions no longer default to Browser actions.
- LabRat needs AnalysisThread, immutable plan revisions/runs/results, a framework-independent tool registry, and a versioned isolated Python runtime.
- The model may draft code and calculation meaning, but only the exact accepted revision may execute.
- DataSnapshot-backed ChartSpecs introduce an `analysis_result` origin with immutable result data, trace catalog, source lineage, and default visible traces.
- Canvas visibility changes are visual-only, placement-local, undoable, persistable, and exportable; they never recompute data or mutate the ChartSpec.
- LangChain/LangGraph are not required initially. MCP remains an adapter over the same backend tools.
- The written design is `doc/plans/backend-conversational-analysis-chart-design.md`.

## 2026-07-16 - Retire The Aggregate Dataset Path

Status: Accepted

Decision:
The aggregate dataset commit, generic import/mapping/proposal collections, analysis views, observation-series registry, and their unscoped import/chart endpoints are removed rather than maintained as compatibility paths. Active chart creation remains source-backed until a separate accepted DataSnapshot chart milestone is implemented.

Context:
The accepted RegionUnderstandingRevision -> DataPlan -> DataSnapshot -> experiment snapshot head path passes a golden workbook workflow and powers Experiment Browser, saved views, comparison, and source provenance. Keeping the old dataset path would preserve competing sources of truth and misleading API/schema contracts.

Consequences:

- Migration 011 drops retired tables/foreign keys from development databases.
- Project state, stores, frontend helpers, chart validation, and manuscripts no longer carry retired aggregate ids.
- Retired routes return `404`; non-source ChartSpec creation returns `409 data_snapshot_chart_not_implemented`.
- New chart work must start from accepted DataSnapshots and explicit review rather than restore old adapters.

## 2026-07-16 - Accepted DataSnapshots Drive Experiment Browser

Status: Accepted

Decision:
The first complete workbook data path ends at Experiment Browser:

```text
SourceDocument
  -> accepted RegionUnderstandingRevisions
  -> reviewed DataPlan preview
  -> explicit publish
  -> accepted DataSnapshot
  -> Experiment Browser projection
```

One Browser row represents one stable experiment identity. Scalar accepted fields appear as columns; full series, warnings, and source refs appear in details. The retired aggregate dataset and generic collections require no compatibility migration.

Context:
The earlier red-box workflow lacked structured experiment layout, field roles, units, and included/skipped rows, while the Browser used a separate normalized-data path. Persisting that split would have preserved two competing sources of truth.

Consequences:

- Workbook review must capture structured interpretation before DataPlan publish.
- Publish re-reads source evidence, persists immutable DataPlan/DataSnapshot records, and advances experiment-specific snapshot heads atomically.
- Experiment Browser becomes a read model over accepted snapshots and supports recommended columns, detail provenance, personal saved views, and a comparison tray.
- Browser publication creates no chart proposals, ChartSpecs, FigurePackages, or manuscript placements.
- The obsolete path is removed; a later DataSnapshot-to-chart milestone must define a new reviewed contract.
- The executable sequence is `doc/plans/workbook-review-to-experiment-browser-plan.md`.

## 2026-06-18 - `doc/plan.md` Is The Active Agent-First Execution Source

Status: Accepted

Decision:
`doc/plan.md` is the source of truth for the current Agent-first evidence workflow implementation. `doc/plans/source-understanding-long-term-plan.md` remains a reference architecture for Source Workspace details, not a competing milestone plan.

Context:
The Source Workspace plan explains why workbook/range evidence is needed, while the current product direction also includes accepted snapshots, Experiment Browser, controlled AgentRuns, source-backed proposal review, and manuscript output. Keeping both documents is useful, but only one should drive sequencing.

Consequences:

- New implementation milestones should follow `doc/plan.md`.
- If a detailed source-workspace idea from `doc/plans/source-understanding-long-term-plan.md` becomes active, first incorporate it into `doc/plan.md`.
- Roadmap, API, schema, data dictionary, and AI boundary docs should use `doc/plan.md` terminology for current work.

## 2026-06-18 - Codex Long-Task Loop Is Mandatory

Status: Accepted

Decision:
Codex work in this repository must follow a repeated execution loop:

```text
read docs -> create checklist -> implement one milestone -> run tests -> update progress -> re-read docs -> continue
```

Context:
The active roadmap is too large for a single pass. `doc/plan.md` is the current execution source of truth, while API contracts, data dictionary, architecture, and AI-boundary docs define the safety rails for backend, frontend, data, and AI changes.

Consequences:

- Non-trivial implementation starts by reading `doc/plan.md`.
- Routes, schemas, persistence, migrations, and frontend API usage require reading API/data-model docs first.
- Long tasks need an explicit checklist in `doc/task-checklist.md`.
- Every completed milestone updates `doc/PROGRESS.md`.
- Agents must stop and report code/doc conflicts instead of guessing.

## 2026-06-18 - `doc/PROGRESS.md` Remains The Canonical Progress Log

Status: Accepted

Decision:
Use the existing uppercase `doc/PROGRESS.md` as the canonical progress file. Do not create a parallel lowercase `doc/progress.md`.

Context:
The repository already uses `doc/PROGRESS.md`, and this workspace runs on Windows where case-only duplicate paths are unreliable.

Consequences:

- Scripts and AGENTS instructions refer to `doc/PROGRESS.md`.
- User requests that mention `doc/progress.md` should be interpreted as the existing progress log unless the repository moves to a case-sensitive filesystem and explicitly renames the file.
