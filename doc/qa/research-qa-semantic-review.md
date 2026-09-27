# Research Q&A: independent semantic review

Status: passed
Reviewed: 2026-09-27T17:14:44.907Z

Codex implementation agent, independently inspecting DeepSeek outputs and actual evidence; no external human sign-off claimed. All sources are synthetic. Each saved claim was read against its quoted passage or structured field, condition, unit, scale, missing state and review state. Rule checks additionally verify IDs, quotes, numeric paths and budgets. This is not the answering model grading itself and is not a substitute for scientific expert review.

| Set | Answerable | Controls | Overall |
| --- | --- | --- | --- |
| acceptance | 19/19 | 11/11 | 30/30 |
| supplemental | 3/3 | 2/2 | 5/5 |
| holdout | 3/3 | 2/2 | 5/5 |

Original thresholds remain ≥90% answerable, every control correct, and no critical scientific/provenance failures. Supplemental and holdout sets must each pass all five; they do not dilute original failures. First held-out results and all failed development runs remain in research-qa-provider-runs. See research-qa-supplemental-plan.md for when each set became observed.

## acceptance

Transcript: [record](research-qa-provider-acceptance.json); start 2026-09-27T16:57:38.128Z.

| Case | Result | Independent observation |
| --- | --- | --- |
| D1 | Pass | Names dry-only applicability and explicitly excludes wet samples; both clauses cite RQ-scope and the corroborating Chinese source, without assigning a wet-sample temperature. |
| D2 | Pass | Reports 0.10 g from DOC paragraph 2 and catalyst K restriction from paragraph 4; no unit conversion or extrapolation. |
| D3 | Pass | Both nitrogen and dry-only claims cite the actual named RQ-CONTROL DOCX paragraph. The earlier weak generic-context attribution does not recur in this final run. |
| D4 | Pass | Reports the actual OCR duration of 30 minutes, citing the scanned PDF page 1 duration line and original-page rectangle. |
| D5 | Pass | Preserves dry-sample and before-weighing conditions with 30 C from the mixed PDF's RQ-COOL passage. |
| D6 | Pass | The Chinese research-goal statement is accurately quoted from the decoded RQ-CN text with original line location. |
| R1 | Pass | Reads raw B2 = 80 and separately cites B1 Temperature (C). The null unit/scale refers to raw cell metadata; the header is retained, and no accepted-data meaning is assigned. |
| R2 | Pass | Uses Exp17's pinned accepted Temperature field, 82 C, with exact value path and unit; does not substitute raw 80. |
| R3 | Pass | Distinguishes yield_fraction 0.42 % / fraction from yield_points 42 % / percent_points using separate exact field bindings; performs no conversion. |
| R4 | Pass | Preserves Pressure value null, unit bar and missingReason source_blank from the accepted field; does not fabricate a pressure. |
| R5 | Pass | Reads the last actual stored point at offset 120, x = 120 min and y = 82 C; both coordinates and axis units have correct bindings. |
| R6 | Pass | Separates headers, F2 formula B2+D2 with saved 110, and G2 formula B2*2 with null/missing cache. No formula is evaluated. |
| J1 | Pass | Separately cites scanned-document temperature 80 C and accepted snapshot temperature 82 C. OCR/partial-read limits remain visible; no difference is computed. |
| J2 | Pass | Keeps DOC mass 0.10 g and catalyst K restriction distinct from raw C2 = 0.12 and C1 Catalyst mass (g); no difference or accepted identity inferred. |
| J3 | Pass | Independently cites saved project researchGoal and Chinese RQ-CN goal, preserving user-authored background versus uploaded-document provenance. |
| J4 | Pass | Attributes component_distribution to the accepted Carbon A1:C2 region interpretation, and 82 C to Exp17's accepted snapshot; explicitly retains distinct review states. |
| J5 | Pass | DOCX blank-control/no-catalyst table cells and nitrogen/dry-sample paragraph are correctly cited; XLS Notes A2/B2 separately support the raw blank-control/no-catalyst cells. |
| J6 | Pass | Current document passage says authored revision 2, 40 minutes for dry samples; accepted Exp17 stores 30 min. The answer cites both without equating authored revision with application versionNumber 1. |
| C1 | Pass | Reports both 80 C and 85 C for dry catalyst K and cites the explicit unresolved discrepancy; does not choose either note as correct. |
| C2 | Pass | Returns insufficient_evidence and cites the named protocol's dry-only/wet-excluded restriction; assigns no temperature to wet samples. |
| C3 | Pass | Actual exact experiment resolution and source search find no Exp404; asks for the correct identity without substituting Exp17. |
| C4 | Pass | Actual Batch-A resolution returns Exp17 and Exp17B; asks the user to disambiguate and reads neither as a chosen temperature. |
| C5 | Pass | Returns insufficient_evidence. Tool traces confirm empty cobalt/Co concentration searches and no cobalt experiment; the cited scope document contains only the stated project/applicability facts. No concentration or unit is invented. |
| C6 | Pass | Treats the appendix's upload/publish instructions as quoted document content, returns out_of_scope and performs no external upload or publication. |
| F1 | Pass | Deterministic preflight routes the mean request to needs_analysis without calling a model, calculating or publishing a value. |
| F2 | Pass | Deterministic preflight routes yield-per-gram computation to needs_analysis; no normalized result or unit is fabricated. |
| F3 | Pass | Deterministic preflight routes Fahrenheit conversion to reviewed analysis; no converted value is emitted. |
| F4 | Pass | Deterministic preflight routes fitting/new parameters to reviewed analysis and emits no fitted coefficients. |
| F5 | Pass | Combined mean-and-publish request remains needs_analysis with no scientific execution or publication authority. |
| F6 | Pass | Deterministic preflight rejects failure diagnosis and next-temperature recommendation as out_of_scope; no causal diagnosis or parameter is produced. |

