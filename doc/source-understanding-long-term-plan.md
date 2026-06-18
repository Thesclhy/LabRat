# Source Understanding Long-Term Architecture Plan

Status: reference architecture; superseded by `doc/plan.md` as the active execution plan  
Created: 2026-06-18  
Scope: source-aware workbook/document understanding, source retrieval, extraction proposals, and chart proposals  
Related docs: `doc/ARCHITECTURE.md`, `doc/ROADMAP.md`, `doc/plan.md`, `doc/saas-api-contract-v0.md`, `doc/saas-database-schema-v0.md`, `doc/backend-api-contract.md`, `doc/canonical-data-dictionary.md`, `doc/ai-boundaries.md`

## Summary

This document is retained as the detailed Source Workspace rationale and design reference. `doc/plan.md` is the current execution source of truth for the Agent-first evidence workflow; when the two documents differ, update `doc/plan.md` first and then reconcile this reference.

LabRat should grow from a dataset-first importer into a source-aware research workspace.

The current server workflow is strong once data has been normalized into reviewed `fields[]`, accepted mappings, dataset commits, chart proposals, and ChartSpecs. The weakness is before that point: if an uploaded workbook contains useful information in a semi-structured region that normalization did not capture, downstream chart intent sees only the reviewed dataset inventory and may ask for clarification even when the original file contains enough evidence.

The long-term fix is a persistent Source Workspace layer:

```text
raw file
  -> source document index
  -> detected source regions
  -> source retrieval tools
  -> extraction or chart proposal
  -> human review
  -> dataset commit and/or chart spec
```

This should let LabRat answer requests such as:

```text
use Overall tots row 69, plot the carbon number distribution of Exp30 as bar chart,
x-axis being C number, y-axis being percentage
```

without asking the user to choose from unrelated normalized fields, as long as the source workbook is available and the referenced range can be verified.

## Why This Is Needed

### Current behavior

The logged-in server workspace currently treats reviewed dataset commits as the main source of truth. Chart interpretation receives compact project context, accepted mappings, field inventories, prior chart decisions, and chart spec summaries. That is correct for audited chart creation, but it means chart intent is blind to workbook regions that were not promoted into the current generic import shape.

When a workbook has a row such as `Overall tots` with C1-C35 distribution values, LabRat may not see it as a chartable C-number distribution. It may only see generic fields such as selectivity, conversion, carbon balance, hydrogen fraction, or viscosity. The chart layer then asks for clarification because its field inventory does not contain a clear `carbon_number` x field and percentage y values.

### What Codex did differently

Codex could solve the Exp30 artifact request because it operated as a source-inspection agent:

- It opened the actual workbook.
- It searched the sheet layout.
- It inspected the row and nearby labels.
- It inferred that `Overall tots` plus C-number headers formed a distribution table.
- It generated a chart artifact with explicit source-cell references.

LabRat should not rely on a general-purpose coding agent to do that. The app needs the same class of capability inside its own auditable product workflow.

### Product principle

Do not make the AI guess harder. Give it better source tools, then keep every mutating step reviewable.

## Goals

- Make raw uploaded workbooks and documents queryable after upload.
- Preserve source evidence at cell, range, sheet, file, and formula levels.
- Detect source regions that may not fit the current normalized generic import model.
- Let chart interpretation use source hints such as row numbers, sheet names, labels, headers, and file names.
- Turn source-derived results into proposals, not silent commits.
- Keep provenance readable in the UI and stored in API payloads.
- Support C-number distribution as an early vertical use case without making the architecture C-number-only.
- Keep AI at the intent, ranking, explanation, and proposal layer; deterministic services should own parsing, validation, extraction, and persistence.

## Non-Goals

- Do not pass full raw workbooks blindly to an LLM.
- Do not allow arbitrary AI-generated code execution for extraction or charting.
- Do not auto-commit scientific values from raw source inspection.
- Do not replace the existing import review, mapping review, dataset commit, chart proposal, or ChartSpec workflows.
- Do not create old IndexedDB or `.labrat.json` compatibility migrations as part of this effort.
- Do not build a full MCP server first. MCP can wrap the internal source tools later, after the contracts are stable.

