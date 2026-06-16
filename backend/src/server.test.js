import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as XLSX from "xlsx";
import { createServer } from "./server.js";

let server;
let baseUrl;

function makeWorkbookBlob() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Experiment", "Time (min)", "Conversion (%)"],
    ["Exp1", 0, 0],
    ["Exp1", 10, 25],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Runs");
  const formulaSheet = XLSX.utils.aoa_to_sheet([
    ["Merged Title", ""],
    [2, ""],
  ]);
  formulaSheet.B2 = { t: "n", f: "A2*2", v: 4, w: "4" };
  formulaSheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  XLSX.utils.book_append_sheet(workbook, formulaSheet, "Formula");
  const metadataSheet = XLSX.utils.aoa_to_sheet([
    ["Temperature:", "80 C"],
    ["Catalyst", "Ru/TiO2"],
  ]);
  XLSX.utils.book_append_sheet(workbook, metadataSheet, "Metadata");
  const blockSheet = XLSX.utils.aoa_to_sheet([
    ["Experiment 1"],
    ["Temperature: 80 C"],
    ["Time (min)", "Conversion (%)"],
    [0, 0],
    [10, 25],
    [],
    [],
    ["Experiment 2"],
    ["Temperature: 90 C"],
    ["Time (min)", "Conversion (%)"],
    [0, 0],
    [10, 34],
  ]);
  XLSX.utils.book_append_sheet(workbook, blockSheet, "Blocks");
  const ambiguousSheet = XLSX.utils.aoa_to_sheet([
    ["Temperature"],
    [80],
    [],
    ["good run maybe"],
  ]);
  XLSX.utils.book_append_sheet(workbook, ambiguousSheet, "Ambiguous");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function genericImportFixture() {
  return {
    importId: "import_1",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [
      { experimentId: "exp_1", name: "Exp1", metadata: [] },
      { experimentId: "exp_2", name: "Exp1", metadata: [] },
    ],
    measurements: [
      { measurementId: "m_time_1", experimentId: "exp_1", rowIndex: 2, field: "time", displayName: "Time", value: 0, rawValue: "0", unit: "min", sourceRef: "src_time_1", confidence: 0.9 },
      { measurementId: "m_conv_1", experimentId: "exp_1", rowIndex: 2, field: "conversion", displayName: "Conversion", value: 0, rawValue: "0", unit: "%", sourceRef: "src_conv_1", confidence: 0.86 },
      { measurementId: "m_time_2", experimentId: "exp_2", rowIndex: 3, field: "time", displayName: "Time", value: 10, rawValue: "10", unit: "min", sourceRef: "src_time_2", confidence: 0.9 },
      { measurementId: "m_conv_2", experimentId: "exp_2", rowIndex: 3, field: "conversion", displayName: "Conversion", value: 25, rawValue: "25", unit: "%", sourceRef: "src_conv_2", confidence: 0.86 },
    ],
    sources: [],
  };
}

async function withoutAnthropicKey(action) {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    return await action();
  } finally {
    if (previous == null) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  }
}

before(async () => {
  server = createServer();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://${address.address}:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("GET /health returns service status", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "labrat-backend" });
});

test("POST /api/import/scan route is registered", async () => {
  const response = await fetch(`${baseUrl}/api/import/scan`, { method: "POST" });
  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error.code, "unsupported_media_type");
});