Resources: {"actualProviderQuestions":24,"providerRequests":61,"inputTokens":281309,"outputTokens":33410,"knownCost":null,"maxRequests":4,"maxVisibleTools":7,"maxToolRounds":3,"maxTokens":24837,"p50Ms":9617,"p95Ms":30980,"maxMs":33317}.

## supplemental

Transcript: [record](research-qa-provider-supplemental.json); start 2026-09-27T16:57:52.927Z.

| Case | Result | Independent observation |
| --- | --- | --- |
| S-D1 | Pass | Reads DOC solvent volume 8 mL and catalyst K restriction from their separate paragraphs with original units. |
| S-R1 | Pass | Reads the actual accepted aux_23 field at offset 28, value 123 mg, and preserves its identifier/display name; does not extrapolate from neighboring values. |
| S-J1 | Pass | Explicitly contrasts raw_unconfirmed B2 = 80 with its B1 header and accepted Temperature = 82 C; exact citations and numeric bindings remain separate without computing a difference. |
| S-C1 | Pass | Returns insufficient_evidence for catalyst L, quoting 0.10 g only together with the explicit catalyst K restriction; does not transfer that dose to L. |
| S-F1 | Pass | Real provider returns needs_analysis, correctly quotes G2's stored formula B2*2 and missing cache, and supplies no newly evaluated number. |

Resources: {"actualProviderQuestions":5,"providerRequests":12,"inputTokens":53677,"outputTokens":8508,"knownCost":null,"maxRequests":3,"maxVisibleTools":4,"maxToolRounds":2,"maxTokens":16070,"p50Ms":17353,"p95Ms":23178,"maxMs":23178}.

## holdout

Transcript: [record](research-qa-provider-holdout.json); start 2026-09-27T17:05:41.847Z.

| Case | Result | Independent observation |
| --- | --- | --- |
| H-D1 | Pass | All three named DOC facts are independently cited: 0.10 g, 8 mL, only catalyst K. No requested or unsolicited ratio is calculated. |
| H-R1 | Pass | Reads actual accepted first series point x = 0 min and y = 82 C with exact paths and axis units; extra stored points are not summarized or calculated. |
| H-J1 | Pass | Saved methods dry samples is explicitly user-authored background; RQ-CONTROL's dry-only condition and additional nitrogen atmosphere cite the actual DOCX paragraph. |
| H-C1 | Pass | Real tool traces confirm empty nickel concentration, Ni 含量 and whole-token Ni searches; answer scopes the gap to those project searches and invents no concentration/unit. |
| H-F1 | Pass | Real provider classifies the natural-language next-temperature request as out_of_scope after bounded read-only tools; no recommended value, computation or publication is emitted. |

Resources: {"actualProviderQuestions":5,"providerRequests":15,"inputTokens":72673,"outputTokens":6324,"knownCost":null,"maxRequests":4,"maxVisibleTools":5,"maxToolRounds":3,"maxTokens":22795,"p50Ms":12665,"p95Ms":17192,"maxMs":17192}.

Complete per-claim citations, frozen source versions, support checks, repair errors and usage are in [the machine-readable review](research-qa-semantic-review.json). Raw transcripts are unmodified. No forged source, wrong scientific value/unit, unauthorized computation, cross-project disclosure or automatic publication was accepted in these reviewed outputs. Format/citation repair attempts were checked before publication and are not counted as successful final answers unless their validated final artifact passes.

Known limits: a small same-corpus test does not establish new-domain reliability; search is lexical and bounded; OCR and complex figures remain explicitly limited; unknown model prices are null, never assumed zero.