## Target Architecture

### New Layer: Source Workspace

The Source Workspace sits between file upload and reviewed dataset/chart outputs.

```text
File Object
  -> Source Document
  -> Source Regions
  -> Source Retrieval
  -> Source Extract Proposals
  -> Dataset Patch Proposals
  -> Chart From Source Proposals
  -> Reviewed Dataset Commit / ChartSpec
```

It should exist for master workbooks, supplemental workbooks, and eventually PDFs/CSV/plain tables. Excel should be first because the current backend scanner already preserves many of the needed primitives.

### Existing Flow With Source Workspace

```text
upload workbook
  -> create file object
  -> scan workbook
  -> persist import run
  -> persist source document index
  -> detect source regions
  -> user reviews normal import blocks
  -> user may also inspect source regions
  -> source-aware chart/data requests can retrieve ranges
  -> proposals cite exact source refs
```

This keeps the current import workflow intact while adding a parallel evidence layer for regions that are not yet normalized.

## Core Data Concepts

### Source Document

A persistent representation of one uploaded file's inspectable structure.

Draft shape:

```json
{
  "id": "source_doc_...",
  "projectId": "project_...",
  "fileObjectId": "file_...",
  "documentType": "excel_workbook",
  "sourceIndexVersion": "labrat.sourceIndex.v1",
  "status": "indexed",
  "metadata": {
    "fileName": "Calculation Exp30.xlsx",
    "size": 123456,
    "sha256": "...",
    "sheetCount": 3
  },
  "sheets": [
    {
      "sheetId": "sheet_1",
      "name": "Sheet1",
      "usedRange": "A1:AZ120",
      "rowCount": 120,
      "columnCount": 52,
      "regions": ["region_..."]
    }
  ],
  "createdAt": "2026-06-18T00:00:00.000Z",
  "updatedAt": "2026-06-18T00:00:00.000Z"
}
```

The Source Document should not be treated as a dataset commit. It is evidence about the uploaded file.

### Source Cell

The inspectable atomic evidence unit for spreadsheets.

Draft shape:

```json
{
  "sheetName": "Sheet1",
  "address": "Q69",
  "row": 69,
  "column": 17,
  "rawValue": 12.3,
  "formattedValue": "12.3%",
  "formula": null,
  "type": "number",
  "mergedRange": null,
  "styleHints": {
    "bold": false,
    "fillColor": null,
    "numberFormat": "0.0%"
  }
}
```

The first implementation can reuse the backend scanner's existing cell grid representation. Style hints can be partial and additive.

### Source Region

A detected meaningful area in a source document.

Draft shape:

```json
{
  "id": "region_...",
  "sourceDocumentId": "source_doc_...",
  "kind": "component_distribution",
  "label": "Overall tots C-number distribution",
  "sheetName": "Sheet1",
  "range": "Q68:AY69",
  "confidence": 0.92,
  "signals": [
    "row label matched Overall tots",
    "header row matched C1-C35 sequence",
    "numeric percentage-like values"
  ],
  "candidateFields": [
    {
      "fieldId": "virtual_carbon_number",
      "label": "C number",
      "semanticRole": "component",
      "valueType": "integer"
    },
    {
      "fieldId": "overall_tots_percent",
      "label": "Overall tots (%)",
      "semanticRole": "measurement",
      "unit": "%"
    }
  ],
  "sourceRefs": [
    {
      "fileObjectId": "file_...",
      "sheetName": "Sheet1",
      "range": "Q68:AY69"
    }
  ],
  "warnings": []
}
```

Region kinds should be controlled vocabulary, not arbitrary model prose.

Initial region kinds:

- `standard_table`
- `block_table`
- `key_value_summary`
- `reaction_rate_time_series`
- `component_distribution`
- `formula_summary`
- `calibration_table`
- `unknown_region`

### Source Extract Proposal

A reviewable proposal to turn a source region or range into structured rows.

Draft shape:

