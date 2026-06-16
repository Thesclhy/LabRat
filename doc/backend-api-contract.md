# Backend API Contract

This document defines the backend-facing contracts for upload review, normalization, semantic mapping, and chart proposal work. These endpoint paths remain available as local/dev compatibility endpoints. Authenticated, project-scoped SaaS APIs are defined in `doc/saas-api-contract-v0.md` and wrap the same scan/normalize/proposal services with persistence, role checks, dataset commits, chart specs, manuscripts, and audit events.

## API Direction

Backend-uploaded data can become visible in Experiment Browser through generic experiment rows. In logged-in server mode, the lifecycle around that data is persisted as file objects, import runs, dataset commits, mapping sets, chart proposal sets, chart specs, manuscripts, and audit events.

All write paths should follow this pattern:

```text
raw action
  -> proposal
  -> human review
  -> commit or rejected proposal
  -> audit event
```

## `POST /api/import/scan`

Purpose: inspect uploaded lab files and return reviewable structure without changing the active LabRat project.

Input:

- `multipart/form-data`
- `file`: `.xlsx` or `.xls` in Phase 1

Response shape:

```json
{
  "file": {
    "fileId": "file_abc123",
    "name": "lab_data.xlsx",
    "type": "xlsx",
    "sizeBytes": 123456
  },
  "sheets": [
    {
      "sheetId": "sheet_1",
      "name": "Run Data",
      "usedRange": "A1:D20",
      "layout": {
        "type": "block_table",
        "confidence": 0.88,
        "reasons": [
          "Repeated header rows detected",
          "Key-value metadata rows found above data tables"
        ]
      },
      "structureProposals": [
        {
          "tableId": "sheet_1_table_1",
          "regionId": "region_1",
          "headerRows": [1, 2],
          "unitRows": [],
          "dataRows": [3, 4],
          "labelColumns": ["col_1"],
          "columns": [
            {
              "fieldId": "col_12",
              "displayName": "Selectivity Gas (%)",
              "rawHeaderPath": ["Selectivity (%)", "Gas"],
              "unit": "%",
              "role": "measurement",
              "valueType": "numeric",
              "confidence": 0.9
            }
          ],
          "warnings": [],
          "confidence": 0.9
        }
      ],
      "blocks": [
        {
          "blockId": "sheet_1_block_1",
          "type": "experiment_block",
          "range": "A1:D10",
          "title": {
            "rawValue": "Experiment 1",
            "source": { "sheet": "Run Data", "cell": "A1" }
          },
          "metadata": [
            {
              "rawKey": "Temperature",
              "rawValue": "80 C",
              "parsedValue": 80,
              "unit": "C",
              "source": { "sheet": "Run Data", "cell": "A2" },
              "confidence": 0.9
            }
          ],
          "table": {
            "headerRange": "A5:C5",
            "dataRange": "A6:C10",
            "columns": [
              {
                  "columnId": "col_time",
                  "rawName": "Time",
                  "unit": "min",
                  "role": "condition",
                  "valueType": "numeric",
                  "source": { "sheet": "Run Data", "cell": "A5" },
                  "confidence": 0.9
              }
            ],
            "rows": [
              {
                "rowIndex": 6,
                "values": [
                  {
                    "columnId": "col_time",
                    "rawValue": "0",
                    "value": 0,
                    "source": { "sheet": "Run Data", "cell": "A6" }
                  }
                ]
              }
            ]
          },
          "warnings": [],
          "confidence": 0.86
        }
      ],
      "warnings": []
    }
  ],
  "warnings": []
}
```

Current scan behavior:

- classify `standard_table`, `block_table`, or `unknown`
- preserve cell-grid formula, comment, style, merged-cell, and hidden row/column hints when available from the workbook parser
- expose table `structureProposals` for multi-row headers, label columns, field roles, units, and data rows
- return candidate regions and warnings for low-confidence sheets
- never mutate frontend project state directly

Project-scoped SaaS behavior:

