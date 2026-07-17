# LabRat Docs Start Here

Status: active
Read when: starting any non-trivial LabRat coding or documentation task.
Last reviewed: 2026-06-30

This file is the routing guide for AI agents. It tells you which docs are current source of truth, which docs are long-term plans, and which docs are historical reports.

## Current Direction

LabRat is a server-first, multi-lab research workflow app for messy workbook ingestion, source-backed evidence review, chart specs, manuscript figures, and controlled conversational agent actions.

The current product direction is the Workbook Understanding First workflow:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> LLM-drafted + backend-validated WorkbookUnderstanding
  -> user confirms/corrects through chat + red boxes
  -> accepted WorkbookUnderstanding
  -> later DataPlan / DataSnapshot
  -> reviewed ChartSpec
  -> manuscript figure placement
```

Uploading a workbook does not automatically normalize data, create a DatasetCommit, create a SourceExtractProposal, create a ChartSpec, or insert Manuscript content. Those are later review boundaries built on top of accepted understanding and source refs.

The current engineering mainline is the Tool-Governed DataPlan Agent: accepted WorkbookUnderstanding evidence is retrieved through backend-owned tools, compiled into reviewable DataPlans, and executed into deterministic DataSnapshot previews before any chart proposal or ChartSpec is created. See `doc/current-milestone.md` for the active slice.

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

For frontend workflow or review UX, also read:

- `doc/qa/manual-qa-agent-first-workflow.md`
- `doc/qa/code-review.md`
- `doc/plans/mui-ui-migration-plan.md` when planning or implementing Material UI migration work.
- `.codex/skills/ui-design/SKILL.md` when UI design or UI verification is involved.

## Doc Status Rules

- `active`: short docs that guide the next task.
- `contract`: current or planned API/schema/data-shape source of truth.
- `reference`: architecture, roadmap, QA, or long-form design background.
- `archive`: historical notes. Read only when you need old context.

If implementation reality disagrees with a contract or active plan, stop and update the docs in the same milestone or ask which source should win.