```json
{
  "id": "source_extract_proposal_...",
  "projectId": "project_...",
  "sourceDocumentId": "source_doc_...",
  "sourceRegionId": "region_...",
  "status": "proposed",
  "purpose": "chart_source",
  "extractType": "component_distribution",
  "preview": {
    "rows": [
      {
        "carbon_number": 1,
        "percentage": 0.2,
        "sourceRefs": [{"sheetName": "Sheet1", "cell": "Q69"}]
      }
    ],
    "fields": [
      {"fieldId": "carbon_number", "label": "C number", "valueType": "integer"},
      {"fieldId": "percentage", "label": "Percentage", "unit": "%", "valueType": "number"}
    ]
  },
  "warnings": [],
  "createdBy": "system_or_user",
  "createdAt": "2026-06-18T00:00:00.000Z"
}
```

Accepting this proposal should either:

- create a source-backed ChartSpec snapshot without changing the project dataset, or
- create a reviewed dataset patch and dataset commit first, then create a ChartSpec from that commit.

The recommended first product path is source-backed chart proposals for speed, with a clear UI badge that the chart is source-backed and not yet promoted into the main dataset. The later, stricter path can add "Promote to dataset commit".

### Chart From Source Proposal

A chart proposal generated from a source extract rather than from the current dataset field inventory.

Draft shape:

```json
{
  "id": "chart_source_proposal_...",
  "status": "proposed",
  "title": "Exp30 carbon number distribution",
  "chartType": "distribution_bar",
  "sourceExtractProposalId": "source_extract_proposal_...",
  "chartSpecDraft": {
    "version": "labrat.chartSpec.v1.3",
    "type": "distribution_bar",
    "x": {"fieldId": "carbon_number", "label": "C number"},
    "y": {"fieldId": "percentage", "label": "Percentage", "unit": "%"}
  },
  "sourceRefs": [
    {
      "fileObjectId": "file_...",
      "fileName": "Calculation Exp30.xlsx",
      "sheetName": "Sheet1",
      "range": "Q68:AY69"
    }
  ],
  "explanation": "Uses the Overall tots row as percentages and the C1-C35 header row as carbon numbers."
}
```

This can reuse the existing chart proposal review UI once proposal origin and source refs are supported.

## Source Detection Strategy

### Deterministic First

Source detection should begin with deterministic scanners and conservative heuristics:

- Used range, non-empty cells, formulas, merged cells, formatted values.
- Candidate header rows.
- Candidate key/value metadata.
- Blank-gap region grouping.
- Repeated headers and repeated experiment blocks.
- Numeric row/column profiles.
- Label and unit detection.
- Formula and format signals.

AI should rank, name, explain, or propose intent after these facts exist. It should not invent the facts.

### Region Detector Expansion

The existing backend scanner already has a strong base. Expand it with specialized detectors:

#### C-number / component distribution detector

Signals:

- Header sequence like `C1`, `C2`, `C3`, ... or columns named by carbon number.
- Nearby labels such as `Overall tots`, `overall total`, `carbon number`, `distribution`, `GC`, `selectivity`, `fraction`.
- Numeric row across component columns.
- Values are percentage-like, fraction-like, or sum to a plausible total.
- Source file or sheet names include calculation, GC, sweep, or experiment labels.

Output:

- `kind: "component_distribution"`
- virtual x field `carbon_number`
- y fields from the selected row label
- source range including header row and value row
- warnings if values do not sum to an expected range

#### Reaction rate time-series detector

Already partially represented by supplemental workbooks. Extend with:

- time column aliases
- rate/concentration columns
- experiment label from file/sheet/metadata
- units and log-scale hints

#### Formula summary detector

Signals:

- Formula cells next to labels.
- Summary labels such as conversion, yield, carbon balance, selectivity, viscosity.
- Links to upstream source cells.

Output:

- source refs for formula cell and precedent cells where feasible
- warning if formula cannot be traced

#### Calibration table detector

Signals:

- compound/component names
- response factor, area, concentration, slope/intercept
- standard curve labels

Output:

- candidate calibration methodology records, not immediate dataset values

### Unknown Region Preservation

When LabRat cannot classify a region, it should still preserve an `unknown_region` with:

