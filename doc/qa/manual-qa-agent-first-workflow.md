# Manual QA: Workbook Evidence To Browser And Output

Status: active
Last reviewed: 2026-07-16

Use a development account with editor access and a workbook containing at least two experiments plus one chartable source range.

## Project And Upload

- [ ] Login and open/create a project.
- [ ] Project Overview shows no fabricated sample experiments.
- [ ] Attach and send one workbook through Ask LabRat.
- [ ] Upload creates one file/import run and opens Workbook Review.
- [ ] No accepted experiment rows or ChartSpecs appear merely from upload.

## Conversational Red-Box Review

- [ ] Workbook grid stays mounted while the right review dock is used.
- [ ] Detected regions appear as red boxes and in the region list.
- [ ] Selecting a box focuses the matching sheet/range.
- [ ] A natural-language correction updates only the active box.
- [ ] Replacing a range does not delete unrelated boxes.
- [ ] Structured interpretation exposes experiment axis, identity, fields, units, inclusion/skips, series, warnings, and confidence.
- [ ] Ambiguous identity/unit state blocks confirmation with a clear message.
- [ ] Low-confidence semantics require explicit acknowledgement.
- [ ] Confirmation locks the accepted understanding and exposes DataPlan review.

## DataPlan Review And Publish

- [ ] Draft preview contains deterministic experiment records with scalar/series values and exact source refs.
- [ ] Identity aliases require explicit create/reuse decisions.
- [ ] Skipped rows and parse warnings are visible.
- [ ] Source navigation returns to the correct workbook range.
- [ ] Publish is disabled while blockers/local unreviewed changes exist.
- [ ] One publish creates accepted DataPlan/DataSnapshot records and active experiment heads.
- [ ] Double-submit/retry returns the same idempotent result.
- [ ] Changing evidence produces a stale-preview response before writes.

## Experiment Browser

- [ ] Browser shows one row per active accepted experiment identity.
- [ ] Recommended columns include high-coverage condition/outcome fields with units.
- [ ] Search, typed filters, sort, pagination, and virtualized rendering work.
- [ ] Detail opens lazily and shows scalars, series, warnings, snapshot refs, and source evidence.
- [ ] Source evidence reopens the accepted workbook context without creating a new red box.
- [ ] Column visibility/order/width changes are stable.
- [ ] Saved views are personal, can be defaulted/renamed/deleted, and restore valid state.
- [ ] Selection survives filter/search changes.
- [ ] Compare tray shows selected experiments and keeps incompatible units in separate rows.

## Source-Backed Chart Review

- [ ] A prompt naming an explicit workbook/sheet/range creates a reviewable source extract/chart proposal.
- [ ] Proposal preview uses immutable source rows/series and exact source refs.
- [ ] Cross-experiment source comparison exposes selectable experiment series.
- [ ] Accepting a proposal then creating a ChartSpec succeeds.
- [ ] A chart request without source evidence returns an explicit unsupported DataSnapshot-chart message, not a fabricated chart.

## Manuscript

- [ ] Approved source-backed ChartSpecs appear in the insert dialog.
- [ ] Experiment selection gates preview/insertion for series-backed charts.
- [ ] Inserted blocks retain ChartSpec snapshot, selected view, and editable layout.
- [ ] Whole-chart selection, nested title/plot selection, drag, resize, keyboard movement, undo/redo, save/reload, and PPTX export work.

## Agent Behavior

- [ ] Upload planning offers one workbook-review action.
- [ ] Browser compare/search prompts route to Experiment Browser rather than creating hidden data artifacts.
- [ ] Source chart actions remain confirmation gated.
- [ ] Visible steps are concise workflow summaries and contain no hidden reasoning.

## Retirement Checks

- [ ] No UI exposes master/supplement, normalize, semantic mapping, dataset commit, analysis view, or observation-series workflows.
- [ ] Retired API paths return `404`.
- [ ] Project state has no retired aggregate dataset/mapping fields.

## Responsive And Console

- [ ] Desktop and narrow layouts have no incoherent overlap or page-level horizontal overflow.
- [ ] Review dock, Browser drawers/tray, chart modal, and Manuscript inspector remain reachable.
- [ ] Browser console has no uncaught errors during the complete flow.