test("POST /api/import/scan scans xlsx workbook metadata", async () => {
  const form = new FormData();
  form.set("file", makeWorkbookBlob(), "standard_table.xlsx");

  const response = await fetch(`${baseUrl}/api/import/scan`, { method: "POST", body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.file.fileId, /^upload_[a-f0-9]{16}$/);
  assert.match(body.file.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(body.file.name, "standard_table.xlsx");
  assert.equal(body.file.type, "xlsx");
  assert.equal(body.sheets.length, 5);
  assert.equal(body.sheets[0].name, "Runs");
  assert.equal(body.sheets[0].usedRange, "A1:C3");
  assert.equal(body.sheets[0].layout.type, "standard_table");
  assert.equal(body.sheets[0].blocks.length, 1);
  assert.equal(body.sheets[0].blocks[0].table.rows.length, 2);
  assert.equal(body.sheets[0].blocks[0].table.rows[1].values[2].source.cell, "C3");
  assert.equal(body.sheets[0].regions.length, 1);
  assert.equal(body.sheets[0].regions[0].range, "A1:C3");
  assert.equal(body.sheets[0].candidateHeaders[0].row, 1);
  assert.equal(body.sheets[0].candidateHeaders[0].range, "A1:C1");
  assert.equal(body.sheets[0].candidateHeaders[0].columns[1].unit, "min");
  assert.equal(body.sheets[0].candidateHeaders[0].columns[2].unit, "%");
  assert.equal(body.sheets[0].candidateHeaders[0].columns[2].source.fileName, "standard_table.xlsx");
  assert.equal(body.sheets[0].candidateHeaders[0].columns[2].source.sheet, "Runs");
  assert.equal(body.sheets[0].candidateHeaders[0].columns[2].source.cell, "C1");
  assert.equal(body.sheets[0].cellGrid.rowCount, 3);
  assert.equal(body.sheets[0].cellGrid.columnCount, 3);
  assert.deepEqual(body.sheets[0].cellGrid.cells[0], {
    row: 1,
    col: 1,
    address: "A1",
    rawValue: "Experiment",
    formattedValue: "Experiment",
    type: "string",
    formula: null,
    style: { patternType: "none" },
    comments: [],
    hiddenRow: false,
    hiddenColumn: false,
    merged: false,
    mergedRange: null,
  });

  const formulaSheet = body.sheets.find((sheet) => sheet.name === "Formula");
  assert.equal(formulaSheet.usedRange, "A1:B2");
  const mergedCell = formulaSheet.cellGrid.cells.find((cell) => cell.address === "A1");
  assert.equal(mergedCell.merged, true);
  assert.equal(mergedCell.mergedRange, "A1:B1");
  const formulaCell = formulaSheet.cellGrid.cells.find((cell) => cell.address === "B2");
  assert.equal(formulaCell.rawValue, 4);
  assert.equal(formulaCell.formattedValue, "4");
  assert.equal(formulaCell.type, "formula");
  assert.equal(formulaCell.formula, "A2*2");

  const metadataSheet = body.sheets.find((sheet) => sheet.name === "Metadata");
  assert.equal(metadataSheet.candidateMetadata.length, 2);
  assert.equal(metadataSheet.candidateMetadata[0].rawKey, "Temperature");
  assert.equal(metadataSheet.candidateMetadata[0].parsedValue, 80);
  assert.equal(metadataSheet.candidateMetadata[0].unit, "C");
  assert.equal(metadataSheet.candidateMetadata[0].source.range, "A1:B1");
  assert.equal(metadataSheet.candidateMetadata[0].source.fileName, "standard_table.xlsx");
  assert.equal(metadataSheet.candidateMetadata[0].source.sheet, "Metadata");

  const blockSheet = body.sheets.find((sheet) => sheet.name === "Blocks");
  assert.equal(blockSheet.layout.type, "block_table");
  assert.equal(blockSheet.blocks.length, 2);
  assert.equal(blockSheet.blocks[0].metadata[0].parsedValue, 80);
  assert.equal(blockSheet.blocks[1].table.rows[1].values[1].value, 34);

  const ambiguousSheet = body.sheets.find((sheet) => sheet.name === "Ambiguous");
  assert.equal(ambiguousSheet.layout.type, "unknown");
  assert.equal(ambiguousSheet.blocks[0].type, "unknown_region");
  assert.equal(ambiguousSheet.blocks[0].table, null);
  assert.equal(ambiguousSheet.warnings[0].code, "unknown_layout");
});

test("POST /api/import/scan uses stable content ids for repeated uploads", async () => {
  const blob = makeWorkbookBlob();
  async function scan(filename) {
    const form = new FormData();
    form.set("file", blob, filename);
    const response = await fetch(`${baseUrl}/api/import/scan`, { method: "POST", body: form });
    assert.equal(response.status, 200);
    return response.json();
  }

  async function normalize(scanResult) {
    const runsBlockId = scanResult.sheets.find((sheet) => sheet.name === "Runs").blocks[0].blockId;
    const response = await fetch(`${baseUrl}/api/import/normalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scanResult,
        approvedBlockIds: [runsBlockId],
      }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  const first = await scan("stable-a.xlsx");
  const second = await scan("stable-b.xlsx");

  assert.equal(first.file.fileId, second.file.fileId);
  assert.equal(first.file.checksumSha256, second.file.checksumSha256);
  assert.equal(first.file.name, "stable-a.xlsx");
  assert.equal(second.file.name, "stable-b.xlsx");

  const firstNormalize = await normalize(first);
  const secondNormalize = await normalize(second);
  assert.equal(
    firstNormalize.datasetPatch.genericImports[0].importId,
    secondNormalize.datasetPatch.genericImports[0].importId,
  );
  assert.equal(firstNormalize.datasetPatch.genericImports[0].fileId, first.file.fileId);
  assert.equal(firstNormalize.datasetPatch.genericImports[0].checksumSha256, first.file.checksumSha256);
});

test("POST /api/import/scan rejects non-Excel uploads", async () => {
  const form = new FormData();
  form.set("file", new Blob(["not excel"], { type: "text/plain" }), "notes.txt");

  const response = await fetch(`${baseUrl}/api/import/scan`, { method: "POST", body: form });
  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error.code, "unsupported_file_type");
});

test("POST /api/import/normalize requires JSON", async () => {
  const response = await fetch(`${baseUrl}/api/import/normalize`, { method: "POST" });

  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error.code, "unsupported_media_type");
});

test("POST /api/import/normalize rejects invalid JSON", async () => {
  const response = await fetch(`${baseUrl}/api/import/normalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{nope",
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_json");
});

test("POST /api/import/normalize validates scan approvals", async () => {
  const response = await fetch(`${baseUrl}/api/import/normalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scanResult: { schemaVersion: "old" },
      approvedBlockIds: [],
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_normalize_request");
  assert.equal(body.error.details.includes("At least one approved block id is required."), true);
});

test("POST /api/import/normalize returns a generic patch envelope for valid approvals", async () => {
  const response = await fetch(`${baseUrl}/api/import/normalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scanResult: {
        schemaVersion: "labrat.importScan.v1",
        file: { fileId: "upload_1", name: "runs.xlsx" },
        sheets: [],
      },
      approvedBlockIds: ["sheet_1_table_1"],
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schemaVersion, "labrat.importNormalize.v1");
  assert.equal(body.datasetPatch.genericImports.length, 1);
  assert.equal(body.datasetPatch.genericImports[0].warnings[0].code, "approved_block_not_found");
  assert.equal(body.summary.genericImportCount, 1);
  assert.equal(body.summary.createdExperiments, 0);
});

test("POST /api/import/normalize normalizes approved scan fixture blocks", async () => {
  const form = new FormData();
  form.set("file", makeWorkbookBlob(), "mixed-normalize.xlsx");
  const scanResponse = await fetch(`${baseUrl}/api/import/scan`, { method: "POST", body: form });
  assert.equal(scanResponse.status, 200);
  const scanResult = await scanResponse.json();
  const runsBlockId = scanResult.sheets.find((sheet) => sheet.name === "Runs").blocks[0].blockId;
  const blockIds = scanResult.sheets.find((sheet) => sheet.name === "Blocks").blocks.map((block) => block.blockId);
  const unknownBlockId = scanResult.sheets.find((sheet) => sheet.name === "Ambiguous").blocks[0].blockId;

  const normalizeResponse = await fetch(`${baseUrl}/api/import/normalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scanResult,
      approvedBlockIds: [runsBlockId, ...blockIds, unknownBlockId],
      userEdits: { createdAt: "2026-06-08T00:00:00.000Z" },
    }),
  });

  assert.equal(normalizeResponse.status, 200);
  const body = await normalizeResponse.json();
  const genericImport = body.datasetPatch.genericImports[0];
  assert.equal(genericImport.fileName, "mixed-normalize.xlsx");
  assert.equal(genericImport.experiments.length, 4);
  assert.equal(genericImport.fields.length, 16);
  assert.equal(genericImport.measurements.length, 6);
  assert.equal(genericImport.warnings[0].code, "unsupported_block_type");
  assert.equal(genericImport.sources.some((source) => source.cell === "C3" && source.rawValue === 25), true);
  assert.equal(Object.hasOwn(body.datasetPatch, "experiments"), false);
});

test("POST /api/import/semantic-map requires JSON", async () => {
  const response = await fetch(`${baseUrl}/api/import/semantic-map`, { method: "POST" });

  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error.code, "unsupported_media_type");
});

test("POST /api/import/semantic-map rejects invalid JSON", async () => {
  const response = await fetch(`${baseUrl}/api/import/semantic-map`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{nope",
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_json");
});

test("POST /api/import/semantic-map rejects missing generic imports", async () => {
  const response = await fetch(`${baseUrl}/api/import/semantic-map`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ genericImports: [] }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_semantic_mapping_request");
});

test("POST /api/import/semantic-map returns deterministic proposals without AI key", async () => {
  await withoutAnthropicKey(async () => {
    const response = await fetch(`${baseUrl}/api/import/semantic-map`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ genericImports: [genericImportFixture()] }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, "labrat.semanticMappingResponse.v1");
    assert.equal(body.mappingSet.mappings.some((mapping) => mapping.semanticRole === "time"), true);
    assert.equal(body.mappingSet.mappings.some((mapping) => mapping.semanticRole === "response"), true);
    assert.equal(body.mappingSet.warnings.some((warning) => warning.code === "ai_unavailable"), true);
  });
});

test("POST /api/charts/propose requires JSON", async () => {
  const response = await fetch(`${baseUrl}/api/charts/propose`, { method: "POST" });

  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error.code, "unsupported_media_type");
});

test("POST /api/charts/interpret requires JSON", async () => {
  const response = await fetch(`${baseUrl}/api/charts/interpret`, { method: "POST" });

  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error.code, "unsupported_media_type");
});

test("POST /api/charts/interpret rejects missing prompt or imports", async () => {
  const response = await fetch(`${baseUrl}/api/charts/interpret`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "", genericImports: [] }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_chart_interpret_request");
});

test("POST /api/charts/interpret returns deterministic ChartSpec drafts without AI key", async () => {
  await withoutAnthropicKey(async () => {
    const response = await fetch(`${baseUrl}/api/charts/interpret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "plot conversion vs time",
        genericImports: [genericImportFixture()],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, "labrat.chartInterpretResponse.v1");
    assert.equal(body.chartSpecDraft.schemaVersion, "labrat.chartSpec.v1.2");
    assert.equal(body.chartSpecDraft.chartType, "scatter");
    assert.equal(body.chartSpecDraft.x.field, "time");
    assert.equal(body.chartSpecDraft.y.field, "conversion");
    assert.equal(body.chartSpecDraft.warnings.some((warning) => warning.code === "ai_unavailable"), true);
  });
});

test("POST /api/charts/propose rejects invalid JSON", async () => {
  const response = await fetch(`${baseUrl}/api/charts/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{nope",
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_json");
});

test("POST /api/charts/propose rejects missing generic imports", async () => {
  const response = await fetch(`${baseUrl}/api/charts/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ genericImports: [] }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_chart_proposal_request");
});

test("POST /api/charts/propose returns deterministic chart proposals without AI key", async () => {
  await withoutAnthropicKey(async () => {
    const response = await fetch(`${baseUrl}/api/charts/propose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ genericImports: [genericImportFixture()] }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, "labrat.chartProposalResponse.v1");
    assert.equal(body.proposalSet.proposals.length, 1);
    assert.equal(body.proposalSet.proposals[0].chartType, "scatter");
    assert.equal(body.proposalSet.warnings.some((warning) => warning.code === "ai_unavailable"), true);
  });
});
