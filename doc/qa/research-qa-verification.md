# Research Q&A v1 verification

Status: completed locally — all required deterministic, retrieval, real-provider, database and browser gates passed
Date: 2026-09-27

Local baseline: main `0ca7e1c064865c40bbd9fcae0daef926238d370e`, with the user's
pre-existing dirty permission/analysis/docs work preserved. No commit, push,
merge, deployment or private research material is part of this delivery.

## Evidence and current outcome

| Gate | Evidence | Result |
| --- | --- | --- |
| Local parsers and OCR | `backend/src/research/documentParser.test.js` | 15 passed, actual engines |
| Citation/value/unit/scale validation, budgets, context windows | `backend/src/research/citedAnswer.test.js` | 13 passed; 22 including gateway checks |
| Workbook missing-cache correction | `backend/src/import/services/workbookScanner.test.js` | 4 passed |
| Document, evidence and personal-answer PostgreSQL | `backend/src/v1/research-qa/*.postgres.test.ts` | 5 focused tests passed; full database regression passed |
| Exact support Recall@8 | [per-question record](research-qa-retrieval.json) | 19 answerable questions, 100%, no missed labels |
| Actual browser workflow | `backend/scripts/research-qa-browser-check.mjs`, `.tmp/research-qa-browser/result.json` and screenshots | Passed with a deterministic provider substitute |
| Complete repository regression | `npm run codex:verify` | Passed: frontend 424, backend Node 390 (9 conditional/retired skips), Nest 86, API types, both builds and production-entry smoke |
| Real provider quality | [independent per-case review](research-qa-semantic-review.md), [raw original run](research-qa-provider-acceptance.json) | Passed: 19/19 answerable and 11/11 controls; unchanged thresholds |
| Supplemental / final holdout | [protocol and first-run history](research-qa-supplemental-plan.md) | Both final regressions 5/5 on the same implementation hashes; holdout also 5/5 on its first run |

All parser/database/browser fixtures are generated synthetic materials. Tests use
PostgreSQL 16.14 on loopback port 55437 with a unique migrated schema per run and
temporary file storage. No production database is used. Chrome runs headless on
Windows through the existing Playwright runtime; test-owned API/Vite/browser
processes and temporary schemas/storage are closed by the browser script.
After all acceptance runs, the verified goal-owned PostgreSQL service was also
stopped; its local files and test reports remain available. Final diff-format,
document-link and implementation/transcript hash checks passed.
The host has an Intel i9-12900H, twenty logical CPUs and 32 GiB RAM, running Node
24.15.0. Parser checks take about fourteen seconds. The final full database run
took 149.48 seconds while other evaluation work was running; these are test
observations, not a service SLA.

The full PostgreSQL command passed two legacy checks and nineteen Nest checks;
its opt-in real-provider evaluator was intentionally skipped there and passed
separately for each of the three final suites. Of the nine backend Node
skips in the general run, five required an explicit Windows Python path and
were subsequently run successfully (six checks including their policy test),
one was the PostgreSQL check subsequently run against the isolated database,
and three are explicitly retired DataPlan workflows. After the full regression,
the final small authored-revision check and named-document citation prompt
refinement passed all twenty-two focused gateway/citation checks, backend
compilation, full PostgreSQL and the three real-provider suites. The final
browser workflow uses the same UI/API implementation; its model substitute is
explicit. There is no skipped required deterministic gate.

## Retrieval labels and protocol

The corpus in `backend/src/research/testing/researchQaCorpus.js` has thirty
questions, six per group: documents, data, joint sources, controls and review.
The first three in each group were declared development questions and the final
three were initially held out. All thirty became observed during the first
failed full run; later repetitions are regression evidence. `researchQaLabels.js` specifies minimum
text fragments with original paragraph/page/line/cell locations, exact scalar
values, units, numeric scales, missing states and series positions. Control
statuses and forbidden unsupported conclusions are recorded separately.

The fixed retrieval probe uses the predeclared tool queries already attached to
each question. Explicit structured lookups consume one result slot each; ranked
document search hits fill the remaining slots up to eight. Irrelevant search
hits still consume a slot. The probe gives credit only for the actual required
passage or exact structured support; matching a filename alone earns no credit.
It does not expand neighbors after seeing a miss. The reported value is the
mean of each answerable question's support recall. Model query choice and
semantic interpretation are separate gates, now checked in the actual-provider
runs and independent per-case review below.

The first exact-support run scored 97.37% and exposed R6's missing formula cache
being indexed as a numeric zero. The fixed workbook scanner now preserves that
cell as null with its original formula; genuine cached zero remains zero. The
final retrieval run scored 100%. No expected support was removed or weakened.
Existing stored indexes or accepted scientific results are not rewritten.

## Browser coverage

- Upload TXT, DOC, DOCX, text/scanned PDF, XLS and XLSX through the interface;
  ask as soon as processing finishes.
- Read scanned PDF original pages/highlights and Word paragraph locations;
  open document, accepted snapshot and raw-cell citations with the keyboard.
- Open an old PDF citation after uploading a same-name new version and archiving
  the source. The old answer and original page retain the old value.
- Ask as a full-project View member; confirm upload/proposal controls are absent
  and selected-experiment/public Guest users cannot open Q&A.
- Verify a formula with no cache displays missing, a provider error can be
  explicitly retried, and cancellation saves no answer.
