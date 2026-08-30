# Reusable Chart Creation Plan

Status: active
Read when: implementing the chart-style and reusable-chart-template program.
Last reviewed: 2026-08-18

## Goal

Make repeated cross-experiment charts fast without weakening LabRat's reviewed
scientific-data and immutable ChartSpec boundaries.

```text
first chart
  -> describe, review, execute, accept
  -> optionally save an eligible setup as a named reusable template

later chart
  -> choose template, choose compatible experiments, preview, accept
```

Ordinary template reuse should make no provider call and generate no Python.
For moderate accepted Browser inputs, the product target is a validated preview
within 2-8 seconds after selection; this is a target, not a measured guarantee.

The detailed v1 semantics live in
`doc/contracts/reusable-chart-template-contract-v1.md`.

## Product Decisions

- Style, reusable scientific recipe, experiment selection, and immutable chart
  instance are separate concepts.
- The existing natural-language chart workflow authors new scientific intent.
- A reusable template is structured and versioned; it is not a stored prompt.
- The v1 fast path binds only accepted active Experiment Browser fields/series.
- Exact identity or a prior reviewed binding may auto-bind. Ambiguous meaning
  always returns to the user.
- Both paths produce the existing validated AnalysisResult and
  `origin: analysis_result` ChartSpec.
- Reference-chart style extraction is optional onboarding and follows template
  reuse infrastructure rather than blocking the core speed improvement.
- The complete feature stays on `codex/chart-creation`, per the user request,
  but each milestone remains one coherent review checkpoint.

## Milestone 1 — Contracts And Schemas

Status: complete on 2026-08-18

- Define ChartStyleProfile and immutable profile versions.
- Define ReusableChartTemplate and immutable template versions.
- Define strict reusable input slots and reviewed binding precedence.
- Define the bounded deterministic recipe language.
- Define multiple-experiment, missing-data, unit, alignment, palette, and
  responsive-geometry behavior.
- Define deterministic application lineage through existing analysis artifacts.
- Define planned API, persistence, permissions, errors, and audit rules.
- Define the implementation test matrix.
- Record the legacy manuscript `chartTemplates` naming boundary.

No routes, migrations, persistence, executor, or frontend behavior are added in
this milestone.

## Milestone 2 — Persistence And Read APIs

Status: complete on 2026-08-18

- Add Postgres migration and in-memory/PostgreSQL store parity for profile and
  template containers/versions.
- Add create/list/detail/version/archive APIs with project ownership,
  authorization, validation, optimistic versioning where applicable, and audit.
- Allow template creation only from one accepted ChartSpec and backend-derived
  eligible recipe candidate.
- Add bounded project-state summaries without duplicating full template
  payloads or Plotly arrays.
- Keep historical ChartSpecs and the legacy manuscript-local template shape
  unchanged.

Done when accepted immutable profile/template versions persist and reload with
identical hashes in memory and PostgreSQL, while unsupported source analyses
return an explicit eligibility error.

Implemented by migration 024, memory/PostgreSQL stores, project-scoped
lifecycle routes, bounded project-state summaries, deterministic validators,
accepted scalar-comparison eligibility derivation, authorization/audit, and
backend regressions. Template application/execution remains Milestone 3.

## Milestone 3 — Binding And Deterministic Executor

- Add slot-binding validation and append-only reviewed binding persistence.
- Add template application creation with idempotency and frozen snapshot heads.
- Create deterministic accepted PlanRevision plus queued AnalysisRun using
  `executionStrategy: chart_template_v1`.
- Implement the bounded recipe interpreter and exact source-lineage projection.
- Reuse existing Plotly result validation and AnalysisResult finalization.
- Recheck snapshot heads during execution and result publication.
- Prove no model provider or Python executor is invoked.

Done when one eligible template can produce validated awaiting-review results
for one, two, and three compatible experiments through the existing analysis
chain.

## Milestone 4 — Geometry And Multi-Experiment Rendering

- Implement selection-order color/marker/dash allocation.
- Implement overlay, grouped, stacked-component, and explicit facet policies.
- Implement preferred/minimum plot-area ratios, bounded margins, legend
  wrapping/fallbacks, long-label handling, and facet growth.
- Persist a bounded resolved-geometry summary with the immutable result/spec.
- Block unreadable output rather than silently changing comparison meaning.

Done when two/three/many-experiment fixtures preserve readable plot geometry,
shared-scale semantics, and deterministic style across reload and export.

## Milestone 5 — Fast Reuse Frontend

Status: complete on 2026-08-20

