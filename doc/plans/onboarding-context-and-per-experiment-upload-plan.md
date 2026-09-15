# Onboarding Context Questions And Per-Experiment Workbook Upload Plan

Status: proposed
Read when: changing the pristine-project onboarding conversation, its context
questions, or how additional workbooks are uploaded during onboarding.
Created: 2026-09-14

## Goal

A first-time user should finish onboarding with everything uploaded: the
master table published to the Experiment Browser, and every per-experiment
workbook linked to its experiment. LabRat gives the guidance for each upload
inside the onboarding conversation. The user never leaves onboarding to use
the Workbook Review tab or the chat panel.

```text
welcome -> project stage -> master table? -> upload master table
  -> confirm interpretations -> draft plan -> accept plan
  -> (context questions while the preview generates)
  -> result review -> publish
  -> "Do you have other workbooks to upload?"
       -> per-experiment workbooks: pick all files of one layout
            -> teach on one file (draw box, confirm, save template)
            -> match + apply to the rest -> one-click confirm with links
            -> non-matches: manual box or skip
            -> "another result from the same files, or a different set?"
       -> another master table: repeat the master-table round
       -> no: finish choices (open Browser / request correction / finish)
```

## Confirmed Product Decisions

1. Context questions are short, one per turn, with no example or placeholder
   text. Every question has a Skip chip. Skipping the first question of a
   chain skips the chain. Asked only in the first round. Decided 2026-09-14.
2. The composer appears only on steps that take free text. Decided 2026-09-14.
3. Additional workbooks are uploaded inside onboarding, not by handing off to
   the chat panel or the Workbook Review tab. Decided 2026-09-14.
4. No cap on the number of per-experiment files in a batch. AI interpretation
   is deferred until the template has been applied, which removes the cost
   that a cap would have guarded against. A per-file size limit is added
   instead. Decided 2026-09-14.
5. Per-experiment workbook data is linked, not published. The Experiment
   Browser shows a chip per experiment and charts read the confirmed regions
   directly. The master-table scalars keep using snapshots. This restates the
   2026-09-09 decision in the batch-linking plan.
6. Backend contracts do not change. Every step reuses existing routes.

## Context Questions

Workflow chain, asked after plan acceptance while the preview generates:

1. In one sentence, what is the focus of this project?
2. What does a typical experiment routine look like?
3. Which parameters do you measure, and which matter most?

Analysis chain, asked after the workflow chain:

4. Which instruments collect your data?
5. How do you turn the raw data into the values you report?

Behavior:

- LabRat asks the next question with a one-word acknowledgement, never a
  restatement of the answer.
- If the preview becomes ready mid-chain, LabRat finishes the current
  question, says "Your preview is ready", and shows the result review. The
  remaining questions are dropped, not resumed. Answers are display-only
  today, so nothing downstream depends on completeness.
- Stored as `contextAnswers` keyed by question id, plus `contextIndex`.

## Copy

Question after publication:

> Your experiments are in the Experiment Browser. Do you have other workbooks
> to upload?
>
> **Per-experiment workbooks**, one file per experiment, such as calculation
> sheets. I will learn where the result sits in one file, save that as a
> template, and apply it to every other file with the same layout. So upload
> all files that share a layout together, and name each file with its
> experiment number, for example `Calculation Exp31.xlsx`, so I can link it
> to the right experiment.
>
> **Another master table** with more experiments.
>
> **No, I'm done.**

After the files are picked:

> Uploading 40 files. I linked 38 to experiments from their file names; 2
> names have no experiment number and you can pick their experiment later.

Teaching step:

> Let's start with `Calculation Exp31.xlsx`. Draw a box around the result you
> want me to extract from every file.

After template save:

> Saved as "Reaction rate data". I'll look for this same block in the other
> 39 files.

After apply:

> 37 files match exactly. Review the list and confirm them in one click. 2
> files have a different layout; we'll handle those next.

Non-match step:

> `Calculation Exp15.xlsx` did not match. Draw the box by hand, update the
> template from it and re-match, or skip this file.

Repeat question:

> These files are linked. Do you want to extract another result from the
> same files, upload a different set of workbooks, or finish?