- create or reference an immutable uploaded file object
- create an import run record
- persist scan results and warnings for later review
- keep raw file storage separate from normalized experiment data

## `POST /api/import/normalize`

Purpose: convert approved scan blocks/tables into a canonical dataset extension.

Status: implemented in the local backend.

Input:

- scan result id or full scan result
- user-approved blocks/tables
- optional user edits to layout, headers, metadata, or mappings

Output:

```json
{
  "datasetPatch": {
    "genericImports": [
      {
        "importId": "import_abc123",
        "schemaVersion": "labrat.genericImport.v1",
        "fileId": "upload_abc123",
        "fileName": "lab_data.xlsx",
        "approvedBlockIds": ["sheet_1_block_1"],
        "experiments": [],
        "fields": [
          {
            "fieldValueId": "import_abc123_field_1",
            "experimentId": "import_abc123_exp_1",
            "fieldId": "col_12",
            "field": "selectivity_gas",
            "role": "measurement",
            "displayName": "Selectivity Gas (%)",
            "canonicalField": null,
            "value": 0.35,
            "rawValue": "0.35",
            "unit": "%",
            "rowIndex": 3,
            "columnId": "col_12",
            "sourceRef": "src_12",
            "confidence": 0.9,
            "warnings": []
          }
        ],
        "measurements": [],
        "sources": [],
        "files": [],
        "warnings": [],
        "confidence": 0.9
      }
    ]
  },
  "summary": {
    "createdExperiments": 0,
    "createdFields": 0,
    "createdMeasurements": 0,
    "warningCount": 0
  }
}
```

Rules:

- preserve existing HDPE dataset fields
- preserve source references
- do not apply the patch without user approval
- return generic imports under `datasetPatch.genericImports[]`; do not return direct mutations for `dataset.experiments[]`
- normalized generic imports should be usable by an Experiment Browser adapter
- include enough experiment, measurement, metadata, warning, confidence, file, and source-ref information for a generic detail view
- use `fields[]` as the complete source-backed long table for generic imports
- mirror only `role: "measurement"` field values into `measurements[]` for chart-preview compatibility
- keep non-measurement values as fields and, where useful for compatibility, experiment metadata; do not inflate measurement counts with identifiers, conditions, or materials
- accepted user role/unit/name edits may be sent as `fieldRoleOverrides`, `mappingOverrides`, and future template ids, but backend output remains a proposal until the frontend applies it

## `POST /api/import/semantic-map`

Purpose: propose semantic mappings for approved generic imports using compact, provenance-aware context.

Status: implemented in the local backend.

Input:

- selected `dataset.genericImports[]` records or selected import ids plus records
- optional compact scan summaries
- optional user goal or project context
- optional accepted/rejected prior mapping decisions

Output:

```json
{
  "schemaVersion": "labrat.semanticMappingResponse.v1",
  "mappingSet": {
    "mappingSetId": "mapping_set_abc123",
    "schemaVersion": "labrat.semanticMappingSet.v1",
    "sourceImportIds": ["import_abc123"],
    "mappings": [
      {
        "mappingId": "mapping_1",
        "status": "proposed",
        "targetKind": "measurement",
        "sourceIds": ["measurement_time"],
        "rawLabel": "Time (min)",
        "canonicalField": "time",
        "semanticRole": "x_axis",
        "valueType": "numeric",
        "unit": "min",
        "confidence": 0.92,
        "rationale": "Header explicitly names time and unit is minutes.",
        "sourceRefs": ["src_1"],
        "warnings": []
      }
    ],
    "warnings": []
  },
  "summary": {
    "proposalCount": 1,
    "warningCount": 0
  }
}
```

Rules:

- use compact generic import summaries, not full raw workbook contents
- proposals must reference generic import measurements, metadata, or source refs
- proposals are not accepted mappings until user review
- do not mutate `dataset.genericImports[]` or `dataset.experiments[]`
- include confidence, rationale, and warnings
- high-confidence results may be shown as draft review aids in future semi-automatic flows, but the raw import remains unchanged and main Browser columns should come from explicit accepted mappings unless a separate reviewed draft-column mode is implemented

