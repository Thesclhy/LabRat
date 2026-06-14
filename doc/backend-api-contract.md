# Backend API Contract

This document defines the current backend-facing contracts for upload review, normalization, semantic mapping, and chart proposal work. Existing endpoints are local-first review boundaries; future cloud work should wrap them in project/file/import-run/proposal/commit APIs without changing the scientific guardrails.

## API Direction

Backend-uploaded data should eventually become visible in Experiment Browser through generic experiment rows. The backend should return structured imports, mappings, chart specs, warnings, dataset commit refs, methodology refs, and provenance; the frontend should derive browser rows and detail views from those records instead of coercing generic data into HDPE-specific fields.

All future write paths should follow this pattern:

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
- return candidate regions and warnings for low-confidence sheets
- never mutate frontend project state directly

Future cloud behavior:

- create or reference an immutable uploaded file version
- create an import run/job record
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
- high-confidence results may be shown as `accepted_draft` in future semi-automatic flows, but the raw import remains unchanged

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
- include warnings when units, grouping, or mappings are uncertain
- do not return manuscript block insertion payloads from chart proposal endpoints
- keep accepted/rejected proposal state separate from raw generic imports
- future chart specs should be reusable by Experiment Browser and manuscript insertion flows

## Future Cloud Endpoints

When LabRat moves beyond local-first project files, add stable project/file/import-run/methodology boundaries:

```text
POST /api/files
POST /api/import-runs
GET /api/import-runs/:id
POST /api/import-runs/:id/approve-blocks
POST /api/import-runs/:id/normalize
POST /api/import-runs/:id/semantic-map
POST /api/import-runs/:id/commit
POST /api/dataset-commits
GET /api/dataset-commits/:id
GET /api/experiments?commit=:commitId
POST /api/methodologies
GET /api/methodologies/:id/versions
POST /api/recompute-runs
GET /api/recompute-runs/:id
POST /api/recompute-runs/:id/commit
POST /api/charts
POST /api/manuscripts/:id/export-pptx
```

These endpoints should use the same scan, normalize, mapping, and chart proposal shapes while adding authentication, role checks, persistence, job status, dataset commit state, methodology versions, provenance queries, and audit logging.

## Future Dataset Commit Shape

Cloud commit responses should make the accepted dataset state explicit:

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
