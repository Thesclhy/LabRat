import {
  DATA_PLAN_SCHEMA_VERSION,
  DATA_SNAPSHOT_SCHEMA_VERSION,
  LEGACY_DATA_PLAN_SCHEMA_VERSION,
  LEGACY_DATA_SNAPSHOT_SCHEMA_VERSION,
  stableDataHash,
} from "./dataPlanSchemas.js";
import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";

const MAX_SOURCE_CELLS_PER_READ = 500;
const MAX_SOURCE_CELLS_PER_PLAN = 50_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function columnFromAddress(address = "") {
  return text(address).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cellValue(cell) {
  return cell?.value ?? cell?.rawValue ?? cell?.formattedValue ?? "";
}

function rowCells(row) {
  return Array.isArray(row) ? row : asArray(row?.cells);
}

function rowNumber(row) {
  if (Number.isFinite(Number(row?.rowNumber))) return Number(row.rowNumber);
  const firstCell = rowCells(row)[0];
  if (Number.isFinite(Number(firstCell?.row))) return Number(firstCell.row) + 1;
  return null;
}

function operation(plan, opName) {
  return asArray(plan.operations).find((op) => op.op === opName) || null;
}

function cellForColumn(row, column) {
  return rowCells(row).find((cell) => columnFromAddress(cell.address) === column) || null;
}

function makeCellRef(cell, fieldId, source) {
  const rawValue = cell?.rawValue ?? cell?.value ?? null;
  return {
    sourceType: "excel_cell",
    sourceDocumentId: source.sourceDocumentId,
    fileObjectId: source.fileObjectId || null,
    importRunId: source.importRunId || null,
    sheet: source.sheetName,
    cell: text(cell?.address),
    row: cell?.row ?? cell?.rowIndex ?? null,
    col: cell?.col ?? cell?.columnIndex ?? null,
    fieldId,
    rawValue,
    formattedValue: cell?.formattedValue ?? (rawValue == null ? null : String(rawValue)),
  };
}

function normalizedAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function typedCellValue(cell, valueType) {
  const rawValue = cell?.rawValue ?? cell?.value ?? null;
  const formattedValue = cell?.formattedValue ?? (rawValue == null ? null : String(rawValue));
  if (rawValue == null || (typeof rawValue === "string" && !rawValue.trim())) {
    return { value: null, formattedValue: formattedValue ?? null };
  }
  if (valueType === "number") {
    const parsed = typeof rawValue === "number"
      ? rawValue
      : Number(String(rawValue).replace(/,/g, ""));
    return {
      value: Number.isFinite(parsed) ? parsed : null,
      formattedValue: formattedValue ?? null,
    };
  }
  if (valueType === "boolean") {
    const parsed = typeof rawValue === "boolean"
      ? rawValue
      : /^(true|1|yes)$/i.test(String(rawValue))
        ? true
        : /^(false|0|no)$/i.test(String(rawValue))
          ? false
          : null;
    return { value: parsed, formattedValue: formattedValue ?? null };
  }
  if (valueType === "date") {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const canonicalDate = new Date(excelEpoch + Math.floor(rawValue) * 86_400_000).toISOString().slice(0, 10);
      return { value: canonicalDate, formattedValue: formattedValue ?? canonicalDate };
    }
    return { value: text(rawValue) || null, formattedValue: formattedValue ?? null };
  }
  return { value: typeof rawValue === "string" ? rawValue : text(formattedValue ?? rawValue), formattedValue: formattedValue ?? null };
}

function rangeSourceRef(source) {
  return {
    sourceType: "excel_range",
    sourceDocumentId: source.sourceDocumentId,
    fileObjectId: source.fileObjectId || null,
    importRunId: source.importRunId || null,
    sheet: source.sheetName,
    range: source.range,
  };
}