- Extend Chart Review to `Create chart | Use template | Approved charts`.
- Add template choice, experiment selection, slot compatibility, explicit
  binding, and data-coverage UI.
- Restore comparison selection as a dedicated chart picker rather than
  reintroducing the retired Browser row-checkbox tray unchanged.
- Extract/reuse the current ChartResultStage, trace selection, exclusions, and
  acceptance UI rather than duplicating them.
- Disable preview/accept for blockers; show missing values/categories and
  exclusions without rendering missing as zero.
- Keep existing ChartSpec publication and approved-chart management.

Done when a user can create a new ChartSpec with no prompt by selecting a
template and compatible experiments, and all missing-data consequences are
visible before acceptance.

Implemented through the three-tab Chart Review surface, reusable-template
contract loading, cursor-aware accepted-experiment selection, exact-field
coverage, structured blocker and explicit-binding review, deterministic
application handoff, no-Python execution, and the existing result review and
ChartSpec acceptance path. Approved-chart review now performs a read-only
backend eligibility preflight before enabling `Save as template`, so unsupported
lineage is explained before naming or writing a template.

Reliability follow-up completed on 2026-08-20: new natural-language chart
requests explicitly choose Experiment Browser or Workbook input mode. Browser
mode is the default and only template-compatible path; Workbook mode is an
advanced one-off path. The provider receives only the selected evidence
catalog, backend validation rejects mixed inputs, deterministic source typing
cannot be overwritten by model output, published snapshot cells expose their
actual stored type, and eligibility reports all blockers in one response.
Historical projects and ChartSpecs are not rewritten.

## Milestone 6 — Template Authoring From Approved Charts

Status: first save entry point implemented on 2026-08-18; contract inspection,
version management, archive UI, and style-only fallback remain.

- Add `Save as reusable template` after normal chart acceptance.
- Show the backend-derived input contract, recipe, comparison policy, and
  eligibility result.
- Let the user name, confirm, version, and archive reusable templates.
- Offer style-only saving when scientific recipe compilation is unsupported.
- Preserve normal chart acceptance even when optional template saving fails.

Implemented slice: the accepted-chart review keeps its created ribbon, exposes
inline template naming through `Save as template`, calls the backend-derived
creation API with the exact ChartSpec id, refreshes project summaries, and
surfaces eligibility/name conflicts without changing the accepted chart.

Done when an accepted eligible ChartSpec can author a reusable template without
browser-authored trusted scientific operations.

## Milestone 7 — Reference-Chart Style Onboarding

- Add optional reference image/PDF/SVG/PPTX attachment as a presentation asset.
- Extract a draft style profile with property-level confidence.
- Provide manual review for palette, typography, figure size, plot-area ratios,
  margins, axes, marks, and legend behavior.
- Require explicit acceptance; provider failure falls back to manual/default
  style and never blocks workbook onboarding.
- Prove reference assets never become SourceDocument scientific evidence.

Done when a user can approve a project style from a reference and later-created
templates pin its exact accepted version.

## Rollout And Compatibility

- Use additive schema and routes behind a project capability/feature flag until
  the fast path passes golden workflow QA.
- Do not migrate or rewrite existing ChartSpecs, AnalysisResults, Manuscripts,
  or accepted DataSnapshots.
- Do not reuse retired ChartProposalSet/SourceExtractProposal routes.
- Do not overload the legacy manuscript-local `chartTemplates` payload.
- Existing natural-language chart creation remains the fallback throughout.
- Each completed milestone updates active contracts, `doc/current-milestone.md`,
  and `doc/PROGRESS.md`, and passes verification proportional to its changes.

## Performance And Observability Targets

- Compatible ordinary application preview: 2-8 seconds target.
- No provider tokens/cost and no generated Python for `chart_template_v1`.
- Record template/style versions, application id, duration, validation outcome,
  experiment/trace/point counts, exclusions, and deterministic executor version.
- Never record full scientific arrays in logs or project summaries.
- Track p50/p95 preview duration, incompatibility/error codes, stale-head rate,
  and template-use success rate after implementation.

## Principal Risks

- Current opaque Browser column ids are reliable within preserved lineage but
  not universal semantic identities across unrelated publications.
- Existing approved Python analyses may not compile into the bounded recipe
  language; eligibility must fail explicitly rather than generalize by guess.
- Legend and label pressure can undermine the reference plot-area ratio unless
  geometry rules are bounded and testable.
- Fast comparison UX needs a new selection surface because the prior Browser
  row-checkbox comparison tray was intentionally removed.
- Style extraction from raster references is approximate and must remain draft.
