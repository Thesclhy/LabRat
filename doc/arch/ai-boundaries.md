# AI Boundaries

Status: active
Last reviewed: 2026-08-18

LabRat uses AI as a proposal and workflow layer. Authorization, bounded evidence reads, schema validation, deterministic execution, hashing, and persistence remain backend responsibilities.

## AI May

- classify workbook regions and explain confidence/warnings
- draft one structured RegionUnderstandingRevision from bounded selected source cells
- interpret a user's correction for the active red box
- rank accepted evidence for a stated task
- draft Experiment Browser source selections and natural-language data-change plans
- select exact ranges inside active confirmed workbook regions for a reviewable analysis/chart plan
- explain Experiment Browser fields, comparison choices, source refs, and stale-review errors
- draft captions or manuscript text from user-approved evidence
- classify bounded project messages into the supported intent/disposition schema
- propose a draft ChartStyleProfile from a user-provided presentation reference
  with explicit property-level uncertainty
- rank candidate fields for an ambiguous reusable input slot, while leaving the
  binding decision to deterministic rules or the user

## AI Must Not

- invent scientific values, units, experiment identities, formulas, or conversions
- read another project/lab's records
- treat unconfirmed SourceRegions as accepted DataPlan evidence
- directly publish DataSnapshots or advance experiment heads
- silently merge experiment aliases
- rewrite raw files, source indexes, accepted understandings, or historical snapshots
- create a ChartSpec without immutable validated source/data evidence
- insert manuscript content without the normal reviewed action boundary
- expose or persist hidden chain-of-thought
- accept a chart style, reusable template, slot binding, template application,
  AnalysisResult, or ChartSpec on the user's behalf
- turn fuzzy label similarity into an accepted scientific input binding
- replay a saved prompt or generate new Python during `chart_template_v1`

## Context Rules

Send compact project-owned context only:

- project profile and user request
- bounded source-document metadata/ranges
- active red-box interpretation and validation blockers
- accepted RegionUnderstandingRevision summaries/source refs
- active experiment field catalogs, bounded selected values, and readable identity candidates
- confirmed-region summaries and bounded source-range pages
- approved analysis-result chart/manuscript summaries, including bounded trace metadata and current visible trace ids without full x/y arrays

Do not send full workbooks, entire DataSnapshot point collections, unrelated project history, credentials, or private session data.

## Review Boundaries

```text
AI draft
  -> deterministic schema/ownership/evidence validation
  -> visible user review
  -> explicit confirmation
  -> backend transaction
  -> audit event
```

RegionUnderstandingRevision confirmation, analysis-plan acceptance,
AnalysisResult acceptance into ChartSpec or DataSnapshot, and Manuscript save
are separate boundaries. Confirmation at one stage does not authorize later
stages.

Template creation, ambiguous-slot binding, template application Preview, and
AnalysisResult acceptance are distinct actions. Preview authorizes execution
of the already accepted deterministic template against the displayed frozen
inputs; it does not authorize ChartSpec publication.

## Reusable Chart Rules

- Reference-chart extraction creates a draft style only and receives no
  scientific workbook/DataSnapshot values.
- An accepted template pins a bounded deterministic recipe, not a prompt or
  executable program.
- Template reuse uses accepted active Experiment Browser fields/series only in
  v1 and makes no provider call.
- AI may rank visible binding candidates but cannot resolve ambiguity or invent
  a missing measurement, unit, conversion, category, or point.
- Missing remains missing; zero, interpolation, imputation, conversion, and
  exclusion require explicit accepted policy.
- Deterministic execution remains untrusted until normal Plotly validation.
- Only explicit acceptance of the exact AnalysisResult creates the ChartSpec.

## Evidence Rules

- Usable DataPlan evidence must come from exact active accepted RegionUnderstandingRevisions and backend-owned SourceDocument reads.
- Unconfirmed candidates are suggestions with `canUseForDataPlan: false`.
- Accepted values cite exact source cells/ranges and accepted snapshot records.
- If the requested experiment, range, field, or unit cannot be resolved, return clarification rather than substitute another candidate.