Closing note, shown once:

> Linked workbook data appears as a chip on each experiment and can be
> charted directly. It does not change the values in your master table.

Soft notice above 40 files:

> That's 60 files. Uploading will take a couple of minutes, and I'll link them
> all in one confirmation list.

## Milestone A — State shape and context questions (frontend)

- `src/data/projectOnboardingState.js`: bump `schemaVersion` to 4. Replace
  `experimentalWorkflow` and `dataAnalysisProcess` with `contextAnswers` and
  `contextIndex`. Add `workbookRounds` (completed rounds), `round` (current
  round descriptor), and `publishedCountAtRoundStart`. On read, map the two
  old strings into `contextAnswers` under the first question of each chain so
  saved sessions keep their answers.
- `src/components/ProjectOnboarding.jsx`: collapse the `workflow` and
  `analysis` steps into one `context` step driven by a `CONTEXT_QUESTIONS`
  constant. Composer placeholder is empty. Add a Skip chip beside the send
  button. Preview-ready interrupts after the current answer.
- Tests in `src/components/ProjectOnboarding.test.jsx`: one question at a
  time, Skip advances, first-question skip drops the chain, preview-ready
  interrupt, version 3 migration.

Done when a saved version 3 session loads with its answers and a fresh
session asks the five questions one at a time with no placeholder.

## Milestone B — Master-table rounds and the fixes a second round needs (frontend)

- New step `more_workbooks` with the three choices above. "Another master
  table" resets the per-round fields (workbook status, file name, session id,
  analysis thread, plan revision, run, result, generation status and error,
  correction) and returns to `upload`. Stage and master-table questions are
  not asked again. Completed rounds render as one compact bubble pair each.
- Publication watcher compares against `publishedCountAtRoundStart` instead
  of any published count.
- Region fallback filters `projectState.workbookReviewRegions` by the current
  session id.
- Plan request text is per round: "Use the confirmed regions in
  <workbook> to build reviewed Experiment Browser records." Stored in the
  round descriptor and passed to both `createOnboardingExperimentPlan` and
  `recoverOnboardingExperimentPlan` in `src/main.jsx`, so recovery matches
  the round's own thread and never reopens a completed one.
- Reset the plan-recovery-attempted ref and hydrated-session ref when a round
  starts.
- Progress map gains `context`, `more_workbooks`, and the per-experiment
  steps; the bar is per round.
- Tests: reset keeps answers and rounds, stage question not re-asked, watcher
  ignores round one's count, fallback shows only the current session,
  recovery receives the round's request text.

Done when two master tables publish in one onboarding session and the
transcript shows both rounds.

## Milestone C — Per-experiment batch inside onboarding (frontend)

Reuse, not rebuild. The pieces exist in `src/main.jsx` and `src/data/`:

- The spreadsheet grid with box drawing is `WorkbookReviewWorkspace`
  (`src/main.jsx`). Onboarding renders it as a wide block in the stream, the
  same way it renders the dock, and passes the region handlers it already
  receives plus `onCreateRegion` and the draft-region setters.
- "Save as template" and "Update template" are in the dock card
  (`src/components/WorkbookReviewDock.jsx`).
- `WorkbookBatchCard` (`src/main.jsx`) holds the file list, template match,
  apply, and the one-click confirm list with experiment pickers.
- `src/data/workbookBatchUpload.js` runs the uploads with concurrency 2,
  failure isolation, and retry.

Work:

1. Extract the batch orchestration (`runWorkbookBatch`,
   `applyWorkbookBatchTemplate`, batch confirm, retry, and the batch state)
   from the chat panel into a hook, `src/hooks/useWorkbookBatch.js`, so the
   chat panel and onboarding drive the same card with the same behavior.
2. Move `WorkbookBatchCard` and `WorkbookReviewWorkspace` out of
   `src/main.jsx` into `src/components/` so onboarding can import them
   without importing the root app. No behavior change.
3. Onboarding steps: `batch_pick` (multi-file picker, soft notice above 40),
   `batch_teach` (grid + dock for the first file; LabRat picks the first
   file, the user can switch), `batch_template` (name and save),
   `batch_apply` (match report and confirm list), `batch_leftovers`
   (non-matching files: open in grid, update template and re-match, or
   skip), `batch_repeat` (another result from the same files, a different
   set, or finish).
