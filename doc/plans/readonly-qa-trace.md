# Unified read-only Q&A and source trace

Status: deployed and verified 2026-09-30; user manual acceptance pending
Baseline: origin/main 4f99874, application 2bf3226; branch codex/readonly-qa-trace.

## Approved outcome

The existing model chooses bounded read tools using the question, selected
reference versions, current experiment and conversation. Real object identities
come from lookup results. The backend records actual returned evidence windows
and shows source links. No separate classifier, answer-review model or agent
framework is introduced. Answer prose is not a validated scientific result.

This decision supersedes the old Q&A requirements for exact generated quotations,
free-text numeric/unit matching and numericBindings as answer acceptance gates.
Keep output-shape and evidence-ID integrity checks with one bounded structural
repair; unresolved IDs are omitted with a visible link limitation, not a false
verification claim. Existing source/value/unit/permission checks in tools remain.

## Milestones

- M0: verify baseline/contracts, freeze acceptance cases before implementation.
- M1: simplify answer schema/prompt/service and improve tool descriptions; save
  all successfully returned evidence and bounded tool input/result trace.
- M2: collapsible Sources read, grouped by document version or experiment snapshot,
  with exact window links, discovery/read distinction and historical compatibility.
- M3: focused/regression, PostgreSQL, actual browser and real-provider synthetic
  evaluation; update contracts, progress and manual checklist with real evidence.

M0–M3 are complete. Evidence: ../qa/readonly-qa-trace.md and
../qa/readonly-qa-provider-review.md. Preserve the earlier failed provider runs;
the last successful synthetic suite is not a guarantee for arbitrary future input.
Deployment verification passed for 159e50b; see ../qa/readonly-qa-deployment.md.
The user's manual acceptance remains pending.

## Boundaries

PDF/Word/TXT remain references. Excel stays in workbook region review; only
confirmed regions and accepted snapshots enter new Q&A. Preserve selected-only
scope, full-project View access, Guest restrictions, personal history, explicit
cross-device continuation, scientific analysis review and immutable history.
No public search, diagnosis, parameter optimization, new scientific calculations
or automatic publication. Logs store tool activity, never hidden reasoning.

## Completion evidence

Use doc/qa/readonly-qa-trace.md as the frozen acceptance matrix and manual guide.
Each milestone records performed checks in doc/PROGRESS.md. Unknown or skipped
required checks stay incomplete. Semantic correctness is assessed in the fixed
synthetic evaluation, never inferred from link integrity. Deploy status is reported
separately from local verification. Preserve unrelated changes in the original tree.
