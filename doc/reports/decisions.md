# Decisions

Status: reference
Read when: checking durable architecture or product decisions.
Last reviewed: 2026-07-20

Durable decisions for LabRat architecture, product workflow, and Codex execution belong here. Keep entries newest first. Each entry should explain the decision, the context, the consequences, and any follow-up.

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
The accepted WorkbookUnderstanding -> DataPlan -> DataSnapshot -> experiment snapshot head path now passes a golden workbook workflow and powers Experiment Browser, saved views, comparison, and source provenance. Keeping the old path would preserve competing sources of truth and misleading API/schema contracts.

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
  -> accepted WorkbookUnderstanding
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
