# Code Review Checklist

Status: active
Last reviewed: 2026-07-16

## Scope And Ownership

- [ ] Changes follow `doc/plan.md` and `doc/current-milestone.md`.
- [ ] Project/lab authorization is enforced server-side.
- [ ] Unrelated worktree changes are not reverted.
- [ ] Persisted shape/API changes update active contracts.

## Scientific Integrity

- [ ] Raw files and SourceDocument evidence remain immutable.
- [ ] Accepted values have exact source refs and deterministic provenance.
- [ ] Missing values, units, identities, and conversions are not guessed.
- [ ] Incompatible units remain separate unless a reviewed conversion exists.
- [ ] Historical accepted snapshots are append-only.

## Workbook Review

- [ ] Red-box revisions target the explicit active region.
- [ ] Structured interpretation is backend validated.
- [ ] Identity/unit/low-confidence blockers prevent premature confirmation.
- [ ] Confirmation creates only accepted WorkbookUnderstanding state.

## DataPlan And Browser

- [ ] DataPlan uses accepted WorkbookUnderstanding and backend source reads only.
- [ ] Draft execution is transient and deterministic.
- [ ] Publish checks dependency/preview hashes and uses idempotency.
- [ ] Publish is atomic across DataPlan, DataSnapshot, identities, heads, receipt, and audit.
- [ ] Browser rows derive only from active accepted snapshot heads.
- [ ] List responses omit large series point arrays; detail is lazy.
- [ ] ProjectBrowserConfig stores shared display state only, is version-checked,
      and never contains authoritative values; historical BrowserViews remain
      owner-scoped provenance only.
- [ ] Experiment annotations are owner-isolated, bounded, and never expose the
      note, color, or annotator identity to another project user.
- [ ] Custom Browser columns are project-shared, editor-writable, bounded, and
      remain separate from immutable accepted DataSnapshots.

## Charts And Manuscript

- [ ] Durable charts are source-backed with immutable source snapshots, or explicitly reject unsupported DataSnapshot charting.
- [ ] Chart proposals and ChartSpecs preserve exact source refs.
- [ ] Manuscript chart blocks store ChartSpec snapshots and selected view state.
- [ ] Selection, drag, resize, keyboard movement, nested chart layers, and PPTX output are regression checked when touched.

## Agent And AI

- [ ] Agent/tool actions are proposal-first and review gated.
- [ ] Unconfirmed evidence is never marked DataPlan-ready.
- [ ] Visible traces do not expose hidden chain-of-thought.
- [ ] Context is compact, project-owned, and excludes credentials/full workbooks.

## Verification

- [ ] Focused tests cover the changed risk.
- [ ] `npm test` passes for frontend/cross-UI changes.
- [ ] `npm --prefix backend test` passes for backend/data changes.
- [ ] `npm run build` passes.
- [ ] `npm run codex:verify` and `git diff --check` pass before milestone completion.
- [ ] Browser QA covers the affected workflow when UI behavior changes.
