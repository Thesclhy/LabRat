# Reusable Chart Template Test Matrix

Status: active QA plan
Read when: implementing or reviewing reusable chart creation milestones.
Last reviewed: 2026-08-18

## Contract And Persistence

- [ ] Invalid schema versions, ratios, margins, cardinality, colors, and recipe
      operations are rejected with stable codes.
- [ ] Profile/template versions are immutable and content-hashed.
- [ ] Editing creates a later version; historical ChartSpecs remain unchanged.
- [ ] Archive is logical and does not break historical lineage.
- [ ] Memory and PostgreSQL stores return equivalent bounded summaries/details.
- [ ] Cross-project ids return not found; viewer writes return forbidden.
- [ ] Same-key/same-request application replay is idempotent; conflicting reuse
      returns `409`.
- [ ] Legacy manuscript `chartTemplates` state is neither read nor overwritten.

## Input Binding

- [ ] Exact stable column/series identity binds deterministically.
- [ ] A reviewed binding reuses only while its type/unit/source signature match.
- [ ] One metadata candidate requires first-use confirmation.
- [ ] Duplicate readable names remain ambiguous and require explicit selection.
- [ ] Missing required slots block preview.
- [ ] Missing optional slots follow only their accepted policy.
- [ ] Raw workbook ranges do not enter the v1 reusable fast path.
- [ ] A changed active snapshot head invalidates stale preview/binding state.

## Experiment Count And Encoding

- [ ] One, two, three, recommended-maximum, and hard-maximum experiment cases.
- [ ] Overlay adds one trace per experiment without changing axis semantics.
- [ ] Grouped bars narrow within stable category bands.
- [ ] Stacking follows declared components and never silently stacks experiments.
- [ ] Facets follow the declared grid and panel-size policy.
- [ ] The renderer never silently changes comparison mode.
- [ ] Shared axes remain shared unless independent facets are explicit.

## Missing Data, Units, And Alignment

- [ ] Missing required input displays a blocker and no partial silent chart.
- [ ] Missing scalar never renders as zero.
- [ ] Missing points preserve gaps, omit, exclude, or block exactly as declared.
- [ ] Missing categories cover union, intersection, and strict behavior.
- [ ] A policy that removes every trace/category blocks result creation.
- [ ] Interpolation/imputation is unavailable in v1.
- [ ] Exact units pass; incompatible units block shared-axis comparison.
- [ ] Reviewed conversion preserves original/converted value, unit, method, and
      source refs.
- [ ] Different X grids follow exact/union/intersection and never align by array
      position alone.

## Style And Geometry

- [ ] Two and three traces preserve preferred plot geometry when legend fits.
- [ ] Long names trigger wrapping/fallback before plot-area shrinkage.
- [ ] Preferred margins never exceed maximums.
- [ ] Minimum plot-area ratios and minimum type size cannot be crossed.
- [ ] Palette overflow uses the declared marker/dash policy or blocks.
- [ ] Facet growth is bounded and preserves minimum panel size.
- [ ] Resolved Plotly layout and geometry summary reload identically.
- [ ] Reference extraction remains draft and reports uncertain properties.

## Analysis, Publication, And Existing Workflows

- [ ] `chart_template_v1` creates normal accepted-plan/run/result lineage.
- [ ] No provider call, Python generation, or Python execution occurs.
- [ ] Existing Plotly safety/shape/trace/point/payload validation is reused.
- [ ] Preview creates no ChartSpec.
- [ ] Exact result acceptance creates one `origin: analysis_result` ChartSpec.
- [ ] Empty/unknown visible trace selections create no writes.
- [ ] Changed snapshot heads block execution/publication and require regeneration.
- [ ] Existing natural-language chart workflow remains unchanged.
- [ ] Existing ChartSpecs without template lineage remain readable.
- [ ] Approved chart listing/detail, Manuscript insertion, independent placement
      trace views, save/reload, and PPTX export work for both origins of the
      analysis execution strategy.

## Frontend Review

- [ ] Template selection clearly states experiment limits and required inputs.
- [ ] Compatible, warning, blocked, and excluded states use text/icons, not
      color alone.
- [ ] Coverage details identify affected experiments, slots, points, categories,
      units, and exclusions.
- [ ] Preview is disabled for blockers and acceptance is disabled for stale or
      zero-trace results.
- [ ] Changing a scientific handling policy creates/requires a reviewed template
      version rather than silently mutating one application.
- [ ] Desktop and narrow layouts keep template selection, coverage, preview, and
      action controls reachable without page-level horizontal overflow.
