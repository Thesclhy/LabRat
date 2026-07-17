# LabRat Postman Collection

Use these files to smoke-test the local LabRat API from Postman:

- `labrat-workbook-review.postman_collection.json`
- `labrat-workbook-review.postman_environment.json`

## Prerequisites

Start the local stack:

```powershell
npm run dev:docker
```

Default local backend:

```text
http://127.0.0.1:8787
```

Default seeded account:

```text
labuser / LabRatLab123!
```

## Import

1. Open Postman.
2. Import `labrat-workbook-review.postman_collection.json`.
3. Import `labrat-workbook-review.postman_environment.json`.
4. Select the `LabRat Local Workbook Review` environment.
5. Run folders in order:
   - `01 Auth and Project`
   - `02 Workbook Upload and Review`
   - `03 Source Document Inspection`
   - `04 Source Extract to ChartSpec`
   - optional `05 Search and Chart Intent`
   - optional `06 Planned WorkbookUnderstanding APIs`

## Important Variables

- `baseUrl`: backend URL.
- `workbookFilePath`: local workbook path used by the file upload request.
- `sheetName`: sheet used by range/extract requests.
- `range`: Excel range used by range/extract requests.
- `extractType`: usually `table_range`; use `component_distribution` only when the selected range has C-number style data.

Postman may not expand environment variables inside file upload paths in all versions. If upload fails because the file is missing, open `Upload Workbook File` and choose the workbook manually.

For `Upload Workbook File`, do not add a `Content-Type` header manually and do not use a pre-request script to remove it. Postman must generate this request header itself:

```text
Content-Type: multipart/form-data; boundary=...
```

If Postman sends `multipart/form-data` without `boundary`, or sends no
`Content-Type`, the backend correctly returns `415 unsupported_media_type`.

## Planned Endpoints

The `06 Planned WorkbookUnderstanding APIs` folder contains contract-first requests for:

- `POST /api/workbook-review-sessions/:sessionId/revisions`
- `POST /api/workbook-review-sessions/:sessionId/confirm`

These are currently documented as planned. A `404` response is expected until the backend implements them, and the collection treats `404` as non-failing for those two requests.