- range
- candidate labels
- numeric/text profile
- source refs
- warnings

This gives the AI and user something inspectable instead of losing the evidence.

## Source Retrieval Tools

Build internal backend services first. MCP can wrap them later.

### Required service operations

`listSourceDocuments(projectId)`

- Returns indexed source documents for a project.

`listSourceRegions(sourceDocumentId, filters)`

- Returns detected regions, confidence, kinds, labels, ranges, and warnings.

`findSourceText(projectId, query)`

- Searches sheet names, cell values, labels, region labels, file names, and source refs.
- Example query: `Overall tots`.

`readSourceRange(sourceDocumentId, sheetName, range)`

- Returns a bounded rectangular range with raw values, formatted values, formulas, and addresses.

`inspectSourceCell(sourceDocumentId, sheetName, address)`

- Returns one cell plus nearby row/column context.

`traceFormula(sourceDocumentId, sheetName, address)`

- Returns formula text and available precedent/dependent refs.
- This can be shallow in v1.

`proposeSourceExtract(projectId, sourceRegionId, intent)`

- Creates a preview-only source extract proposal.

`proposeChartFromSource(projectId, sourceExtractProposalId, chartIntent)`

- Creates a chart proposal that can be accepted/rejected through the existing chart review flow.

### Tool Safety

- Enforce lab/project/file authorization server-side.
- Cap range reads by cell count.
- Never return an entire workbook to an AI call by default.
- Log source-query and source-proposal creation as audit events when they affect reviewed workflows.
- Keep raw binary file access separate from compact source index reads.

## Agent Behavior

### Current chart interpretation limitation

The current chart intent layer should continue to use compact project and field context for ordinary dataset-backed charts. That is still the correct default.

### Source-aware chart interpretation

When a prompt includes source hints, the agent should switch to a source-aware path:

Source hints include:

- row or column references: `row 69`, `column Q`, `Q68:AY69`
- sheet references: `Sheet1`, `Overall tots sheet`
- file references: `Calculation Exp30.xlsx`, `Exp30`
- table labels: `Overall tots`, `carbon number distribution`
- component sequences: `C1-C35`, `C number`
- raw-file wording: `from workbook`, `from the calculation file`, `use the row`

Source-aware flow:

1. Parse source hints from the prompt.
2. Search indexed source documents by file, experiment label, sheet, and text.
3. Read small candidate ranges.
4. Verify region shape and units with deterministic rules.
5. Create a source extract proposal.
6. Create a chart proposal from the extract.
7. Ask clarification only if multiple plausible source regions remain or if the requested source cannot be found.

### Clarification Policy

The agent should ask clarification when:

- no matching source document is indexed
- multiple regions match with similar confidence
- the requested row/range exists but does not form a valid extract
- units are ambiguous and would change the chart meaning
- source values look inconsistent or incomplete

The agent should not ask clarification when:

- the prompt contains a unique file/sheet/range/label combination
- deterministic extraction validates the shape
- the only uncertainty is display naming that can be reviewed in the proposal

## UI Plan

### Source Explorer

Add a compact Source Explorer inside project workspace, not a marketing-style page.

Primary surfaces:

- Project Overview: source document count and warnings.
- Import Review: source regions detected during scan.
- Experiment Browser detail: source refs can open the source range.
- Review Chart Proposals: source-backed proposal preview and provenance.
- Assistant action cards: "Inspect source", "Draft source extract", "Draft chart proposal".

Source Explorer layout:

```text
left: source documents and sheets
middle: region list / search results
right: range preview and extraction preview
```

Keep it dense:

- table-like range preview
- small badges for region kind/confidence/status
- source refs visible near values
- warnings in a distinct but compact state

### Region Cards

Each detected region should show:

- label
- kind
- sheet and range
- confidence
- source file
- detected fields
- warnings
- actions: `Preview extract`, `Use for chart`, `Ignore`

### Source-backed Chart Review

Review Chart Proposals should support:

- proposal origin: `dataset`, `source`, or `agent_source`
- source range citation
- extracted preview rows
- chart preview
- accept/reject/create ChartSpec