4. Deferred interpretation: in this path, the interpretation queue in
   `src/hooks/useWorkbookRegionInterpretationQueue.js` receives no
   background sessions until the template has been applied. The teaching
   file's user-drawn region is interpreted normally. Non-matching files are
   interpreted only when the user opens them.
5. Experiment linking: file names resolve through
   `suggestExperimentForFile`; exact single matches link automatically,
   others get the picker in the confirm list. The closing note states that
   nothing was published.
6. Tests: hook tests for the extracted orchestration (moved from the
   AgentPanel tests where they exist), onboarding tests for each step,
   deferred interpretation, non-match handling, and repeat on the same batch
   without re-upload.

Done when forty files of one layout upload from onboarding, one is taught,
the rest confirm in one click with correct links, two non-matching files are
handled by hand, and the Experiment Browser shows the chips, all without
leaving the onboarding page.

## Milestone D — Upload guards (backend + frontend)

- Per-file size limit on the upload route, about 25 MB, returning a clear
  error code. There is no body limit today. The frontend checks the size
  before upload and lists oversized files with the reason instead of
  attempting them.
- Soft notice above 40 files in the onboarding picker. Informational only.
- Tests: backend route test for the limit (in-memory store), frontend test for
  the pre-check and the notice.

Done when a 200 MB file is refused before upload with a readable message and
sixty small files proceed with the notice.

## Verification

- Milestones A, B, C: `npm test` and `npm run build`, plus a browser run
  against the local backend with two master tables and one batch of
  per-experiment files.
- Milestone D: `npm run codex:verify`, since it touches both sides.

## Risks

- Extracting `WorkbookReviewWorkspace` and `WorkbookBatchCard` from
  `src/main.jsx` is the largest mechanical change. Do it as its own commit
  with no behavior change so the diff is reviewable.
- If a per-experiment file's experiment label does not exist in the Browser,
  the region stays unlinked until the user picks. The confirm list must make
  the unresolved count visible before the one-click confirm.
- Reloading mid-batch: sessions and regions are server-side, but the batch
  File objects are not. The hook already supports retrying failed files only
  while the files are in memory; after a reload, LabRat lists the uploaded
  sessions and continues from apply.

## Milestone E — Formula-mismatch files and the apply-step exits (backend + frontend)

Status: proposed 2026-09-15

### The problem

A template taught on `Reaction_Rate_Exp29.xlsx` (formulas at A10, B10, ...)
matched `Exp32`, `Exp54`, and `Exp55` at the same range but reported
`formula_mismatch` because those files have typed numbers where the template
expects formulas. Three things then go wrong:

1. The apply route refuses anything but `exact` and `shifted`
   (`APPLY_ELIGIBLE_STATUSES` in `backend/src/saas/regionTemplateApplications.js`),
   so the template cannot be applied to those files at all.
2. A region confirmed by hand in one of those files receives no
   `linkedExperimentId` and no `dataKind`, because only template apply sets
   them. The file never gets its "reaction rate" chip.
3. The onboarding apply step says "0 files match. Apply the template, review
   the list, and confirm" and offers only Continue. The exits that exist,
   the leftovers step behind Continue and the template dropdown on the card,
   are not visible as exits.

Decision 1 of the batch-linking plan already states the intended behavior:
when a template expects a formula and finds a typed constant, the value is
still read and the region carries a `formula_chain_broken` warning that the
user must see before confirming. The apply path never implemented that.

### Part 1 — Apply with a warning (backend)

- `APPLY_ELIGIBLE_STATUSES` stays the one-click confirm rule (`exact`,
  `shifted`). Add `APPLY_PREFILL_STATUSES` = `exact`, `shifted`,
  `formula_mismatch`, and use it in `applyTemplateMatch` and in the apply
  route's `onlyStatuses` filter.