- Restore personal answers after refresh, remove access on revocation, use a
  narrow viewport, navigate Browser/manuscript and return from workflow chat.
- Enter source Q&A from an empty project's onboarding, upload a TXT source and
  open its cited text without publishing any experimental dataset.

Screenshots were visually inspected. No page errors or retired unversioned API
requests occurred. The fixture retained exactly its two seeded snapshots and
created no AnalysisRun or ChartSpec. Browser answers use a provider substitute;
this is not evidence that a real model can answer the corpus correctly.

## Real-provider evaluation and recovery

The configured provider remained DeepSeek (`deepseek-v4-pro`). The initial
development run failed five model questions for insufficient balance (HTTP 402),
while F1 routed deterministically to analysis review. The user confirmed restored
service; subsequent evaluations use the real configured model and synthetic
material only. No provider substitution or external OCR/embedding service was used.

Development exposed missing applicability qualifiers, incorrect control statuses,
repeated discovery during repair, raw-cell property paths, unsupported quoted
JSON, and numeric false positives for locators, identifiers and revision labels.
Repeated broad discovery also exhausted the original token budget. Fixes retain
all thresholds and budgets: concise evidence-routing instructions, one tool-free
format/citation repair using already-read evidence, exact metadata checks,
authorized duplicate-window compaction, and precise error hints. The final D3
also cites the named protocol for both required facts, correcting a weak
attribution seen in an earlier otherwise completed run. Failed runs remain in
`research-qa-provider-runs/`; completion alone was never a semantic pass.

Final runs use matching implementation, label and harness hashes:

| Set | Start (UTC) | Answerable | Controls | Questions calling real provider |
| --- | --- | --- | --- | --- |
| Original | 2026-09-27 16:57:38 | 19/19 | 11/11 | 24/30 |
| Supplemental | 2026-09-27 16:57:52 | 3/3 | 2/2 | 5/5 |
| Final holdout regression | 2026-09-27 17:05:41 | 3/3 | 2/2 | 5/5 |

Original F1–F6 are deterministic routing checks, not successful model answers.
S-F1 and H-F1 separately exercise real-model recognition of formula evaluation
and natural-language parameter recommendation. All final saved claims were
read against their actual passages or structured fields, conditions, units,
scales, missing states and review states by the Codex implementation agent.
This is independent of the answering DeepSeek model; it is not external human
or scientific-expert sign-off. Rule checks also validate quotes, identifiers,
numeric paths, expected support and resource bounds. There are no accepted
critical scientific/provenance failures in these reviewed outputs.

The original gate remains at least 90% correct answerable questions, every
control correct and no critical failure; both five-case additions must pass
all cases without diluting the original denominator. The holdout's first run
passed 5/5 before the final refinements. Its later repetitions are observed
regressions, as are the supplemental cases after their first failed run. See
[the declared protocol](research-qa-supplemental-plan.md) and
[the complete review](research-qa-semantic-review.md).

Across the final suites, thirty-four questions made 88 actual provider requests,
using 407,659 input and 48,242 output tokens. Original-set median question time
was 9.617 s, p95 30.980 s and maximum 33.317 s (sample median and nearest-rank
p95). No final question exceeded four
provider requests, seven visible tool calls, three tool rounds, or 24,837 actual
aggregate tokens. All questions satisfied the original 12-request/24-call/
8-round/60,000-token/120-second caps. These figures cover the final runs only,
not the preceding failed development attempts. Unknown monetary cost remains
null; it is not assumed zero.

The evaluator `provider-eval.postgres.test.ts` runs only when explicitly enabled
with `LABRAT_RUN_RESEARCH_QA_EVAL=1` and an isolated `LABRAT_TEST_DATABASE_URL`.
Omitting `LABRAT_QA_EVAL_IDS` selects all thirty cases; set
`LABRAT_QA_EVAL_SUITE=supplemental` or `holdout` for the separate five-case sets.
It records actual tools/outputs, model responses, frozen evidence, token usage,
elapsed time, errors, provider/model and source hashes. Raw transcripts retain
their original `pending_independent_review` marker without being rewritten.
The completed semantic judgments, transcript SHA-256 hashes and rule checks are
in the companion [machine-readable review](research-qa-semantic-review.json).
The evaluator's exit code checks request completion; the companion review is
required for the semantic gate.

The invoked commands were `npm run codex:verify`, the isolated
`npm --prefix backend run test:postgres`, the browser script above, and three
runs of `node --env-file=../.env --env-file=../.env.local
node_modules/vitest/vitest.mjs run --config vitest.v1.postgres.config.ts
src/v1/research-qa/provider-eval.postgres.test.ts` from `backend`, with the
explicit evaluator/database environment flags. Credentials are not copied into
reports. Final documentation uses `git -c core.safecrlf=false diff --check` on
this Windows checkout.

## Remaining limits

- Local keyword retrieval is bounded; the small fixed-query corpus does not
  establish broad scientific or multilingual model quality.
- OCR confidence is an engine score. Uncertain numeric text cannot become a
  definite numeric claim; scientific figures and complex tables are not inferred.
- Worker time/heap/image/archive bounds are fault containment, not an OS sandbox.
- Browser coverage is Chrome on Windows; other browsers and production deployment
  are unverified. No deployment, migration of a production database, commit or
  push was performed.
