# AI Boundaries

Status: active
Last reviewed: 2026-07-16

LabRat uses AI as a proposal and workflow layer. Authorization, bounded evidence reads, schema validation, deterministic execution, hashing, and persistence remain backend responsibilities.

## AI May

- classify workbook regions and explain confidence/warnings
- draft structured WorkbookUnderstanding patches from bounded source cells
- interpret a user's correction for the active red box
- rank accepted evidence for a stated task
- draft DataPlan intent/operations for backend validation
- resolve an explicit source-chart request into reviewable source extract/chart proposals
- explain Experiment Browser fields, comparison choices, source refs, and stale-review errors
- draft captions or manuscript text from user-approved evidence

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

## Context Rules

Send compact project-owned context only:

- project profile and user request
- bounded source-document metadata/ranges
- active red-box interpretation and validation blockers
- accepted WorkbookUnderstanding summaries/source refs
- DataPlan preview summaries, hashes, warnings, and identity decisions
- Experiment Browser field catalog and selected experiment summaries
- approved source-backed chart/manuscript summaries

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

WorkbookUnderstanding confirmation, DataPlan publish, source extract acceptance, ChartSpec creation, and Manuscript save are separate boundaries. Confirmation at one stage does not authorize later stages.

## Evidence Rules

- Usable DataPlan evidence must come from accepted WorkbookUnderstanding records and backend-owned SourceDocument reads.
- Unconfirmed candidates are suggestions with `canUseForDataPlan: false`.
- Accepted values cite exact source cells/ranges and accepted snapshot records.
- If the requested experiment, range, field, or unit cannot be resolved, return clarification rather than substitute another candidate.

## DataPlan Rules

- The agent may draft intent and operations; validators enforce `labrat.dataPlan.v2`.
- Result arrays are produced only by the deterministic executor.
- Publish re-reads evidence and re-executes the plan.
- Dependency/preview mismatches stop before writes.
- Identity create/reuse decisions and low-confidence acknowledgements are explicit user state.

## Chart Rules

- Current chart interpretation is source-evidence-only.
- Durable ChartSpecs require exact source refs and immutable `sourceSnapshot.rows` or `sourceSnapshot.series`.
- The model may suggest chart type, axes, and style, but cannot supply uncited plotted values.
- DataSnapshot-backed chart proposals remain unimplemented and must return an explicit unsupported transition.

## AgentRun Rules

AgentRuns may persist:

- visible workflow steps
- tool names and summarized observations
- confirmable action cards and artifact ids
- warnings/errors
- provider, model, token, latency, and cost metadata

They must not persist hidden reasoning. Deterministic runs record the deterministic provider designation.

## Provider Safety

The existing direct browser-to-Anthropic key path is development-only and must not be presented as production-safe. Production model access should be server-side, permissioned, auditable, rate-limited, and configured without exposing provider secrets to the browser.

## Retired Inputs

The former aggregate dataset, generic import/mapping collections, analysis views, and observation-series records are not valid AI context or scientific evidence. Do not restore prompts or tools that depend on them.
