# Ask citation validation and progress presentation

Date: 2026-09-28. Status: automated verification passed; deployment/user retest pending.

The user selected Q01-scope.txt and asked: "Based only on this document, what are
the temperature, duration, and applicable sample types for RQ-001? Please cite
the relevant passages." The progress text was uppercase and crowded against
Cancel; the answer ended with qa_citation_invalid.

Read-only production diagnostics confirmed the TXT was fully parsed and ready
(SHA-256 5edb14c1c49a5f83243a19aef28ccc420fc355852c16b99885d4740bf75286ca).
Its text gives Protocol RQ-001, 80 C, 30 minutes, and dry samples only, excluding
wet samples. The request stored project scope: the exclusive-scope expression
recognized "only use" but missed "Based only on".

Failed model output is not persisted, so the original candidate cannot be
reconstructed. A separate replay of the same synthetic text/question with the
configured Anthropic claude-sonnet-4-5 model reproduced qa_citation_invalid:
all three correctly cited claims were rejected because 001 inside RQ-001 was
treated as an unsupported scientific number. The final tool-free repair returned
the same claims and was rejected again. No hidden reasoning was collected.

Changes:

- Recognize a protocol code only when explicitly declared in the claim's cited
  document text. Match the whole exact token, leaving wrong codes and new values
  subject to validation. Remove code digits from numeric quote support as well:
  a quotation of RQ-001 cannot authorize a measured value of 1.
- Preserve exact quotations, units/scales, structured bindings, review boundaries,
  authorization and the one-repair/shared-budget limits.
- Recognize "Based only/solely on" with references in direct Ask and continued
  AssistantTasks, with matching composer scope text. Existing saved scope is not
  rewritten on retry.
- Use 13px sentence-case progress and a separate 12px action row. Citation failures
  explain why the answer was withheld, keep diagnostic details and allow retry.

Verification:

- Added a regression that failed before the fix. Protocol identity, individual
  temperature/time/sample claims, wrong values/units/codes, invented quotes and
  uncertain numerical OCR are covered; all 14 citation/budget tests pass.
- 18 focused frontend tests cover status, cancel/retry, queued start, source scope
  hints and the unified Ask workflow.
- Full `npm run codex:verify`: 447 frontend tests, 397 backend Node tests passed
  (nine expected skips), 72 Nest tests, generated API check, both builds and
  production entry smoke passed. Existing large-bundle warning remains.
- Three real PostgreSQL scenarios passed, covering questions, selected versions,
  access, concurrent task continuation and "Based only on" in both API paths.
- A fresh configured-provider replay using the candidate validator returned
  80 C, 30 minutes and dry-only/wet-excluded with exact quotations. Validation
  passed on the initial answer. This is a bounded synthetic canary, not a claim
  of general answer correctness; no production project writes were made.
- Actual-browser status/layout, cancel/error/retry and the full existing unified
  Ask workflow passed against real HTTP/PostgreSQL and a deterministic provider
  substitute. Computed sizes were 13px/12px at desktop and 390px, sentence case,
  no overlaps or overflow. Final screenshots were inspected.
  The first run passed desktop/mobile geometry and cancel/error presentation,
  then stopped because a test expected a standalone text node for a details
  element. The selector was corrected without changing application markup.

Committed safe receipts: [configured-provider replay](qa-citation-provider.json)
and [browser status geometry](qa-citation-layout.json). Backup set 20260928204950
in `/var/backups/labrat/qa-citation-status-20260928` passed integrity checks.

Temporary local evidence: `.tmp/qa-citation-verify.log`,
`.tmp/qa-citation-diagnostic.jsonl`, `.tmp/qa-citation-candidate.jsonl`,
`.tmp/qa-citation-browser.log` and `.tmp/unified-ask-browser/citation-*`.

User retest: refresh the page, select @Q01-scope.txt, and send a new copy of the
question. The hint should say only selected references; the answer should state
80 C, 30 minutes, dry samples only and wet-sample exclusion, with citations that
open the matching original lines. Existing failed messages remain in history.