## Experiment Browser Publication Rules

- Primitive stored type is evidence-derived and provider-independent. The
  deterministic workbook interpretation owns number/string/date/boolean
  classification; a backend model may suggest scientific names, roles, and
  units but cannot downgrade a deterministic numeric field through a model
  patch. User-reviewed corrections remain a separate explicit boundary.
- Numeric-looking text and accepted placeholders are handled by bounded source
  rules. Percentage scale is explicit (`percent_points` or `fraction`) and is
  never inferred only from a value being between zero and one.

- Planning may select exact accepted workbook ranges, active snapshot fields,
  or both; it never embeds final values or Python.
- Pristine-project onboarding may request `direct_source_mapping` after plan
  acceptance. It reuses the accepted RegionUnderstandingRevision mapping and
  makes no code-generation provider call. The fixed mapper may copy/parse only
  accepted source columns, retains exact source pointers and missing-value
  evidence, and remains subject to the normal result review and publication
  boundaries. General Browser work continues through reviewed generated Python.
- Existing `experimentSelections` are calculation inputs only. Requests for a
  new workbook column use `sourceSelections`. Existing fields are selected only
  by zero-based position in the ordered model-facing field list; internal
  Browser column ids are never exposed to a model.
- After plan acceptance, code generation sees only materialized ordered
  `inputs.tables` and `inputs.experiments` lists.
- Python returns top-level readable scalar `columns`, per-record values by
  output `columnIndex`, optional series patches, and exclusions rather than
  complete replacement records.
- Generated code cannot define semantic keys, roles, target ids, internal
  column ids, or Browser view state. The backend assigns one random internal
  id per validated output column and persists it with the AnalysisResult.
- Duplicate readable output columns remain independent. Source summaries
  disambiguate them for later Browser and chart-model selection.
- Every output value must cite selected workbook cells or snapshot fields.
- Missing scalar output must remain `null` with an allowed `missingReason` and
  the exact missing source pointer. Models must not convert missing values to
  zero, placeholder strings, exclusions, interpolation, or imputation unless a
  reviewed plan explicitly authorizes the latter operation.
- The backend preserves unmentioned data and validates indexes, value types,
  source pointers, identity decisions, and stale heads before writes.
- Only explicit result acceptance can atomically publish DataSnapshot v4 and a
  BrowserView.

## Analysis Planning Rules

- Analysis evidence comes only from active accepted
  RegionUnderstandingRevisions and explicitly selected fields from active
  accepted DataSnapshots. Chart and Experiment Browser plans may both use
  ordered snapshot fields.
- Planning receives a bounded confirmed-region catalog and may use
  `inspect_source_range` to page through exact cells. It selects one or more
  rectangular `sourceSelections`; each must stay inside its accepted region.
- Multiple files, worksheets, and non-contiguous ranges remain separate
  selections and separate red review rectangles. Analysis planning and
  materialization reads are individually bounded to 2,500 cells, but there is
  no aggregate analysis-selection limit. Workbook Review, ordinary source
  preview, and the public SourceDocument range API retain their 500-cell
  request limit.
- A PlanRevision stores only output target, source/snapshot selections,
  structured review meaning, readable display steps, warnings, and derived
  rectangles. Field definitions, semantic keys, roles, internal ids, Python,
  input values, expected result rows, traces, and Plotly are forbidden.
- Feedback creates a later immutable numbered PlanRevision instead of patching
  prior plans. Draft validation happens before review persistence; one
  repairable range/plan failure may be returned to the provider for a bounded
  rewrite.
- Plan acceptance requires idempotency and re-resolves each source selection.
  It creates only a queued AnalysisRun. It does not generate or execute Python
  and does not create an AnalysisResult/ChartSpec.
- Execution materializes one `inputs.tables` item per workbook selection with source
  metadata, starting row/column, typed values, display values, and optional
  formulas plus ordered column metadata. Snapshot selections become ordered
  `inputs.experiments` fields carrying `columnIndex`, readable metadata,
  source summary, value/missing state, and exact source refs. Large inputs may
  be paged read-only with `inspect_run_input` and
  `inspect_experiment_input`.