## `POST /api/charts/propose`

Purpose: suggest chart specs from approved generic imports and reviewed semantic mappings.

Status: implemented in the local backend.

Input:

- selected generic import ids
- accepted semantic mappings or mapping proposals
- available numeric/categorical/time-like fields
- user goal, if provided
- chart constraints, if provided

Output:

```json
{
  "schemaVersion": "labrat.chartProposalResponse.v1",
  "proposalSet": {
    "proposalSetId": "chart_proposal_set_abc123",
    "schemaVersion": "labrat.chartProposalSet.v1",
    "sourceImportIds": ["import_abc123"],
    "proposals": [
      {
        "proposalId": "chart_1",
        "status": "proposed",
        "chartType": "scatter",
        "x": {
          "measurementId": "measurement_time",
          "field": "time",
          "label": "Time",
          "unit": "min"
        },
        "y": {
          "measurementId": "measurement_conversion",
          "field": "conversion",
          "label": "Conversion",
          "unit": "%"
        },
        "groupBy": {
          "metadataField": "experiment",
          "label": "Experiment"
        },
        "title": "Conversion vs Time",
        "reason": "Time and conversion are numeric fields present across selected experiments.",
        "origin": "deterministic_recipe",
        "score": 0.91,
        "scoreBreakdown": {
          "dataQuality": 0.96,
          "roleFit": 1,
          "goalFit": 0.75,
          "priorPenalty": 0
        },
        "insight": "Conversion changes can be compared against Time across paired records.",
        "aiIntent": null,
        "sourceRefs": ["src_1"],
        "warnings": [],
        "requiresReview": true
      }
    ],
    "warnings": []
  },
  "summary": {
    "proposalCount": 1,
    "warningCount": 0
  }
}
```

Rules:

- proposals are not inserted into manuscripts automatically
- explain why each chart is suggested
- proposals include additive `origin`, `score`, `scoreBreakdown`, and `insight` fields for ranking/review
- `origin: "deterministic_recipe"` means the backend generated the candidate from field profiles and chart recipes
- `origin: "ai_intent"` means AI suggested a compact chart intent that the backend resolved and validated against real imported fields
- include warnings when units, grouping, or mappings are uncertain
- include warnings when pair counts are low, fields are mostly constant, or missing rates are high
- never allow AI to return direct Plotly JSON or unresolved fields
- do not return manuscript block insertion payloads from chart proposal endpoints
- keep accepted/rejected proposal state separate from raw generic imports
- accepted chart proposals should become reusable chart specs before Browser/manuscript insertion flows depend on them

## `POST /api/charts/interpret`

Purpose: turn a one-sentence user chart request into a validated LabRat ChartSpec draft.

Status: implemented in the local/dev backend.

Input:

```json
{
  "prompt": "plot gas selectivity vs temperature grouped by catalyst",
  "genericImports": [],
  "mappingSets": [],
  "selectedImportIds": [],
  "selectedExperimentIds": [],
  "priorDecisions": [],
  "chartConstraints": {}
}
```

Output:

```json
{
  "schemaVersion": "labrat.chartInterpretResponse.v1",
  "chartSpecDraft": {
    "schemaVersion": "labrat.chartSpec.v1.2",
    "status": "proposed",
    "chartType": "scatter",
    "title": "Selectivity Gas (%) vs Temperature (C)",
    "x": {
      "fieldId": "metadata_1_temperature",
      "field": "temperature",
      "label": "Temperature (C)",
      "unit": "C",
      "role": "condition",
      "sourceIds": ["temp_1"]
    },
    "y": {
      "fieldId": "measurement_2_selectivity_gas",
      "field": "selectivity_gas",
      "label": "Selectivity Gas (%)",
      "unit": "%",
      "role": "measurement",
      "sourceIds": ["gas_1"]
    },
    "yFields": [],
    "groupBy": null,
    "filters": [],
    "transforms": [],
    "series": [],
    "calculationWarnings": [],
    "sourceImportIds": ["import_abc123"],
    "sourceRefs": ["src_1"],
    "confidence": 0.91,
    "warnings": [],
    "rationale": "Chart fields were resolved from the prompt and imported field inventory.",
    "prompt": "plot gas selectivity vs temperature grouped by catalyst"
  },
  "clarification": null,
  "warnings": []
}
```

