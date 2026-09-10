# Batch Workbook Upload And Experiment Linking Plan

Status: active (Milestone 1 complete, Milestones 2-6 proposed)
Read when: implementing multi-file upload, reusable region extraction
templates, formula-aware region understanding, or batch series publication.
Created: 2026-09-09

## Goal

Let a user upload many per-experiment workbooks at once (for example
`Calculation Exp31.xlsx` ... `Calculation Exp40.xlsx`), teach LabRat once
which region inside that workbook layout holds a wanted result, apply that
understanding deterministically to every other file with the same layout, link
each file to its Experiment Browser identity, and publish the extracted series
so cross-experiment charts can use them.

```text
select many files
  -> one FileObject + SourceDocument + WorkbookReviewSession per file
  -> user selects the wanted region in ONE file
  -> formula-aware region interpretation (draft) -> user confirms
  -> save confirmed region as a RegionExtractionTemplate
  -> deterministic template match across the other files
  -> exact matches: prefilled regions, confirmed in one click
  -> non-matches: short per-file review list
  -> one Experiment Browser analysis publish across all matched regions
  -> one series per experiment on its existing identity
  -> cross-experiment chart (natural-language or series template)
```

This is roadmap item 7, "Relationship And Series Understanding", made
concrete. It is the ingest-side twin of the reusable chart template: define
once, apply deterministically, send ambiguity back to the user.

## Confirmed Product Decisions

1. **Cached formula values are the numbers.** LabRat reads the value Excel last
   calculated for a formula cell. It does not re-evaluate formulas. When a
   template expects a formula and finds a typed constant, the value is still
   read but the region carries a `formula_chain_broken` warning that the user
   must see before confirming. Decided 2026-09-09.
2. **Exact template matches are confirmed in one click.** A batch confirmation
   list replaces one-at-a-time confirmation for regions the matcher verified
   as structurally identical to an already-confirmed region. Each region still
   receives its own accepted revision pointer, decision actor, and audit event.
   Regions that did not match exactly are excluded from the list and reviewed
   individually. Decided 2026-09-09.
3. Upload still publishes nothing. Batch upload creates evidence and pending
   regions only. Series enter Experiment Browser only through the existing
   reviewed Experiment Browser analysis publish.
4. A RegionExtractionTemplate is a structured, versioned contract anchored on
   workbook structure and formula shape. It is not a stored prompt and not an
   A1 address.
5. Linking a workbook to an experiment identity is an explicit reviewed
   decision. Filename and in-sheet label are suggestions that prefill the
   existing create/reuse identity decision; they never bind silently.
6. One workbook layout family maps to one template. A workbook that matches no
   template falls back to today's per-file interpretation and may become a new
   template afterwards.

## Evidence From The Sample Workbooks

`Calculation Exp31.xlsx` and `Calculation Exp32.xlsx` share one layout:

- A filled `Sheet1` and a blank `LDPE TEMPLATE` sheet. The `Sheet1` layouts
  are cell-for-cell identical across the two files.
- Roughly half the cells are formulas (Exp31: 758 values, 706 formulas).
- The carbon distribution result is the `Overall tots` row, `P31:BA32`:
  headers C1...C37 in row 31, values in row 32. Each value is
  `gas yield + liquid yield` for that carbon number divided by total feed
  carbon (`B12`) times 100. The unit, "% of feed carbon", is only visible by
  following the formulas.
- Each sheet contains two calculation blocks (rows 1-35 and rows 38-72). In
  Exp31 the second block has typed constants where the first block has
  formulas, and its C1 value is 8.95 versus 0.52. Which block is real is a
  human decision.
- Header text is fragile: `P31` reads `Overal+P31:AO32l tots`, `W65` reads
  `C10+AN6W65:AW66`, and row 3 repeats `i-C6`. Matching must rely on the
  surrounding structure, not one label.
- The experiment label is in `A2` (`Exp31`, `Exp32`), and conditions live in a
  vertical label/value/unit block (`A4:C24`).

The workbook index already stores formula text beside each cached value
(`backend/src/saas/sourceDocuments.js`), and region interpretation already
receives formulas with the selected cells. Nothing new needs to be indexed;
the formulas need to be used.

## Ownership Boundary

