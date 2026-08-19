# LabRat Docs Start Here

Status: active
Read when: starting any non-trivial LabRat coding or documentation task.
Last reviewed: 2026-08-18

This file is the routing guide for AI agents. It tells you which docs are current source of truth, which docs are long-term plans, and which docs are historical reports.

## Current Direction

LabRat is a server-first, multi-lab research workflow app for messy workbook ingestion, source-backed evidence review, chart specs, manuscript figures, and controlled conversational agent actions.

The current product direction is the Workbook Understanding First workflow:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> backend-LLM-drafted + backend-validated region revisions
  -> user independently confirms/corrects/ignores/deletes each region
  -> accepted RegionUnderstandingRevisions
  -> later DataPlan / DataSnapshot
  -> reviewed ChartSpec
  -> manuscript figure placement
```

Uploading a workbook does not automatically publish a DataSnapshot, create a ChartSpec, or insert Manuscript content. The retired SourceExtractProposal/ChartProposalSet path is not a supported product flow.

LabRat chat has three supported dispositions: workbook upload and region review, read-only project question answering, and reviewed analysis/chart planning. Chart requests select confirmed regions and/or accepted active DataSnapshot records, then pass through plan review, accepted Python execution, result review, and analysis-result ChartSpec publication.

The chart-creation program now includes persisted, versioned chart styles and
scientific templates. New chart meaning still uses the reviewed analysis path;
the next milestone makes repetition with compatible accepted Browser
experiments use a deterministic `chart_template_v1` run and the same
AnalysisResult and ChartSpec publication boundary. Read
`doc/plans/reusable-chart-creation-plan.md` and
`doc/contracts/reusable-chart-template-contract-v1.md` for this work.

## Minimal Reading Path

Always read:

- `README.md`
- `AGENTS.md`
- `doc/START_HERE.md`
- `doc/plan.md`
- `doc/current-milestone.md`
- `doc/PROGRESS.md`
- `doc/task-checklist.md`

For backend routes, auth, persistence, project state, migrations, or frontend API helpers, also read:

- `doc/contracts/saas-api-contract-v0.md`
- `doc/contracts/saas-database-schema-v0.md`
- `doc/contracts/server-project-state-plan.md`
- `doc/contracts/backend-api-contract.md`

For scientific data shape, imports, evidence, ChartSpecs, manuscript semantics, or AI boundaries, also read:

- `doc/contracts/canonical-data-dictionary.md`
- `doc/arch/architecture.md`
- `doc/arch/ai-boundaries.md`
- `doc/contracts/reusable-chart-template-contract-v1.md` for reusable chart
  style/template, input-slot, deterministic-recipe, and geometry work.

For frontend workflow or review UX, also read:

- `doc/qa/manual-qa-agent-first-workflow.md`
- `doc/qa/code-review.md`
- `doc/qa/reusable-chart-template-test-matrix.md` for reusable chart work.
- `doc/plans/mui-ui-migration-plan.md` when planning or implementing Material UI migration work.
- `.codex/skills/ui-design/SKILL.md` when UI design or UI verification is involved.

## Doc Status Rules

- `active`: short docs that guide the next task.
- `contract`: current or planned API/schema/data-shape source of truth.
- `reference`: architecture, roadmap, QA, or long-form design background.
- `archive`: historical notes. Read only when you need old context.

If implementation reality disagrees with a contract or active plan, stop and update the docs in the same milestone or ask which source should win.