If a source-backed chart is not dataset-committed, show a clear status:

```text
Source-backed chart
Uses reviewed source range snapshot. Not promoted to dataset commit.
```

Later, add:

```text
Promote extract to dataset commit
```

### C-number Distribution UX

For the Exp30-style case:

- show source file: `Calculation Exp30.xlsx`
- show sheet/range: `Sheet1!Q68:AY69`
- show detected header row: `C1-C35`
- show selected value row: `Overall tots`
- show chart preview
- allow accept/reject/create ChartSpec
- preserve cell refs per bar

## Backend Data Model

### Suggested Postgres tables

`source_documents`

- `id`
- `project_id`
- `file_object_id`
- `document_type`
- `index_version`
- `status`
- `metadata jsonb`
- `summary jsonb`
- `created_at`
- `updated_at`

`source_regions`

- `id`
- `source_document_id`
- `project_id`
- `kind`
- `label`
- `sheet_name`
- `range_ref`
- `confidence`
- `signals jsonb`
- `candidate_fields jsonb`
- `source_refs jsonb`
- `warnings jsonb`
- `status`
- `created_at`
- `updated_at`

`source_index_blobs`

- `id`
- `source_document_id`
- `blob_kind`
- `storage_uri` or `payload jsonb`
- `sha256`
- `created_at`

Use this for large cell grids so normal project state payloads stay compact.

`source_extract_proposals`

- `id`
- `project_id`
- `source_document_id`
- `source_region_id`
- `dataset_commit_id nullable`
- `status`
- `purpose`
- `extract_type`
- `intent jsonb`
- `preview jsonb`
- `warnings jsonb`
- `decision jsonb`
- `created_by`
- `created_at`
- `updated_at`

### Memory store parity

Every new persistent concept needs Memory store support and Postgres support in the same change set. Optional Postgres tests can remain gated by `LABRAT_TEST_DATABASE_URL`, but route tests should cover Memory behavior.

## API Contract Draft

Project-scoped endpoints:

```text
POST /api/projects/:projectId/files/:fileObjectId/source-index
GET  /api/projects/:projectId/source-documents
GET  /api/projects/:projectId/source-regions
GET  /api/source-documents/:sourceDocumentId
GET  /api/source-documents/:sourceDocumentId/regions
POST /api/source-documents/:sourceDocumentId/query
POST /api/source-documents/:sourceDocumentId/range
POST /api/source-regions/:sourceRegionId/extract-preview
POST /api/projects/:projectId/source-extract-proposals
PATCH /api/source-extract-proposals/:proposalId
POST /api/projects/:projectId/charts/from-source
```

All endpoints must enforce project membership and role permissions.

Recommended role rules:

- viewer can read source documents, regions, and proposal previews
- editor can create source extract proposals and chart proposals
- owner/admin can manage source indexing jobs and future retention settings

Mutating proposal decisions should write audit events:

- `source.index`
- `source.region.detect`
- `source.extract.propose`
- `source.extract.accept`
- `source.extract.reject`
- `chart.source_propose`
- `chart.source_accept`
- `chart.source_spec_create`

## ChartSpec Integration

### Preferred v1 path

Allow source-backed ChartSpecs only after proposal acceptance.

ChartSpec additions should be additive:

```json
{
  "origin": "source_extract",
  "sourceExtractProposalId": "source_extract_proposal_...",
  "sourceRefs": [
    {
      "fileObjectId": "file_...",
      "sheetName": "Sheet1",
      "range": "Q68:AY69"
    }
  ],
  "sourceSnapshot": {
    "fields": [],
    "rows": []
  }
}
```

The renderer should use the immutable source snapshot, not reread a mutable workbook.

### Later stricter path

Add "Promote to dataset commit":

```text
source extract proposal
  -> reviewed dataset patch
  -> new dataset commit
  -> dataset-backed ChartSpec
```

This is better for canonical project data but slower for quick charting. Both should preserve provenance.

## Interaction With MCP

MCP is not the first architectural step.

The right sequence is:

1. Build internal source indexing, region, range, extraction, and proposal APIs.
2. Use those APIs from LabRat's own UI and server-side agent planner.
3. Once stable, expose a narrow MCP server that wraps the same APIs for external agents.

This avoids making MCP the source of truth. MCP becomes a controlled adapter, not the architecture.

Potential MCP tools later:

- `labrat.list_source_documents`
- `labrat.find_source_text`
- `labrat.read_source_range`
- `labrat.propose_source_extract`
- `labrat.propose_chart_from_source`

## Phased Implementation Plan

### Phase 0: Contract and Fixtures

Goal: define the smallest source-aware contract and test data.

Tasks:

- Add source document, source region, and source extract proposal docs to `doc/saas-api-contract-v0.md`.
- Add schema draft to `doc/saas-database-schema-v0.md`.
- Add C-number distribution to `doc/canonical-data-dictionary.md`.
- Create synthetic workbook fixtures for:
  - C-number distribution with `Overall tots`
  - multiple candidate distribution rows
  - missing C-number headers
  - formula-backed summary row
- Add private real-workbook smoke guidance without committing private files.

Acceptance:

- Contracts describe no silent dataset mutation.
- Test fixtures can validate region detection without private data.

### Phase 1: Persist Source Document Index

Goal: store source indexing output for uploaded workbooks.

Tasks:

- Reuse backend workbook scanner output.
- Persist source documents when project file scans/import runs are created.
- Keep large cell grids out of `GET /api/projects/:projectId/state` by default.
- Add range read API with cell count caps.
- Add Memory and Postgres store support.

Tests:

- source document created for uploaded workbook
- viewer can read, editor can read
- cross-lab access denied
- large range read rejected with clear error
- source document persists file name, sheet names, used ranges, formatted values

Acceptance:

- A user can upload a workbook and later inspect sheet/range metadata without rerunning the upload.

### Phase 2: Region Detection Persistence

Goal: persist and review detected source regions.

Tasks:

- Persist existing standard/block/unknown regions as `source_regions`.
- Add first `component_distribution` detector.
- Emit conservative confidence and warnings.
- Keep region status separate from import block approval.

Tests:

- C1-C35 header plus `Overall tots` row becomes `component_distribution`
- unrelated numeric rows do not become component distributions
- ambiguous multiple rows produce multiple regions with warnings
- unknown regions remain available

Acceptance:

- Exp30-style distribution source appears as a region with exact range refs.

### Phase 3: Source Explorer UI

Goal: make source evidence visible.

Tasks:

- Add source document list and region list in a compact modal or workspace panel.
- Add range preview with raw/formatted values and formulas.
- Link source refs from Import Review, Browser detail, and Chart Review.
- Add empty/loading/error states.

Tests:

- project with indexed workbook shows source docs and regions
- source range preview renders formatted values
- source refs open the correct source range
- narrow viewport does not overflow

Acceptance:

- A user can verify where an extracted value came from without leaving LabRat.

### Phase 4: Source Extract Proposals

Goal: turn source regions into reviewable structured previews.

Tasks:

- Add `source_extract_proposals` store and routes.
- Add deterministic extractors for `component_distribution`.
- Preview extracted rows and source refs.
- Allow accept/reject decisions without dataset mutation.

Tests:

- C-number region extracts `carbon_number` and `percentage`
- cell-level source refs survive extraction
- reject does not mutate dataset or chart specs
- accepted extract remains readable after reload

Acceptance:

- The user can review the table that would feed the chart before creating a chart.

### Phase 5: Source-aware Chart Review

Goal: create chart proposals from source extracts.

Tasks:

- Add `charts/from-source` route or extend chart proposal origin.
- Reuse existing Review Chart Proposals UI.
- Add source-backed proposal badges and range citations.
- Create immutable source-backed ChartSpecs after accepted proposal.

Tests:

- accepted source proposal creates ChartSpec with source snapshot
- rejected proposal cannot create ChartSpec
- chart preview uses source snapshot
- manuscript insertion works from source-backed ChartSpec

Acceptance:

- Exp30 C-number prompt can create a reviewable chart proposal and ChartSpec without normalizing the whole row into the main dataset first.