function operationsForEvidence(dataPlan, evidenceKey) {
  return new Map(asArray(dataPlan.operations)
    .filter((item) => item?.evidenceKey === evidenceKey)
    .map((item) => [item.op, item]));
}

function chunkedRanges(range, maxCells = MAX_SOURCE_CELLS_PER_READ) {
  const decoded = decodeRange(range);
  const columnCount = decoded.e.c - decoded.s.c + 1;
  if (columnCount > maxCells) {
    const error = new Error(`Source range ${range} has ${columnCount} columns; maximum bounded read width is ${maxCells}.`);
    error.code = "source_range_too_wide";
    throw error;
  }
  const rowsPerChunk = Math.max(1, Math.floor(maxCells / columnCount));
  const ranges = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += rowsPerChunk) {
    ranges.push(encodeRange({
      s: { r: row, c: decoded.s.c },
      e: { r: Math.min(decoded.e.r, row + rowsPerChunk - 1), c: decoded.e.c },
    }));
  }
  return ranges;
}

function rangeCellCount(range) {
  const decoded = decodeRange(range);
  return (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
}

async function readEvidenceRows(source, readRangePreview) {
  if (typeof readRangePreview !== "function") {
    const error = new Error("A backend SourceDocument range reader is required for DataSnapshot preview execution.");
    error.code = "source_reader_required";
    throw error;
  }
  const rowsByNumber = new Map();
  for (const range of chunkedRanges(source.range)) {
    const preview = await readRangePreview({
      sourceDocumentId: source.sourceDocumentId,
      sheetName: source.sheetName,
      range,
      maxCells: MAX_SOURCE_CELLS_PER_READ,
    });
    asArray(preview?.rows).forEach((row) => {
      const number = rowNumber(row);
      if (number != null) rowsByNumber.set(number, row);
    });
  }
  return [...rowsByNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

function fieldValueFromCell(field, cell, source) {
  const typed = typedCellValue(cell, field.valueType);
  return {
    fieldKey: field.fieldKey,
    displayName: field.displayName || field.fieldKey,
    role: field.role,
    value: typed.value,
    formattedValue: typed.formattedValue,
    valueType: field.valueType,
    unit: field.unit || null,
    confidence: field.confidence ?? null,
    warnings: typed.value === null && cellValue(cell) !== ""
      ? [{ code: "value_type_mismatch", message: `${field.displayName || field.fieldKey} could not be read as ${field.valueType}.` }]
      : [],
    headerSourceRefs: asArray(field.headerSourceRefs).map((sourceRef) => ({ ...sourceRef })),
    sourceRefs: [makeCellRef(cell, field.fieldKey, source)],
  };
}

function identityForAlias(dataPlan, alias) {
  return asArray(dataPlan.identityBindings).find((binding) => normalizedAlias(binding?.sourceAlias) === normalizedAlias(alias)) || null;
}

function baseRecord({ dataPlan, alias, source, sourceRefs = [] }) {
  const identity = identityForAlias(dataPlan, alias);
  return {
    experimentId: identity?.action === "reuse" ? identity.experimentIdentityId || null : null,
    identityCandidateKey: identity?.action === "create" ? identity.identityCandidateKey || null : null,
    label: alias,
    aliases: alias ? [alias] : [],
    fields: [],
    series: [],
    warnings: alias ? [] : [{ code: "missing_experiment_alias", message: "The accepted source row did not contain an experiment alias." }],
    sourceRefs: [rangeSourceRef(source), ...sourceRefs],
  };
}

function rowRecord({ dataPlan, row, source, identityOp, fields }) {
  const identityCell = cellForColumn(row, text(identityOp.column).toUpperCase());
  const alias = text(identityCell?.formattedValue ?? cellValue(identityCell));
  const record = baseRecord({
    dataPlan,
    alias,
    source,
    sourceRefs: [makeCellRef(identityCell, "experiment_identity", source)],
  });
  record.fields = fields.map((field) => fieldValueFromCell(field, cellForColumn(row, field.column), source));
  return record;
}

function regionSeries({ rows, source, fields, seriesBinding }) {
  const xField = fields.find((field) => field.column === seriesBinding.xColumn) || { valueType: "number" };
  const yField = fields.find((field) => field.column === seriesBinding.yColumn) || { valueType: "number" };
  const warnings = [];
  const points = rows.flatMap((row) => {
    const xCell = cellForColumn(row, seriesBinding.xColumn);
    const yCell = cellForColumn(row, seriesBinding.yColumn);
    const x = typedCellValue(xCell, xField.valueType).value;
    const y = typedCellValue(yCell, yField.valueType).value;
    if (x == null || y == null) {
      const xRaw = xCell?.rawValue ?? xCell?.value ?? null;
      const yRaw = yCell?.rawValue ?? yCell?.value ?? null;
      if (text(xRaw) || text(yRaw)) warnings.push({
        code: "series_value_type_mismatch",
        message: `${seriesBinding.label || seriesBinding.seriesKey} skipped row ${rowNumber(row)} because x or y did not match its accepted value type.`,
        rowNumber: rowNumber(row),
        sourceRefs: [
          makeCellRef(xCell, seriesBinding.xField || xField.fieldKey || "x", source),
          makeCellRef(yCell, seriesBinding.yField || yField.fieldKey || "y", source),
        ],
      });
      return [];
    }
    return [{
      x,
      y,
      rowNumber: rowNumber(row),
      sourceRefs: [
        makeCellRef(xCell, seriesBinding.xField || xField.fieldKey || "x", source),
        makeCellRef(yCell, seriesBinding.yField || yField.fieldKey || "y", source),
      ],
    }];
  });
  return {
    seriesKey: seriesBinding.seriesKey,
    label: seriesBinding.label || seriesBinding.seriesKey,
    xField: seriesBinding.xField || xField.fieldKey,
    yField: seriesBinding.yField || yField.fieldKey,
    xUnit: seriesBinding.xUnit || xField.unit || null,
    yUnit: seriesBinding.yUnit || yField.unit || null,
    points,
    warnings,
    xHeaderSourceRefs: asArray(xField.headerSourceRefs).map((sourceRef) => ({ ...sourceRef })),
    yHeaderSourceRefs: asArray(yField.headerSourceRefs).map((sourceRef) => ({ ...sourceRef })),
    sourceRefs: [rangeSourceRef(source)],
  };
}

function regionScalarField({ rows, source, field }) {
  const candidates = rows.map((row) => ({
    cell: cellForColumn(row, field.column),
  })).map((item) => ({
    ...item,
    typed: typedCellValue(item.cell, field.valueType),
  })).filter((item) => item.typed.value != null);
  const values = new Map(candidates.map((item) => [JSON.stringify(item.typed.value), item.typed.value]));
  if (values.size !== 1) return null;
  const first = candidates[0];
  return {
    ...fieldValueFromCell(field, first.cell, source),
    sourceRefs: candidates.map((item) => makeCellRef(item.cell, field.fieldKey, source)),
  };
}

function canonicalPreviewContent(snapshot, dataPlan) {
  return {
    outputShape: snapshot.outputShape,
    experimentRecords: snapshot.experimentRecords.map((record) => ({
      identityCandidateKey: record.identityCandidateKey,
      label: record.label,
      aliases: record.aliases,
      fields: record.fields,
      series: record.series,
      warnings: record.warnings,
      sourceRefs: record.sourceRefs,
    })),
    includedRowCount: snapshot.includedRowCount,
    skippedRows: snapshot.skippedRows,
    warnings: snapshot.warnings,
    identityDecisions: asArray(dataPlan.identityBindings).map((binding) => ({
      sourceAlias: binding.sourceAlias,
      action: binding.action,
      identityCandidateKey: binding.identityCandidateKey || null,
    })),
  };
}

export async function executeExperimentRecordDataSnapshotPreview({
  dataPlan,
  readRangePreview,
} = {}) {
  const totalSourceCells = asArray(dataPlan?.sourceEvidence)
    .reduce((sum, source) => sum + rangeCellCount(source.range), 0);
  if (totalSourceCells > MAX_SOURCE_CELLS_PER_PLAN) {
    const error = new Error(`DataPlan source ranges contain ${totalSourceCells} cells; maximum preview scope is ${MAX_SOURCE_CELLS_PER_PLAN}.`);
    error.code = "source_plan_too_large";
    throw error;
  }
  const experimentRecords = [];
  const skippedRows = [];
  const warnings = [];
  let includedRowCount = 0;

  for (const source of asArray(dataPlan?.sourceEvidence)) {
    const operations = operationsForEvidence(dataPlan, source.evidenceKey);
    const identityOp = operations.get("bind_experiment_identity") || {};
    const fieldOp = operations.get("bind_fields") || {};
    const seriesOp = operations.get("bind_series") || {};
    const rowOp = operations.get("select_data_rows") || {};
    const fields = asArray(fieldOp.fields).map((field) => ({ ...field, column: text(field.column).toUpperCase() }));
    const explicitSkips = new Map(asArray(rowOp.skippedRows).map((item) => [Number(item.rowNumber), item.reason || "user_excluded"]));
    const rows = (await readEvidenceRows(source, readRangePreview)).filter((row) => {
      const number = Number(rowNumber(row));
      return number >= Number(rowOp.startRow) && number <= Number(rowOp.endRow);
    });
    const includedRows = rows.filter((row) => !explicitSkips.has(Number(rowNumber(row))));
    skippedRows.push(...[...explicitSkips.entries()].map(([number, reason]) => ({
      evidenceKey: source.evidenceKey,
      rowNumber: number,
      reason,
    })));
    includedRowCount += includedRows.length;

    if (identityOp.experimentAxis === "rows") {
      experimentRecords.push(...includedRows.map((row) => rowRecord({ dataPlan, row, source, identityOp, fields })));
      continue;
    }

    const alias = text(identityOp.experimentLabel);
    const record = baseRecord({ dataPlan, alias, source });
    const seriesBindings = asArray(seriesOp.series);
    const seriesColumns = new Set(seriesBindings.flatMap((item) => [item.xColumn, item.yColumn]));
    record.series = seriesBindings.map((item) => regionSeries({ rows: includedRows, source, fields, seriesBinding: item }));
    for (const field of fields.filter((item) => !seriesColumns.has(item.column))) {
      const scalar = regionScalarField({ rows: includedRows, source, field });
      if (scalar) record.fields.push(scalar);
      else warnings.push({
        code: "non_scalar_region_field",
        evidenceKey: source.evidenceKey,
        fieldKey: field.fieldKey,
        message: `${field.displayName || field.fieldKey} has multiple values and was not emitted as a scalar field.`,
      });
    }
    experimentRecords.push(record);
  }

  warnings.push(...experimentRecords.flatMap((record) => [
    ...asArray(record.fields).flatMap((field) => asArray(field.warnings).map((warning) => ({
      ...warning,
      experimentLabel: record.label,
      fieldKey: field.fieldKey,
      sourceRefs: field.sourceRefs,
    }))),
    ...asArray(record.series).flatMap((series) => asArray(series.warnings).map((warning) => ({
      ...warning,
      experimentLabel: record.label,
      seriesKey: series.seriesKey,
    }))),
  ]));

  const dependencyHash = text(dataPlan?.dependencyHash) || stableDataHash(asArray(dataPlan?.dependencyHashes));
  const snapshot = {
    schemaVersion: DATA_SNAPSHOT_SCHEMA_VERSION,
    status: "preview",
    outputShape: "experiment_records",
    dataPlanId: dataPlan?.id || null,
    dependencyHash,
    experimentRecords,
    includedRowCount,
    skippedRows: skippedRows.sort((a, b) => a.evidenceKey.localeCompare(b.evidenceKey) || a.rowNumber - b.rowNumber),
    warnings,
  };
  const previewHash = stableDataHash(canonicalPreviewContent(snapshot, dataPlan));
  return {
    ...snapshot,
    id: `data_snapshot_preview_${previewHash.slice("sha256_".length, "sha256_".length + 16)}`,
    previewHash,
  };
}

export async function executeDataSnapshotPreview({
  dataPlan,
  readRangePreview,
} = {}) {
  if (dataPlan?.schemaVersion === DATA_PLAN_SCHEMA_VERSION && dataPlan?.outputShape === "experiment_records") {
    return executeExperimentRecordDataSnapshotPreview({ dataPlan, readRangePreview });
  }
  const snapshotSchemaVersion = dataPlan?.schemaVersion === LEGACY_DATA_PLAN_SCHEMA_VERSION
    ? LEGACY_DATA_SNAPSHOT_SCHEMA_VERSION
    : DATA_SNAPSHOT_SCHEMA_VERSION;
  const readOp = operation(dataPlan, "read_table_region");
  const bindOp = operation(dataPlan, "bind_columns");
  const rowOp = operation(dataPlan, "select_data_rows");
  const emitOp = operation(dataPlan, "emit_xy_series");
  if (!readOp || !bindOp || !emitOp) {
    return {
      schemaVersion: snapshotSchemaVersion,
      status: "failed",
      errors: [{ code: "incomplete_data_plan", message: "DataPlan must include read, bind, and emit operations." }],
    };
  }

  const preview = readRangePreview
    ? await readRangePreview({
      sourceDocumentId: readOp.sourceDocumentId,
      sheetName: readOp.sheetName,
      range: readOp.range,
      maxRows: 200,
      maxColumns: 80,
    })
    : null;

  const bindings = bindOp.bindings || {};
  const xBinding = bindings.x || {};
  const yBinding = bindings.y || {};
  const startRow = Number(rowOp?.startRow) || 2;
  const endRow = Number(rowOp?.endRow) || Number.MAX_SAFE_INTEGER;
  const rows = asArray(preview?.rows).filter((row) => (
    Number(rowNumber(row)) >= startRow && Number(rowNumber(row)) <= endRow
  ));

  const points = rows.map((row) => {
    const xCell = cellForColumn(row, text(xBinding.column).toUpperCase());
    const yCell = cellForColumn(row, text(yBinding.column).toUpperCase());
    const x = parseNumber(cellValue(xCell));
    const y = parseNumber(cellValue(yCell));
    if (x === null || y === null) return null;
    return {
      x,
      y,
      rowNumber: rowNumber(row),
      sourceRefs: [
        makeCellRef(xCell, xBinding.semanticField || "x", readOp),
        makeCellRef(yCell, yBinding.semanticField || "y", readOp),
      ],
    };
  }).filter(Boolean);

  const series = [{
    seriesId: emitOp.seriesId || "series_1",
    experimentAlias: emitOp.experimentAlias || "",
    xField: emitOp.x || xBinding.semanticField || "x",
    yField: emitOp.y || yBinding.semanticField || "y",
    x: points.map((point) => point.x),
    y: points.map((point) => point.y),
    points,
    sourceRefs: [{
      sourceType: "excel_range",
      sourceDocumentId: readOp.sourceDocumentId,
      sheet: readOp.sheetName,
      range: readOp.range,
    }],
  }];

  return {
    schemaVersion: snapshotSchemaVersion,
    id: `data_snapshot_preview_${Date.now()}`,
    status: "preview",
    outputShape: dataPlan.outputShape || "xy_series",
    dataPlanId: dataPlan.id || null,
    series,
    warnings: [],
    contentHash: stableDataHash(series),
  };
}