- Only after materialization may the code-generation model produce
  `labrat-python-v2` implementing `analyze(inputs, labrat)`. The model sees the
  real dictionary input contract; users do not review Python.
- Syntax/runtime or output-contract diagnostics may be returned to the code
  model for one bounded replacement-program attempt inside the same run. This
  technical repair cannot alter the accepted sources or natural-language plan;
  scientific changes still require a new user-reviewed PlanRevision.
- A model cannot call the executor. Only the authenticated AnalysisRun endpoint
  can policy-check and execute the accepted run package.
- Static policy permits a bounded numeric-library allowlist and rejects dynamic code, direct numeric-library I/O, module/private-attribute escapes, process, network, filesystem, runtime-internal, and path-traversal operations. The runner repeats AST checks with restricted builtins.
- Local execution is a non-production development adapter, not a security sandbox. Static and runner-side AST policy reduce accidental misuse but are not an isolation boundary. Production defaults to disabled and requires an externally hardened HTTPS worker with network denial, read-only assets, isolation, and resource limits.
- Executor output is untrusted until deterministic validation checks JSON
  serialization, finite values, Plotly key/string safety, x/y lengths,
  trace/point/payload limits, source ownership, stable trace ids, and only
  calculation invariants explicitly declared in the reviewed plan. Single-series
  totals use `trace_y_sum`; stacked components normalized per shared X category
  use `x_group_y_sum`.
- Only valid authoritative Plotly becomes an immutable awaiting-review
  AnalysisResult. No executor path creates a ChartSpec. Result feedback creates
  a later plan revision without mutating prior artifacts.
- Result acceptance is deterministic and requires the exact AnalysisResult id
  plus at least one known visible trace id. The backend atomically accepts the
  existing result and creates one ChartSpec; the model cannot invoke or bypass
  this boundary.

## Chart Rules

- Every chart request uses the reviewed analysis workflow, including explicit source-range wording.
- Analysis-result ChartSpecs derive only from one accepted backend-validated
  AnalysisResult and retain exact analysis artifact ids, source selections,
  complete Plotly data/layout, and a matching flat trace catalog.
- The planning model may select evidence and suggest chart type, axes,
  processing, and style. The later code-generation model may produce Python,
  but neither model can publish or bypass Plotly validation.
- A ChartSpec owns the complete accepted trace domain. A Manuscript placement owns only its local `visibleTraceIds`; model suggestions and user visibility changes cannot remove traces from the immutable catalog.
- Existing-chart commentary is read-only: the backend resolves the accepted
  project ChartSpec by id, limits the provider context to the manuscript
  placement's visible traces, and returns prose through AgentRun. Commentary
  must not create or revise analysis plans, runs, results, charts, or manuscript
  blocks; insertion of returned text remains an explicit user action.

## AgentRun Rules

AgentRuns may persist:

- visible workflow steps
- tool names and summarized observations
- confirmable action cards and artifact ids
- warnings/errors
- provider, model, token, latency, and cost metadata

They must not persist hidden reasoning. Deterministic runs record the deterministic provider designation.

## Provider Safety

Provider access is backend-only. The frontend contains no provider-key/model settings and never calls a provider endpoint directly. Backend configuration supplies provider secrets, while the browser receives only user-facing replies, visible workflow artifacts, warnings, and bounded provider/model/usage/latency metadata.

`LABRAT_AI_PROVIDER` must explicitly select exactly one supported provider for
the backend process in every environment; there is no Anthropic fallback
default. Anthropic and DeepSeek credentials may both exist on the server, but
the gateway constructs only the selected adapter and never copies the
unselected key into a request. LabRat never automatically fails over between
providers. Production refuses to start when the selected key is missing;
development may run with model capability reported as unavailable.