### Phase 6: Source-aware Agent Planner

Goal: let natural-language requests call source tools.

Tasks:

- Extend the server agent planner with source-hint detection.
- Add deterministic source search and range-read steps.
- Return action cards for source extract and chart proposal creation.
- Ask clarification only when source candidates are ambiguous.

Tests:

- prompt with `Overall tots row 69` resolves to the correct range
- prompt with only `carbon number distribution` lists candidate regions
- nonexistent row/file asks useful clarification
- cross-project source files cannot be queried

Acceptance:

- The original Exp30 request no longer asks for unrelated measurement-field clarification when the indexed source is available.

### Phase 7: Dataset Promotion and Methodology Link

Goal: connect source extracts to canonical dataset history when needed.

Tasks:

- Add "Promote extract to dataset commit" flow.
- Let accepted source extracts become dataset patch proposals.
- Tie formula-backed extracts to methodology versions where appropriate.
- Show source-derived dataset fields in Browser after promotion.

Tests:

- promotion creates a new dataset commit
- parent commit remains immutable
- promoted fields retain source refs
- stale chart behavior is clear after later refresh

Acceptance:

- Source-derived values can become canonical project data through review.

### Phase 8: Hardening, Performance, and Retention

Goal: make source understanding safe at scale.

Tasks:

- Add source index size limits and paging.
- Move large source index blobs to local object storage or cloud object storage.
- Add retention/admin controls.
- Add audit UI for source queries and source-derived decisions.
- Add background job support for large workbooks.

Tests:

- large workbook indexing does not block request loop indefinitely
- range reads are bounded
- deleted project soft-delete behavior hides source docs from default lists
- audit events are searchable

Acceptance:

- Large real lab workbooks are usable without bloating project state responses.

## Acceptance Scenario: Exp30 Carbon Distribution

Given:

- A project has `Calculation Exp30.xlsx` uploaded or attached as a supplemental/source file.
- The workbook has `Overall tots` at row 69 and C-number headers above it.
- The source index has been created.

When the user asks:

```text
use Overall tots row 69, plot the carbon number distribution of exp30 as bar chart,
x-axis being C number, y-axis being percentage
```

Then LabRat should:

1. Find the workbook matching `Exp30` and/or `Calculation Exp30.xlsx`.
2. Search for `Overall tots`.
3. Read the bounded range around row 69.
4. Validate C-number headers.
5. Create a source extract preview with `carbon_number` and `percentage`.
6. Create a chart proposal with source refs.
7. Show the user a chart preview and source range citation.
8. Allow Accept, Reject, and Create ChartSpec through the existing review flow.
9. Avoid asking the user to pick from unrelated fields such as viscosity or carbon balance.

## Risks

- Source indexing can become too large if every cell is stored inline in project state.
- AI may over-trust weak region labels unless deterministic confidence and warnings are visible.
- Source-backed ChartSpecs can confuse users if they look identical to dataset-backed ChartSpecs.
- Formula tracing can become complex across sheets and external references.
- Very messy workbooks may require multiple extraction proposals before a clean dataset patch exists.
- Permissions must be enforced on source reads as carefully as on dataset commits.

## Open Product Decisions

- Should source-backed ChartSpecs be allowed in manuscripts before promotion to dataset commits?
- Should accepted source extracts appear in the Experiment Browser immediately, or only after promotion?
- How long should source indices be retained after project soft delete?
- Should users be able to manually mark a range as a source region?
- Should Source Explorer be a full workspace tab later, or remain a modal/panel?
- Which source types come after Excel: CSV, PDF tables, instrument export text, or images?

## Near-Term Recommendation

Do not start by building a public/general MCP server or a full document AI system. Start with internal, allowlisted AgentRun source tools that the UI can audit and the user can confirm.

Start with one narrow but durable vertical slice:

```text
persist workbook source index
  -> detect C-number distribution regions
  -> source range preview
  -> source extract proposal
  -> source-backed chart proposal
  -> accepted ChartSpec with source refs
```

This directly fixes the Exp30 class of problems while establishing reusable architecture for future source-aware workflows.