Frontend work (this repository's `src/**`) and backend work
(`backend/**`) are listed separately in every milestone. Backend items are
proposals for the backend owner; the frontend does not modify `backend/**`.

## Canonical Concepts

### Formula-graph cell classification

Computed deterministically on the backend from the stored formula text of one
sheet, without evaluating anything:

| class | rule | Exp31 example |
| --- | --- | --- |
| `input` | no formula, referenced by at least one formula | `A11` polymer mass, GC areas |
| `constant` | no formula, referenced by nothing | notes, headers, typed-over results |
| `intermediate` | has a formula, referenced by another formula | row 26 carbon mol, row 27 isomer yield |
| `terminal` | has a formula, referenced by nothing | row 32 `Overall tots`, `F18` conversion |

Region interpretation receives the class of every selected cell plus a
bounded, human-readable derivation for terminals (formula text with the
labels of the cells it references, one level deep, capped in length). The
interpreter must prefer `terminal` cells when proposing result regions and must
add a warning when a selected result region is mostly `intermediate` or
`input`.

### RegionUnderstandingRevision additions

Additive optional fields on the existing immutable revision:

```json
{
  "provenanceMeaning": {
    "cellClassSummary": { "terminal": 37, "intermediate": 0, "input": 0, "constant": 1 },
    "derivation": "Each value = gas yield (row 14) + liquid yield (row 29) for that carbon number, both already divided by total feed carbon B12 x 100.",
    "normalizationCell": "B12",
    "warnings": ["formula_chain_broken"]
  },
  "seriesPatches": [
    {
      "seriesKey": "carbon_distribution",
      "label": "Overall carbon distribution",
      "orientation": "header_row_categories",
      "xHeaderRange": "Q31:BA31",
      "yValueRange": "Q32:BA32",
      "xMeaning": "carbon_number",
      "xValueType": "number",
      "yUnit": "% of feed carbon",
      "yNumericScale": "percent_points"
    }
  ]
}
```

`seriesPatches` extends the existing `fieldPatches` idea to header-row
category series, which the current column-pair `series` shape does not cover.

### RegionExtractionTemplate

A project-owned container with immutable versions, mirroring
ReusableChartTemplate:

```json
{
  "schemaVersion": "labrat.regionExtractionTemplate.v1",
  "name": "Carbon distribution from LDPE calculation sheet",
  "sourceRegionRevisionId": "region_understanding_revision_1",
  "layoutSignature": {
    "sheetNamePattern": "^Sheet1$",
    "companionSheets": ["LDPE TEMPLATE"],
    "anchors": [
      { "kind": "label", "text": "Total C (liq)", "offset": { "rows": -3, "cols": 0 }, "fuzzy": true },
      { "kind": "header_run", "pattern": "C(\\d+)", "expectedCount": 37, "offset": { "rows": 0, "cols": 1 } }
    ],
    "blockChoice": { "description": "first calculation block", "anchorRowRange": [1, 35] }
  },
  "cellExpectations": [
    { "relative": { "row": 1, "col": 1 }, "expectFormula": true, "formulaShape": "=R[-18]C[-11]" },
    { "relative": { "row": 1, "col": 4 }, "expectFormula": true, "formulaShape": "=R[-18]C[-11]+R[-3]C" }
  ],
  "experimentLabel": { "kind": "cell", "sheetRelative": "A2", "fallback": "filename_regex", "regex": "Exp\\s*0*(\\d+)" },
  "semantics": { "semanticType": "component_distribution", "experimentAxis": "region", "seriesPatches": [ "... copied from the confirmed revision ..." ] }
}
```

Formula shapes are stored in relative R1C1 form so the same template matches a
block found at an offset. Anchors use fuzzy label matching (normalized, edit
distance bounded) plus a header-run pattern so the corrupted `P31` label does
not break the match.

### Template match report

One row per (template, source document):

| status | meaning | next step |
| --- | --- | --- |
| `exact` | anchors found at the expected place, every cell expectation satisfied, experiment label found | prefilled region, eligible for one-click confirm |
| `shifted` | anchors found at a different row/column offset, expectations satisfied there | prefilled region, eligible for one-click confirm, offset shown |
| `formula_mismatch` | expected formula, found typed constant (or the reverse) | individual review with `formula_chain_broken` warning |
| `header_mismatch` | header run count or pattern differs | individual review |
| `label_missing` | experiment label cell empty and filename regex failed | individual review, user picks identity |
| `no_match` | anchors not found | falls back to normal interpretation |
| `ambiguous` | more than one candidate block satisfies the anchors | user picks the block |

Prefilled regions are created with `selectionMethod: "template_match"`,
`reviewStatus: "prefilled"`, and a first revision copied from the template
semantics with `trigger: "template_match"` and no provider call.

## API Additions (backend proposals)

Region and session routes stay as they are. New routes:

```text
POST /api/projects/:projectId/files/batch
  multipart, many "files" parts, per-file result array (fileObject, reused),
  optional: create sessions in the same request.
  Fallback: the frontend loops the existing single-file routes.

GET  /api/source-documents/:id/cell-classes?sheetName=&range=
  formula-graph classes and bounded derivations for a range.

POST /api/projects/:projectId/region-extraction-templates
GET  /api/projects/:projectId/region-extraction-templates
GET  /api/region-extraction-templates/:id
POST /api/region-extraction-templates/:id/versions
POST /api/region-extraction-templates/:id/archive

POST /api/region-extraction-template-versions/:id/matches
  body: { sourceDocumentIds: [] } -> match report, no side effects.

POST /api/region-extraction-template-versions/:id/apply
  Idempotency-Key required.
  body: { sourceDocumentIds: [], onlyStatuses: ["exact","shifted"] }
  -> creates sessions where missing, prefilled regions, prefilled revisions.

POST /api/projects/:projectId/workbook-review-regions/confirm-batch
  body: { items: [{ sessionId, regionId, revisionId, expectedRegionVersion }] }
  -> per-item result, one audit event per region plus one batch event.
  Only regions whose current revision has trigger "template_match" and
  status exact/shifted are accepted; anything else returns
  "batch_confirm_requires_individual_review".
```

The Experiment Browser analysis planner needs two small additions: accept
`seriesPatches` header-row category series when materializing a region, and
prefill identity decisions from the region's resolved experiment label.

## Milestones

### Milestone 1 — Batch upload (frontend only)

Status: complete on 2026-09-09 (branch `codex/batch-workbook-linking`)

- `multiple` on the LabRat chat attach input in `src/main.jsx`. The guided
  onboarding upload in `src/components/ProjectOnboarding.jsx` stays
  single-file on purpose: that flow tracks one master-table session through
  region review, and a batch there has no next step yet.
- One attachment is uploaded exactly as before. Two or more attachments run
  through `src/data/workbookBatchUpload.js`: concurrency 2 over the existing
  upload plus session-create calls, per-file status, failure isolation, and
  retry of failed files only while the File objects are still in memory.
- One batch card per upload in chat (`WorkbookBatchCard`) lists each file
  with status, region count, an opener for its Workbook Review session, and a
  suggested experiment parsed from the filename (`Exp\s*0*(\d+)`) and matched
  against Experiment Browser labels. Suggestions are display only.
- `useWorkbookRegionInterpretationQueue` accepts `backgroundSessions`; the
  active session fills free slots first and every batch session shares the
  same three-request limit. The card shows `Understanding regions n/m` per
  file. Background tasks survive switching the active workbook, and a batch
  session that becomes active hands its running tasks to the active view.
- The Overview `Workbook review` card has a direct `Upload workbooks`
  entrance (primary when nothing is uploaded yet, secondary beside the review
  action otherwise). It opens the same multi-file picker; the selected files
  are handed to LabRat chat, which posts the batch card and runs the upload
  without a typed message.
- A batch never navigates away from chat and never publishes anything.
- Tests: helper unit tests, queue hook tests, and an AgentPanel test covering
  multi-select, partial failure, suggestions, retry, batch callback, and
  history storage without File objects.

Done when ten files upload from one picker, each gets a session and chat
link, and their regions interpret in the background.

### Milestone 2 — Formula-aware region understanding (backend + frontend)

Backend:

- Formula-graph classification service over the stored index; cell-classes
  route; bounded derivation text.
- Pass cell classes and derivations into region interpretation; extend the
  interpretation schema with `provenanceMeaning` and `seriesPatches`; add the
  terminal-preference and intermediate/input warnings to validation.
- `formula_chain_broken` warning when a referenced formula cell in the
  selected range is a typed constant.

Frontend:

- Region card shows derivation text, cell-class summary, and warnings; a
  "Show calculation" toggle overlays classes on the grid (terminal, intermediate,
  input) for the selected range.
- Header-row series preview in the region card.

Done when selecting `P31:BA32` in Exp31 yields a draft that names the series,
the carbon-number axis, the "% of feed carbon" unit, and the derivation, and
selecting row 26 instead yields an intermediate warning.

### Milestone 3 — Extraction template save and match (backend + frontend)

Backend:

- Template container/version tables, memory/Postgres parity, lifecycle
  routes, audit, authorization (editor creates, viewer reads).
- Signature compiler from one accepted revision: anchors, header runs,
  relative formula shapes, block choice, experiment-label rule.
- Deterministic matcher and the match report route (no side effects).

Frontend:

- "Save as extraction template" on a confirmed region, with inline naming
  and a summary of what the signature will check.
- Template picker on the batch card: choose template, run match, show the
  per-file report table with status, offset, and warnings.

Done when the Exp31 template reports `exact` for Exp32 and `formula_mismatch`
or `ambiguous` for a file whose first block was overwritten by constants.

### Milestone 4 — Apply and one-click confirm (backend + frontend)

Backend:

- Idempotent apply route creating prefilled regions and revisions.
- Batch confirm route with per-region validation, version checks, and audit.

Frontend:

- Apply from the report; checklist of `exact`/`shifted` regions with
  select-all; one "Confirm selected" action; per-row result and retry.
- Non-matching files link into the existing Workbook Review for individual
  work; "Update template" creates a new version from a corrected region.

Done when thirty matched files are confirmed in one action and each region
shows its own accepted revision and actor.

### Milestone 5 — Batch publish to Experiment Browser (backend + frontend)

Backend:

- Planner accepts header-row category series from `seriesPatches`.
- Identity decisions prefilled from resolved experiment labels; the planner
  may draft one plan over up to 64 template-matched regions.
- Optional deterministic `template_series_attach` strategy (no Python, no
  provider) when every selected region carries the same template version,
  mirroring `direct_source_mapping`.

Frontend:

- "Publish matched series to Browser" action on the batch card, opening the
  existing analysis review with selections and identity decisions prefilled;
  bulk "accept exact matches" already exists in
  `src/data/identityDecisionBatch.js`.

Done when one publish adds a `carbon_distribution` series to Exp31...Exp40,
advancing only those heads, with each point carrying its source cell.

### Milestone 6 — Cross-experiment charts from series (backend + frontend)

Backend:

- Lift the fail-closed rule in `reusableChartTemplates.js` for a single
  series slot so an accepted carbon-distribution chart can be saved as a
  template.

Frontend:

- Template picker already supports slots; verify series slot coverage
  display and missing-experiment reporting.

Done when "compare carbon distribution for Exp10-Exp40" is a template pick
plus experiment selection with no provider call.

## Verification Matrix

- Two identical-layout files: `exact` match, one-click confirm, one publish,
  two series.
- File with the first block overwritten by constants: `formula_mismatch` and
  `formula_chain_broken`; not confirmable in batch.
- File with the block shifted by inserted rows: `shifted` with offset.
- File with 36 carbon headers: `header_mismatch`.
- File whose `A2` is empty and whose filename has no experiment number:
  `label_missing`, identity chosen by the user.
- Corrupted `P31` label: still `exact` through fuzzy anchor plus header run.
- Duplicate filename with different checksum: two independent sessions.
- Stale region version during batch confirm: that row fails with 409, the
  rest succeed.
- Viewer role cannot save templates, apply, or batch confirm.
- Reload during a batch: progress and links restore from server state.

## Risks

- **Two blocks per sheet.** The template pins one block; the matcher reports
  `ambiguous` when both blocks satisfy the anchors and differ in values.
- **Silent stale cached values.** A workbook saved with manual calculation
  may store outdated results. Out of scope for v1; the derivation text at
  least shows what the value claims to be.
- **Template drift.** A lab edits its calculation sheet; matches degrade to
  `formula_mismatch`. "Update template" from one corrected file creates a new
  version and re-matches the batch.
- **Provider cost.** Only the first file and non-matching files call the
  model. Exact matches make no provider call.
- **Review rule.** Batch confirm is limited to template-verified exact or
  shifted matches, keeping the per-region accepted-revision pointer and audit
  trail intact.

## Out Of Scope

- Re-evaluating Excel formulas in LabRat.
- Cross-workbook external references.
- Automatic publication on upload.
- Merging experiment identities without an explicit decision.
