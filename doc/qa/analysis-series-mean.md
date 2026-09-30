# Mean-temperature planning regression

Status: implemented and verified locally; not merged or deployed
Date: 2026-09-30
Branch: codex/analysis-series-mean; baseline main bad89ca

## Report and root cause

The user's calculation-only request was routed as experiment_compare and then
defaulted to chart output. The chart planner had to return a chart and had no
structured missing-input response. It relabelled Measurements!B2, a scalar
temperature, as a one-value within-experiment series and announced a mean before
execution. Prior Q&A R10 coverage verified the review handoff, not plan quality.

## Scope

- Pure calculations clarify the supported output before creating a thread or
  calling the planner. Direct draft requests use the same check. Active Browser
  location alone cannot turn the mean request into a scientific write.
- Both chart and Browser plan providers can return clarification with null
  reviewPlan. That response creates no revision, repair attempt or execution;
  earlier revisions stay unchanged. Ask records the input question and displays
  More information needed instead of treating it as a provider failure.
- Prompts distinguish scalar fields from actual within-experiment series. A
  confirmed one-point series remains valid. Plans describe future calculations
  without announcing a newly derived answer.
- No new numeric-result output type, semantic answer validator, execution
  authority, persistence migration or production research-data write was added.

## Verification

Final full codex:verify: 452 frontend tests, 402 Node backend tests passed (411
total, 9 expected skips), 74 Nest tests; generated API check, backend build,
production entry smoke and frontend build passed. After the final prompt-only
wording refinement, 17 provider unit tests and backend build passed again.

Actual Anthropic and DeepSeek replay each covered these four cases. The output
choice case exits deterministically before a model call; the other three use
the configured real provider with the local synthetic confirmed-region fixture.

| Case | Expected and observed |
| --- | --- |
| Q09-style scalar for Exp17, chart of requested series mean | Missing-series clarification; zero plan revisions/runs |
| Genuine series, calculation only | Clarify supported output; zero plan revisions/runs |
| Genuine three-point series, mean and plot explicitly requested | Reviewable plan using that series; no evaluated mean or execution |
| Genuine one-point series, mean and plot explicitly requested | Reviewable plan; no arbitrary minimum point count or evaluated mean |

Initial Anthropic replay bypassing Ask invented a bar chart for calculation-only
input. This led to the shared backend output-choice check. A later clarification
incorrectly said a series requires multiple points; wording was narrowed to ask
for missing confirmed inputs. Final outputs were manually read and no longer
contained that definition or proposed cross-experiment averaging.

Reproduce with backend/scripts/smoke-ai-temperature-plan.mjs and a configured
provider; it writes bounded synthetic results under .tmp. No execution follows
plan creation. This test is a behavioral sample, not a guarantee that the model
will always interpret scientific semantics correctly; user review still applies.

Desktop 1280px and narrow 390px real Chrome component harness checks passed:
clarification label, no review/retry button for missing inputs, normal plan review
button still works, no page overflow or runtime errors. Screenshots inspected.
This was a component harness, not a logged-in end-to-end production test. A fresh
PostgreSQL suite and live deployment were not run for this fix.

## Manual retest after deployment

1. Leave the old incorrect Revision 1 unapproved; history is not rewritten.
2. Ask: Calculate the mean of Exp17's temperature series. At the analysis
   handoff, expect a supported-output clarification rather than a bar-chart plan.
3. Ask: Calculate the mean of Exp17's temperature series and plot it.
   With only Q09 scalar records, expect a request for the confirmed series;
   no asserted mean of 80 C and no executable plan.
4. With a separately confirmed temperature time series, repeat step 3. Review
   the exact source range and prospective calculation. A genuine one-point
   series is allowed; a scalar field must not silently stand in for it.
