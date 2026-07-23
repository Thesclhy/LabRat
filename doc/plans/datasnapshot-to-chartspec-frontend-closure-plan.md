# DataSnapshot To ChartSpec Frontend Closure Plan

Status: approved for implementation
Last reviewed: 2026-07-22

## Goal

Turn the implemented analysis contracts and test-double golden workflows into a
real development workflow that a user can complete from LabRat chat against
accepted project DataSnapshots. The milestone is complete only after the
current `test1` project runs a real backend Anthropic request and the exact
accepted Python program through result review into one persisted ChartSpec.

## Scope

In scope:

- enable the existing local Python adapter in local development only
- preserve the production prohibition on the local subprocess adapter
- expose backend model and analysis-executor availability without exposing
  credentials
- recover an `analysis_evidence_required` conversation after accepted
  DataSnapshots become available
- prevent users from accepting a plan when Python execution is unavailable
- run and record one real `test1` 63-experiment-head end-to-end workflow

Out of scope:

- allowing the local subprocess adapter in production
- deploying the hardened production worker
- sending complete workbooks or unrelated project data to Anthropic
- bypassing plan review, result validation, result review, or ChartSpec
  publication confirmation
- replacing ChartSpec with provider-generated Plotly JSON

## Product Decisions

1. Local development uses `LABRAT_ANALYSIS_EXECUTOR=local`; production keeps
   the existing `analysis_local_executor_forbidden` guard and must use a
   hardened worker before analysis execution is enabled.
2. Normal new chat requests always evaluate the latest accepted DataSnapshot
   heads. A prior thread that stopped with `analysis_evidence_required` also
   exposes `Retry with published data` after accepted heads become available.
3. Retry keeps the original AnalysisThread and request, records a new visible
   planning attempt, and drafts the first immutable AnalysisPlanRevision from
   current accepted heads. It does not silently execute or publish a chart.
4. Backend runtime capabilities are the source of truth. The frontend never
   infers model or executor availability from environment variables.
5. Model availability gates drafting and retry. Executor availability does not
   block plan inspection or feedback, but it disables `Accept plan` with a
   visible reason before a queued run can be created.
6. The real `test1` E2E may send only bounded accepted analysis context to
   Anthropic. Complete numeric execution inputs move directly from backend
   storage to the local executor and do not pass through model text.

## API Direction

Add one authenticated, project-scoped capability read:

```text
GET /api/projects/:projectId/analysis-capabilities
```

The bounded response contains no credentials:

```text
model
  provider
  model
  configured
executor
  mode
  adapter
  configured
  productionSafe
acceptedData
  acceptedSnapshotCount
  activeExperimentHeadCount
```

Add one editor-authorized, idempotent retry operation:

```text
POST /api/analysis-threads/:analysisThreadId/retry
```

Retry is valid only when the thread belongs to the active project, has no
current reviewable plan, and newer usable accepted evidence exists. The backend
re-runs the same bounded plan-drafting service used by a new analysis request.
Concurrent or replayed retry requests must not create duplicate revisions.

## Action Items

- [x] Add failing backend and frontend tests for capability reporting,
      development/production executor policy, retry authorization and
      idempotency, unavailable-state UI, and the exact plan-acceptance guard.
- [x] Document `LABRAT_ANALYSIS_EXECUTOR=local` in `.env.example`, set it in the
      ignored local development environment, verify the configured Python
      command and required numeric libraries, and retain the production-local
      rejection test.
- [x] Implement the authenticated analysis-capabilities service and API from
      `modelProvider.publicConfig()`, `analysisExecutor.publicConfig()`, and
      current accepted DataSnapshot/head counts; never serialize API keys,
      database credentials, worker credentials, or raw workbook values.
- [x] Implement `Retry with published data` for threads blocked by
      `analysis_evidence_required`, using the original request and current
      accepted heads to create a normal immutable plan revision. Keep ordinary
      resubmission through a new LabRat message supported.
- [x] Add a compact LabRat runtime-status surface and contextual review
      blockers. Show model and Python availability before planning; disable
      retry when the model is unavailable and disable `Accept plan` when the
      executor is unavailable while leaving plan feedback usable.
- [x] Run focused backend/frontend tests, the complete frontend and backend
      suites, `npm run build`, and `git diff --check` before touching real
      project data.
- [x] Run the real development E2E against `test1`: verify 63 active accepted
      experiment heads, submit an unambiguous analysis/chart request through
      LabRat, inspect the Anthropic-produced plan and exact source red boxes,
      submit at least one modification, accept the exact revision, execute the
      frozen Python locally, and inspect validated rows, exclusions, warnings,
      invariants, hashes, and lineage.
- [ ] Complete the same E2E by selecting the intended default-visible traces
      and invoking `Accept result and create chart`; reload the project and
      verify exactly one `origin: analysis_result` ChartSpec with complete trace
      data, accepted snapshot dependencies, source refs, and a renderable
      Plotly preview. Record provider/model metadata, token usage, runtime
      adapter, execution duration, and any exclusions without logging secrets
      or whole-workbook contents.
- [x] Update active contracts, `doc/current-milestone.md`, and
      `doc/PROGRESS.md` with the observed real-provider/real-executor evidence
      and any remaining production-worker limitations.

Observed 2026-07-22: publication and reload produced exactly one complete
analysis-result ChartSpec, but post-reload product consumption is not yet
acceptable in that recorded run. The resulting defects have since been repaired
and covered by automated complete-detail/preview/Canvas regressions plus a
1280px isolated-clone browser check. The second item remains open until a fresh
real-provider artifact is published, reloaded, and visually rendered after the
repairs; deterministic regressions alone do not close this gate.

## Acceptance Gate

Do not describe the frontend analysis workflow as complete until one user can,
without direct API or database intervention:

1. submit the chart request in LabRat after DataSnapshot publication
2. review the exact plan and Excel red boxes
3. revise the plan conversationally
4. accept and execute the exact frozen Python
5. review validated Python results and source lineage
6. select visible traces
7. click `Accept result and create chart`
8. reload and render the persisted ChartSpec

Passing deterministic provider/executor tests remains necessary but is not
sufficient for this gate.

## Risks

- The real Anthropic response may fail structured-plan validation; preserve the
  failure and provider metadata before changing prompts or schemas.
- The local executor is development-only and runs under the backend operating
  system account. Do not expose this environment to untrusted users or public
  traffic.
- `test1` E2E creates durable reviewed artifacts. Use clear E2E titles and do
  not overwrite or silently delete prior AnalysisThreads, AnalysisResults, or
  ChartSpecs.
- Snapshot-head changes during review must return the existing stale-plan
  conflict and require a fresh revision rather than executing old inputs.
