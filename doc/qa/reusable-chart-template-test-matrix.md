# Reusable Chart Template Test Matrix

Status: active QA plan
Read when: implementing or reviewing reusable chart creation milestones.
Last reviewed: 2026-08-20

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
- [x] A reviewed binding reuses only while its type/unit/source signature match.
- [x] One metadata candidate requires first-use confirmation.
- [x] Duplicate readable names remain ambiguous and require explicit selection.
- [x] Missing required slots block preview.
- [ ] Missing optional slots follow only their accepted policy.
- [x] Raw workbook ranges do not enter the v1 reusable fast path.
- [x] Browser and Workbook chart modes are explicit and mixed-source plans fail closed.
- [x] Provider full-field output cannot downgrade deterministic numeric typing.
- [x] Published detail shows the accepted snapshot's actual stored type and source.
- [x] Eligibility returns all independently actionable blockers in one response.
- [x] An inert `includeSeries` flag with no materialized series does not block
      an otherwise scalar template; actual series still fail closed.
- [x] Stacked/grouped bar aliases compile to `bar` while preserving comparison mode.
- [x] A changed active snapshot head invalidates stale preview/binding state.

## Experiment Count And Encoding

- [x] One, two, three, recommended-maximum, and hard-maximum experiment cases.
- [x] Overlay adds one trace per experiment without changing axis semantics.
- [x] Grouped bars retain grouped mode within stable category bands.
- [x] Stacking follows declared components and never silently stacks experiments.
- [x] Facets follow the declared grid and panel-size policy.
- [x] The renderer never silently changes comparison mode.
- [x] Shared axes remain shared unless independent facets are explicit.

## Missing Data, Units, And Alignment

- [x] Missing required input displays a blocker and no partial silent chart.
- [x] Missing scalar never renders as zero.
- [ ] Missing points preserve gaps, omit, exclude, or block exactly as declared.
- [ ] Missing categories cover union, intersection, and strict behavior.
- [ ] A policy that removes every trace/category blocks result creation.
- [ ] Interpolation/imputation is unavailable in v1.
- [x] Exact units pass; incompatible units block shared-axis comparison.
- [ ] Reviewed conversion preserves original/converted value, unit, method, and
      source refs.
- [ ] Different X grids follow exact/union/intersection and never align by array
      position alone.

## Style And Geometry

- [x] Two and three traces preserve preferred plot geometry when legend fits.
- [x] Long names trigger wrapping/fallback before plot-area shrinkage.
- [x] Preferred margins never exceed maximums.
- [x] Minimum plot-area ratios and minimum type size cannot be crossed.
- [x] Palette overflow uses the declared marker/dash policy or blocks.
- [x] Facet growth is bounded and preserves minimum panel size.
- [x] Resolved Plotly layout and geometry summary reload identically.
- [ ] Reference extraction remains draft and reports uncertain properties.

## Analysis, Publication, And Existing Workflows

- [x] `chart_template_v1` creates normal accepted-plan/run/result lineage.
- [x] No provider call, Python generation, or Python execution occurs.
- [x] Existing Plotly safety/shape/trace/point/payload validation is reused.
- [x] Preview creates no ChartSpec.
- [x] Exact result acceptance creates one `origin: analysis_result` ChartSpec.
- [ ] Empty/unknown visible trace selections create no writes.
- [x] Changed snapshot heads block execution/publication and require regeneration.
- [x] Existing natural-language chart workflow remains unchanged.
- [x] Existing ChartSpecs without template lineage remain readable.
- [ ] Approved chart listing/detail, Manuscript insertion, independent placement
      trace views, save/reload, and PPTX export work for both origins of the
      analysis execution strategy.

## Frontend Review

- [x] Template selection clearly states experiment limits and required inputs.
- [x] Compatible, warning, blocked, and excluded states use text/icons, not
      color alone.
- [ ] Coverage details identify affected experiments, slots, points, categories,
      units, and exclusions.
- [x] Preview is disabled for blockers and acceptance is disabled for stale or
      zero-trace results.
- [ ] Changing a scientific handling policy creates/requires a reviewed template
      version rather than silently mutating one application.
- [ ] Desktop and narrow layouts keep template selection, coverage, preview, and
      action controls reachable without page-level horizontal overflow.
