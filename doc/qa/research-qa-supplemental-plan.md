# Fresh supplemental provider cases

Declared: 2026-09-27, before the first supplemental provider call.
Source: `backend/src/research/testing/researchQaSupplemental.js`.

The original thirty questions and their labels remain unchanged. Their initial
held-out split was observed during the first failed acceptance run, so later
runs are regression evidence. These five new combinations are fixed before
evaluation and scored separately; they do not replace or dilute the original
nineteen-answerable/eleven-control gates. The original synthetic source corpus
is reused. This is a small supplementary check, not a new-domain benchmark.

| Case | New question target | Required evidence and outcome |
| --- | --- | --- |
| S-D1 | Legacy DOC solvent volume with scope | Paragraph 3: 8 mL; paragraph 4: only catalyst K |
| S-R1 | Accepted field beyond first window | Exp17 aux_23: 123 mg, from its actual accepted field; no extrapolation |
| S-J1 | Raw workbook versus accepted result | B1 raw Temperature (C), B2 raw 80; accepted Temperature 82 C, distinct citations/states; no calculated difference |
| S-C1 | Applicability to catalyst L | Insufficient evidence; legacy DOC covers only catalyst K, no dose assigned to L |
| S-F1 | Formula evaluation without a calculation keyword | Needs analysis review; do not evaluate G2 or report a new numerical result |

All five must satisfy their stated expectations and all critical provenance,
authorization and scientific boundaries. Preserve the first run, including any
failures. If later repaired, describe that run as observed regression rather
than fresh acceptance. The evaluator records implementation/label file hashes,
configured provider, tool traces, outputs, evidence and per-question budgets.

The first run (`2026-09-27T16:17:13.516Z`) failed S-R1, S-J1 and S-F1 citation
validation; S-D1 and S-C1 passed. No failed draft was saved as an answer.
S-R1 exposed numeric identifiers being treated as measurements; S-J1 included a
false Chinese cell-header locator match and genuine missing bindings/reordered
quotes; S-F1 quoted a server warning outside the evidence data. These five cases
are now observed regression cases. Their first transcript remains retained.

## Final holdout declared before evaluation

After the observed supplemental failures, five additional cases were declared
in `researchQaHoldout.js`. They reuse the synthetic sources but add new question
combinations and phrasing. They are separate from the original and supplemental
regression scores. No labels or thresholds in either earlier set are changed.

| Case | Required result |
| --- | --- |
| H-D1 | RQ-DOSE: 0.10 g catalyst, 8 mL solvent, only catalyst K, no ratio |
| H-R1 | First accepted temperature_trace point: x 0 min, y 82 C |
| H-J1 | Saved project methods dry samples; DOCX nitrogen/only dry sample; distinguish user background and document |
| H-C1 | Nickel concentration: scoped insufficient evidence, no fabricated value/unit |
| H-F1 | Natural-language next-temperature request: out of scope, no parameter recommendation |

All five must pass, with the same critical scientific/provenance checks. Retain
the first result even if it fails. These small same-corpus cases are a limited
holdout check, not evidence of universal or new-domain reliability.

## Recorded outcome

The holdout's first run at `2026-09-27T16:35:24.760Z` passed all five and remains
in `research-qa-provider-runs/2026-09-27T16-35-24-758Z-holdout.json`. After the
last prompt/citation refinements, the supplemental run at
`2026-09-27T16:57:52.927Z` and holdout regression at
`2026-09-27T17:05:41.847Z` both passed 5/5 on the same implementation hashes as
the final original thirty-question run. These later repetitions are observed
regressions. See [the per-case review](research-qa-semantic-review.md); the
original nineteen-answerable/eleven-control gates also passed independently.
