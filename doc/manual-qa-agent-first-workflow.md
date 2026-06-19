# Manual QA: Agent-First Evidence Workflow

Use this checklist to manually review the `feature/agent-first-evidence-workflow` branch after automated verification passes. The goal is to confirm the implemented Phase 1-8 slices are reviewable, source-backed, and do not bypass human review.

## Setup

```bash
npm install
npm run codex:preflight
npm run codex:verify
docker compose config
npm run dev:docker
```

Open the frontend printed by Docker/Vite, usually:

```text
http://127.0.0.1:5173/LabRat/
```

Login:

```text
labuser / LabRatLab123!
```

Stop the stack after QA:

```bash
npm run dev:docker:down
```

## Required Test Data

Prepare or generate these files before manual QA:

- Master table with `Exp1`, `Exp2`, and `Exp3`.
- Reaction-rate supplemental workbook for each of `Exp1`, `Exp2`, and `Exp3`.
  - Each workbook should contain reaction time and reaction rate columns.
  - Expected normalized supplement kind: `reaction_rate_time_series`.
- Source/calculation workbook for `Exp30` containing a C-number/component distribution range.
  - Include a header row with labels like `C1`, `C2`, `C3`, `C4`.
  - Include `Overall tots` at row 69 for the source extract prompt.

## Baseline Project Setup

- [ ] Create a new project.
- [ ] Fill at least a minimal project profile.
- [ ] Import the master table.
- [ ] Review scan blocks and normalize preview.
- [ ] Apply the master import.
- [ ] Add supplemental reaction-rate workbooks for `Exp1`, `Exp2`, and `Exp3`.
- [ ] Review relationship previews.
- [ ] Apply each supplement.
- [ ] Confirm Browser does not show supplemental time points as pseudo experiments.
- [ ] Confirm project state reload does not erase unsaved manuscript content unexpectedly.

## Cross Compare Workflow QA

Prompt in the Lab Rat chat:

```text
compare reaction rate for Exp1, Exp2, Exp3
```

Expected AgentRun behavior:

- [ ] Chat creates a durable AgentRun instead of only a stateless plan.
- [ ] The assistant message shows visible trace steps.
- [ ] Trace mentions compatible observation series or comparable reaction-rate evidence.
- [ ] No hidden reasoning or chain-of-thought text appears.
- [ ] The action card clearly requires confirmation before creating artifacts.
- [ ] Before confirmation, no new chart proposal is usable in Chart Review.

Confirm action:

- [ ] Click `Confirm agent action`.
- [ ] A `series_compare` AnalysisView is created.
- [ ] A chart proposal set is queued.
- [ ] The action card shows the queued chart proposal.
- [ ] Project state reloads without replacing current manuscript blocks.

Chart Review and Manuscript:

- [ ] Open Chart proposals / Chart Review.
- [ ] Confirm proposal origin or text indicates it came from AgentRun or AnalysisView.
- [ ] Preview renders one trace per selected experiment.
- [ ] Accept the proposal.
- [ ] Create a ChartSpec.
- [ ] Insert the ChartSpec into Manuscript Approved Charts.
- [ ] Confirm Manuscript chart renders.
- [ ] Use included-experiment controls to show/hide experiments where available.
- [ ] Save manuscript.
- [ ] Reload project.
- [ ] Confirm the chart and selected experiment ids persist.

## Source Extract Workflow QA

Upload or scan the `Exp30` calculation/source workbook so it appears in source document APIs.

Prompt in the Lab Rat chat:

```text
use Overall tots row 69 to plot Exp30 carbon number distribution
```

Expected AgentRun behavior:

- [ ] Chat creates a durable AgentRun.
- [ ] Visible trace shows source document search, bounded range read, and extract validation.
- [ ] The action card requires confirmation.
- [ ] The action card references a bounded source range, not a whole workbook.
- [ ] No full cell grid is shown in chat.

Confirm action:

- [ ] Click `Confirm agent action`.
- [ ] A `sourceExtractProposal` is created.
- [ ] No dataset commit is created by this confirmation.
- [ ] No ChartSpec is created directly.
- [ ] No Manuscript block is inserted directly.

Review path:

- [ ] Open the source extract proposal through available backend/API/debug surface.
- [ ] Confirm extracted rows include C-number values and percentages.
- [ ] Confirm values have exact source cell refs.
- [ ] Accept the source extract proposal.
- [ ] Draft a chart proposal from the accepted source extract.
- [ ] Accept/reject through Chart Review.
- [ ] Create ChartSpec only after accepting the chart proposal.
- [ ] Insert into Manuscript only from the ChartSpec path.

## Negative Cases

Missing experiments:

```text
compare reaction rate for Exp1, Exp999
```

- [ ] Assistant asks for clarification or reports the missing experiment.
- [ ] No AnalysisView is created.
- [ ] No chart proposal is queued.

Incompatible series:

- [ ] Try comparing experiments that do not all have compatible reaction-rate observation series.
- [ ] Assistant reports incompatible or missing series.
- [ ] No invalid compare proposal is created.

Oversized source range:

- [ ] Call the source range API with a range larger than the configured cap.
- [ ] API returns a clear validation error.
- [ ] Response does not include the requested oversized grid.

Missing source document:

```text
use Overall tots row 69 to plot Exp999 carbon number distribution
```

- [ ] Assistant reports missing source evidence or asks for clarification.
- [ ] No source extract proposal is created.

## Guardrail Checklist

- [ ] `GET /api/projects/:projectId/state` does not include full raw workbook payloads.
- [ ] Project state does not include full source cell grids.
- [ ] Source document list and region list return summaries, not full workbook data.
- [ ] Source range reads are bounded and capped.
- [ ] Anthropic/model calls are not made unless explicitly configured and bounded.
- [ ] No hidden chain-of-thought is visible in chat, traces, API responses, or logs.
- [ ] AgentRun planning does not create AnalysisViews, chart proposals, source extract proposals, dataset commits, ChartSpecs, or Manuscript blocks before confirmation.
- [ ] Chart proposals still require Accept/Reject review.
- [ ] ChartSpecs are created only from accepted proposals.
- [ ] Manuscript insertion uses ChartSpecs, not raw proposals.
- [ ] AI or agent paths do not return direct Plotly JSON.
- [ ] No arbitrary code execution is exposed.

## Pass/Fail Summary

- [ ] Cross compare AgentRun flow passed.
- [ ] Source extract AgentRun flow passed.
- [ ] Chart Review / Accept / Create ChartSpec / Manuscript insertion passed.
- [ ] Save/reload persistence passed.
- [ ] Negative cases passed.
- [ ] Guardrails passed.
- [ ] Any failures are recorded in `doc/PROGRESS.md` or a review issue before merge.