Rules:

- return a LabRat ChartSpec draft, not direct Plotly JSON
- use ChartSpec v1.2 with supported chart types: `scatter`, `point`, `bar`, `grouped_bar`, `stacked_bar`, and `distribution_bar`
- use `yFields[]` for multi-series charts such as solid/liquid/gas selectivity grouped or stacked bars
- use allowlisted chart-local `transforms[]` for preview-only calculations such as `normalize_sum_to_percent`, `pivot_longer`, `sort_components`, `sum_fields`, `ratio`, and `percent_of_total`
- use `distribution_bar` plus `pivot_longer` / `sort_components` for C-number or component-family distributions such as `C7` through `C37`
- AI may parse chart intent aliases, but backend must resolve aliases against real imported fields
- never invent fields or source ids when AI output references unavailable data
- return `clarification` with field options when the prompt is too ambiguous
- preserve source ids/source refs for resolved fields
- keep output review-only; do not insert manuscript blocks or persist chart specs from this endpoint
- support deterministic fallback without an AI key for common prompts such as `plot gas selectivity vs temperature`

## Authenticated Project APIs

For logged-in project work, use `doc/saas-api-contract-v0.md` as the active API contract. The high-level shape is:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/projects
POST /api/projects
POST /api/projects/:projectId/files
POST /api/projects/:projectId/import-runs
POST /api/import-runs/:id/normalize-preview
POST /api/import-runs/:id/apply
POST /api/projects/:projectId/chart-specs/from-proposal
GET  /api/projects/:projectId/chart-specs
GET  /api/projects/:projectId/manuscripts
POST /api/projects/:projectId/manuscripts
PATCH /api/manuscripts/:manuscriptId
```

These APIs use the same scan, normalize, mapping, and chart proposal shapes while adding authentication, role checks, persistence, dataset commit state, chart specs, manuscript persistence, and audit logging. Methodology/recompute APIs remain deferred until the import/chart/manuscript workflow is reliable.

## Dataset Commit Shape

Dataset commit records make the accepted dataset state explicit:

```json
{
  "commitId": "commit_abc123",
  "parentCommitId": "commit_prev",
  "schemaVersion": "labrat.datasetCommit.v1",
  "createdAt": "2026-06-14T00:00:00.000Z",
  "createdBy": "user_1",
  "sourceProposalIds": ["import_proposal_1"],
  "summary": {
    "createdExperiments": 12,
    "changedMeasurements": 4,
    "warningCount": 1
  }
}
```

Rules:

- commits are immutable
- Experiment Browser should read from a selected or latest commit
- charts and manuscript blocks should store the commit id they were generated from

## Future Methodology And Recompute Shape

Methodology changes should produce recompute proposals:

```json
{
  "recomputeRunId": "recompute_abc123",
  "schemaVersion": "labrat.recomputeRun.v1",
  "targetCommitId": "commit_abc123",
  "methodologyVersionId": "method_carbon_balance_v2",
  "status": "review_ready",
  "changes": [
    {
      "experimentId": "exp_12",
      "field": "carbon_balance",
      "oldValue": 91.2,
      "newValue": 96.4,
      "unit": "%",
      "sourceRefs": ["src_gc_1", "src_master_3"],
      "calculationRefs": ["calc_step_1"],
      "warnings": []
    }
  ]
}
```

Rules:

- recompute runs do not overwrite active results
- accepting a recompute creates a new dataset commit
- rejected recomputes remain part of review history when useful