- For a `formula_mismatch` report, `applyTemplateMatch` prefills the region at
  `report.matchedRange` exactly as it does for an exact match. The revision
  already computes provenance, so `brokenCells` and the
  `formula_chain_broken` warning land on it without new code. Add one
  explicit warning `template_formula_mismatch` listing the report's
  `formulaMismatches` addresses so the user sees which cells were typed over
  even when provenance finds no upstream break.
- Resolve the experiment label for `formula_mismatch` reports too.
  `matchSheet` in `regionExtractionTemplates.js` currently resolves the label
  only for `exact` and `shifted`, so the link picker has nothing to prefill.
  Run `resolveExperimentLabel` for `formula_mismatch` as well; do not convert
  a missing label into `label_missing` for that status.
- `confirmTemplateRegionsBatch` keeps rejecting `formula_mismatch` regions
  with `batch_confirm_requires_individual_review`. They are confirmed one at
  a time through the ordinary confirm route, which already carries the
  region's warnings to the dock.
- `templateMatch.status` on the region records `formula_mismatch`, so the
  Experiment Browser chip and later charts can tell a typed-over region from a
  clean one if they ever need to.
- Tests in `regionTemplateApplications.test.js` and the route tests: apply
  creates a prefilled region with the warning for a formula-mismatch file,
  the region carries `linkedExperimentId` when the file name resolves, batch
  confirm rejects it, individual confirm accepts it.

No migration: regions, revisions, warnings, and `templateMatch` already have
the needed columns.

### Part 2 — Outcome-aware apply step (frontend)

In `src/components/ProjectOnboarding.jsx`, the apply step branches on the
match summary:

- **Some one-click matches.** As today: apply, confirm list, Continue. Add a
  secondary "Use a different template" action.
- **Only individual matches** (`formula_mismatch` with a matched range).
  Copy: "N files have typed numbers where the template expects formulas. I
  can still fill in the block; confirm each one after checking the typed
  cells." Actions: "Apply and review each file" (apply with the wider status
  list, then go to the leftovers step), "Use a different template", "Teach a
  new template on one file".
- **Nothing matched.** Copy explains that the layout was not found. Actions:
  "Review the files", "Use a different template", "Teach a new template on
  one file".
- **Always** a "Go back" link to the template choice step.

`useWorkbookBatchActions.applyTemplate` gains an `onlyStatuses` option so
onboarding can request the wider prefill set; the chat panel keeps the
default.

### Part 3 — Leftovers become an individual-confirm list (frontend)

- Rows that were prefilled but need individual confirmation show "Needs
  individual confirmation" with the typed-over cells, not "did not match".
- Opening a row shows the grid and dock for that file. The prefilled region
  is the active card, the dock's existing "Typed over formulas" line lists
  the cells, and its Confirm button performs the individual confirmation.
  After confirming, the row shows as confirmed and the count updates.
- Each row also offers "Teach a new template from this file", which makes
  that file the teaching source instead of always the first uploaded file.
- "Use a different template" appears here too.

### Part 4 — Card copy (frontend)

`WorkbookBatchCard` explains `formula_mismatch` in one line under the status:
"Typed numbers where the template expects formulas at A10, B10, C10. The
values are readable; confirm this file individually." Applies to the chat
panel as well as onboarding.

### Why this fixes it

- Part 1 removes the real dead end: the three files get prefilled regions
  carrying the experiment link and data kind, so after individual
  confirmation they show the chip and can be charted, which hand-drawn
  regions never could.
- Parts 2 and 3 give every outcome of a match at least two ways forward and a
  way back, and make the leftovers step the place where the individual
  confirmations happen, rather than a list of failures.
- Part 4 stops "formula mismatch" from reading as an error. It is a review
  requirement, which is what decision 1 intended.
- The one-click boundary is unchanged. Nothing typed-over is ever confirmed
  in bulk, and every confirmation still records its own accepted revision,
  actor, and audit event.

### Order and verification

1. Part 1 with backend tests (`npm --prefix backend test`).
2. Parts 2 to 4 with onboarding and card tests.
3. `npm run codex:verify`, then a browser run against the local backend with
   the Exp29, Exp32, Exp54, Exp55 files.

Also clear a stale `generationStatus` on load when the step is past
publication, so the "Generating preview" pill cannot persist from state
saved before the earlier fix.
