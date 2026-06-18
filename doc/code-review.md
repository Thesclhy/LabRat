# Code Review Checklist

Use this checklist before handing off a meaningful Codex milestone. It is intentionally focused on LabRat's source-backed scientific workflow rather than generic style nits.

## Correctness

- [ ] The change matches `doc/plan.md` or updates the plan when the intended direction changed.
- [ ] The implementation matches relevant API/schema/data dictionary docs.
- [ ] Code/doc conflicts are reported or resolved explicitly.
- [ ] The change is scoped to the requested milestone and does not rewrite unrelated flows.

## Scientific Data Integrity

- [ ] Raw files remain immutable.
- [ ] Accepted scientific data is traceable to source refs, file ids, import runs, and review decisions.
- [ ] Dataset commits remain immutable; refresh/replace creates a new commit.
- [ ] Proposals remain separate from accepted data until user review.
- [ ] AI output is validated against real project data and never treated as source-of-truth.
- [ ] Source-backed or analysis-view-backed ChartSpecs cite SourceDocument/SourceRegion/ObservationSeries/AnalysisView ids as applicable.

## Backend/API

- [ ] Authenticated routes enforce lab/project membership and role checks.
- [ ] Mutating APIs write or preserve audit events where required.
- [ ] Error responses use the documented `{ error: { code, message } }` envelope.
- [ ] Memory and Postgres stores stay in parity for new persisted concepts.
- [ ] Migrations are additive and idempotent where possible.
- [ ] AgentRun tools are allowlisted, bounded, and separated into read-only, proposal, and confirmed mutation steps.
- [ ] Source range reads are bounded and do not return full raw workbook grids in normal project-state responses.

## Frontend/UI

- [ ] Logged-in server project state remains the source of truth.
- [ ] Existing unsaved Manuscript behavior is not accidentally overwritten by project refreshes.
- [ ] Review surfaces show warnings, confidence, provenance, and stale state clearly.
- [ ] AnalysisView and ObservationSeries compare flows expose enough provenance for a user to verify source evidence.
- [ ] AgentRun visible traces summarize tool use without exposing hidden chain-of-thought.
- [ ] Dense research-workflow UI conventions are preserved.
- [ ] Text does not overflow or overlap in likely desktop/mobile widths.

## Tests And Verification

- [ ] Targeted tests cover the new behavior and likely regression.
- [ ] `npm test` passes or the failure is documented.
- [ ] `npm --prefix backend test` passes or the failure is documented.
- [ ] `npm run build` passes or the failure is documented.
- [ ] Docker/Postgres smoke or `npm --prefix backend run test:postgres` is run when schema/Postgres behavior changed, or the reason is recorded.

## Handoff

- [ ] `doc/PROGRESS.md` includes the milestone summary and verification.
- [ ] `doc/decisions.md` records any durable decision.
- [ ] `doc/task-checklist.md` reflects remaining follow-ups.
- [ ] Final response lists files changed, commands run, and remaining risks.