The adapters intentionally preserve different wire contracts. Anthropic uses
Messages, `x-api-key`, `tool_use`/`tool_result`, and Anthropic JSON Schema
output configuration. DeepSeek uses Chat Completions, Bearer authorization,
OpenAI-style function tools and tool messages, JSON mode, and DeepSeek thinking
parameters. Only normalized structured results, usage, stop reason, and safe
diagnostics cross back into the provider-neutral domain layer.

Local selection comes from the ignored `.env` and requires a backend/container
restart. Production selection comes from the required GitHub Repository
Variable of the same name at deployment time. Provider keys remain only in the
root-owned `640` Lightsail environment file. A failed production switch restores
both that file and the prior release before restarting the prior service.

All structured provider output is parsed and validated against the backend's
JSON Schema before it reaches workflow services. DeepSeek uses stable JSON
mode and includes the target schema in its bounded prompt. Empty, truncated,
malformed, or schema-invalid output may receive one same-provider correction;
authentication errors, cancellation, and invalid configuration are not
retried. Tool arguments are validated before any handler executes.

DeepSeek V4 Pro runs intent classification, workbook-region explanation,
read-only answers, and Experiment Browser plan drafting with thinking disabled.
Chart planning and Python program generation use high-effort thinking. If a
structured response reaches its output-token limit, the gateway makes at most
one concise same-provider retry with thinking disabled; it does not repeat the
same high-reasoning request. Tool-loop `reasoning_content` may be
returned transiently to DeepSeek as required by its protocol, but it is never
persisted, logged, exposed through AgentRun, or sent to the frontend.
The default model and request policy follow DeepSeek's official
[model documentation](https://api-docs.deepseek.com/quick_start/pricing) and
[Thinking Mode guide](https://api-docs.deepseek.com/guides/thinking_mode).

The frontend reads a backend-owned capability summary before retrying planning
or accepting a plan. Unknown, loading, or failed capability state is treated as
unavailable. A local executor may be reported only in non-production; a worker
is production-ready only when configured with a valid HTTPS endpoint.

Workbook-region interpretation uses provider-enforced structured output for a
small correction-patch Schema. The model does not repeat the deterministic
field catalog, source series, or inclusion rows. Required empty wire values are
removed before applying the patch, and semantic types, axes, field roles, value
types, columns, and ranges remain subject to deterministic backend validation.
Token-limit truncation and malformed output remain retryable failures and never
create a RegionUnderstandingRevision.

Provider usage includes input, output, and provider-reported reasoning tokens
when available. A failed structured request retains this bounded metadata on
the visible AgentRun warning/usage record; failure must not be rewritten as a
deterministic zero-token operation.

For a row-oriented region whose identity column fits the bounded source-read
limit, the backend reads that complete column and supplies only its exact count,
range, and first/last nonblank identifiers as identity evidence. Visible
experiment counts and identifier endpoints are generated from that evidence,
not from the model's limited inspection rows. Model summaries that claim an
unsupported experiment scope or whole-table numeric range are discarded.
Region-level confidence describes structural interpretation only; a truncated
inspection cannot receive the same confidence as a complete inspection.

Workbook upload and deterministic candidate creation do not wait for model
interpretation. The browser opens Workbook Review with durable pending regions
and schedules at most three bounded region calls concurrently. Initial
semantic hints are server-persisted; reopening a workbook can resume pending
regions. Provider or request failure affects only one region and requires an
explicit retry. No browser-independent worker is implied by this queue.

The backend intent router applies deterministic priority to explicit upload,
navigation, and source-evidence commands. LabRat supplies the active workspace
surface as bounded context. That surface is only a weak routing hint: on the
Browser surface, a request must still express a scientific data addition,
derivation, replacement, or publication before it can become
`publish_experiment_data`. Chart requests and display-only show/hide/filter/
sort requests remain separate. Bounded model classification receives only safe
context values and may resolve ambiguous messages only into the supported
intent/disposition enum. Invalid model output becomes clarification and cannot
create an Experiment Browser fallback action.

## Retired Inputs

The former aggregate dataset, generic import/mapping collections, analysis views, and observation-series records are not valid AI context or scientific evidence. Do not restore prompts or tools that depend on them.
