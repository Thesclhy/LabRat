# Read-only Q&A provider review

Reviewed: 2026-09-29 America/New_York (raw run filenames use UTC 2026-09-30).
Synthetic data only; no production questions, credentials or research records.
The transcripts remain unchanged. Their pending semanticReview field is the
runner's initial value; the completed review is recorded here separately.

## Method and limits

Read the returned paragraphs, missingEvidence, actual tool inputs/results and
frozen evidence against the expectations fixed in readonly-qa-trace.md before
implementation. Source identities matter: Q01 has a same-name unrelated 99 C
document; the chosen method is 80 C, while the synthetic accepted Exp17 snapshot
is 82 C. These are deliberately distinct fixture states, not an automatic
conversion or an expected discrepancy in the user's imported workbook.

The reviewer is the coding agent inspecting the saved transcript. This is not
independent human scientific approval or a statistical hallucination guarantee.
R10 and R10-diagnosis use the preserved deterministic early review boundary and
make no model call. The other 14 cases use real configured provider responses
and real project-scoped tools. No output fact-checker is involved.

## Final reviewed runs

- [Anthropic claude-sonnet-4-5](readonly-qa-provider-runs/2026-09-30T00-25-44.199Z.json):
  16 completed cases, all fixed expected behaviors observed. This run predates
  the later resource-limit artifact fallback (covered by PostgreSQL/UI tests)
  and the final selected-only coverage wording correction (retested below).
- [DeepSeek deepseek-v4-pro](readonly-qa-provider-runs/2026-09-30T00-33-15.514Z.json):
  16 completed cases, all fixed expected behaviors observed with the resource-limit
  fallback present. R12-topic ended normally after four scoped searches without
  hitting the fallback. This predates only the final scope wording correction.
- Final selected-only coverage wording rechecks:
  [Anthropic R01/R08](readonly-qa-provider-runs/2026-09-30T00-42-09.943Z.json) and
  [DeepSeek R01/R08](readonly-qa-provider-runs/2026-09-30T00-42-23.659Z.json).
  Actual paragraphs and trace inspected: both read only the pinned Q01; R01 has
  80 C/30 minutes/dry only/wet excluded; R08 declines to infer measured Exp17 data.
  No experiment or other-project reader appears. All four checks pass.

| Case | Semantic and routing observations in both final runs | Result |
| --- | --- | --- |
| R01 | Pinned Q01 version; 80 C, 30 minutes, dry only and wet excluded; no 99 C substitution | Pass |
| R02 | Wet samples excluded; no applicable wet-sample temperature invented | Pass |
| R03 | Exact Exp17 lookup, pinned snapshot, accepted 82 C; DeepSeek also clearly distinguishes sourceRef raw 80 C | Pass |
| R04 | Actual confirmed Measurements A1:C2 read; B2=80 and Temperature (C) header | Pass |
| R05 | Reads both selected protocol and accepted snapshot, reports 80/82 C separately with no derived difference | Pass |
| R06 | Batch-A resolves to Exp17 and Exp17B; asks for identity; no arbitrary snapshot read | Pass |
| R07 | Confirmed C3 is blank for Exp17B; neither zero nor adjacent 0.12 g | Pass |
| R08 | Reads selected Q01 only; distinguishes method 80 C from missing Exp17 measured value | Pass |
| R08-followup | Resolves Exp17 again and reads accepted Duration 30 min; DeepSeek's extra project-background read is saved despite being uncited | Pass |
| R09 | No unconfirmed workbook read; asks for region selection and confirmation | Pass |
| R10 | needs_analysis; no calculation, execution or new value (deterministic boundary) | Pass |
| R10-diagnosis | out_of_scope; no diagnosis or proposed temperature (deterministic boundary) | Pass |
| R11 | Reads scan plus adjacent windows; apparent 80 C explicitly uncertain; original/source quality retained | Pass |
| R12 | Exact Exp404 lookup finds nothing; no substitution; asks for correct identity | Pass |
| R12-field | Missing Pressure, null, source_blank, stored unit bar and H2 location; no invented value | Pass |
| R12-topic | Bounded zero-result searches, scoped insufficient evidence, no fabricated concentration; searches are not listed as read passages | Pass |

Minor efficiency/wording limits remain: DeepSeek reread the same Pressure window
and read unneeded project background in a follow-up. Anthropic performed an extra
document search after the nonexistent experiment lookup. These did not change
scope or scientific values. The backend compacts repeat returns, enforces its
limits and retains actual reads; model tool selection is not claimed optimal.

## Preserved failures and iterations

- [First DeepSeek run](readonly-qa-provider-runs/2026-09-30T00-18-40.360Z.json):
  15/16 requests completed; cobalt topic exhausted the token reservation. Before
  scope-specific tool exposure it also attempted disallowed experiment/context
  reads in selected-only questions; the backend rejected them. The missing-pressure
  answer omitted the unit and attempted nonexistent document IDs. These are not
  silently counted as full passes.
- [Single-topic diagnostic](readonly-qa-provider-runs/2026-09-30T00-23-06.054Z.json):
  repeated the failure; after two zero-result topic searches the model browsed
  unrelated experiments/regions to try to prove absence.
- [Prompt/tool refinement](readonly-qa-provider-runs/2026-09-30T00-25-09.751Z.json):
  selected-only behavior improved, but the topic still exhausted its budget.
  Stronger guidance alone was insufficient evidence of reliability.
- Final behavior therefore also has a deterministic resource-limit outcome:
  no invented answer, no new model call, preserved actual read windows and a
  clear request to narrow the question. A resource-limit outcome is an incomplete
  search, not a semantic pass for establishing absence. Final successful runs
  above do not erase these earlier failures or guarantee every future run succeeds.

## Reproduction

Build backend dist-v1, then run backend/scripts/readonly-qa-provider-check.mjs
with LABRAT_TEST_DATABASE_URL pointing to a dedicated loopback PostgreSQL and
the normal backend provider credentials supplied privately. The runner refuses
non-loopback databases, creates/drops an isolated schema, uses synthetic fixtures,
and saves timestamped request/answer/read-window/tool-trace results with code hashes.
LABRAT_READONLY_EVAL_IDS may select case IDs; LABRAT_AI_PROVIDER selects the existing
provider. Full suite completion checks transport completion only; repeat the
semantic review above separately. Do not insert keys into command text or reports.
