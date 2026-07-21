import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import { readSourceDocumentRange, SOURCE_RANGE_MAX_CELLS } from "./sourceDocuments.js";

export const WORKBOOK_REGION_INTERPRETATION_SCHEMA_VERSION = "labrat.workbookRegionInterpretation.v1";

const MAX_INSPECTION_ROWS = 25;
const MAX_INSPECTION_COLUMNS = 24;
const MAX_INSPECTION_CELLS = SOURCE_RANGE_MAX_CELLS;
const AXES = new Set(["rows", "region"]);
const FIELD_ROLES = new Set(["identifier", "condition", "outcome", "series_summary", "other"]);
const VALUE_TYPES = new Set(["number", "string", "date", "boolean"]);
const NON_EXPERIMENT_SEMANTIC_TYPES = new Set(["ignored_region", "metadata_notes"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[°℃]/g, "c").replace(/[^a-z0-9%]+/g, " ").trim();
}

function slug(value, fallback = "field") {
  const result = normalized(value).replace(/%/g, " percent ").trim().replace(/\s+/g, "_");
  return result || fallback;
}

function columnName(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function columnFromAddress(address) {
  return text(address).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
}

function rowNumber(cell) {
  return Number.isInteger(cell?.row) ? cell.row + 1 : Number(text(cell?.address).match(/\d+$/)?.[0]) || null;
}

function cellValue(cell) {
  return cell?.rawValue ?? cell?.formattedValue ?? null;
}

function isBlank(value) {
  return value == null || text(value) === "";
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!text(value)) return null;
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedInspectionRange(rangeRef, { startRow } = {}) {
  const decoded = decodeRange(rangeRef);
  const requestedStart = Number(startRow);
  const startRowIndex = Number.isInteger(requestedStart)
    && requestedStart >= decoded.s.r + 1
    && requestedStart <= decoded.e.r + 1
    ? requestedStart - 1
    : decoded.s.r;
  const columnCount = Math.min(decoded.e.c - decoded.s.c + 1, MAX_INSPECTION_COLUMNS);
  const maxRowsByCells = Math.max(1, Math.floor(MAX_INSPECTION_CELLS / columnCount));
  const rowCount = Math.min(decoded.e.r - startRowIndex + 1, MAX_INSPECTION_ROWS, maxRowsByCells);
  const bounded = {
    s: { r: startRowIndex, c: decoded.s.c },
    e: {
      r: startRowIndex + rowCount - 1,
      c: decoded.s.c + columnCount - 1,
    },
  };
  return {
    full: decoded,
    range: encodeRange(bounded),
    truncated: bounded.e.r !== decoded.e.r || bounded.e.c !== decoded.e.c,
  };
}

function rowScore(row, followingRow) {
  const populated = asArray(row).filter((cell) => !isBlank(cellValue(cell)));
  if (!populated.length) return -1;
  const stringCount = populated.filter((cell) => numericValue(cellValue(cell)) == null).length;
  const uniqueCount = new Set(populated.map((cell) => normalized(cellValue(cell))).filter(Boolean)).size;
  const followingNumericCount = asArray(followingRow).filter((cell) => numericValue(cellValue(cell)) != null).length;
  const headerSignals = populated.filter((cell) => (
    /experiment|run|sample|label|temperature|time|rate|yield|conversion|selectivity|pressure|catalyst/i.test(text(cellValue(cell)))
  )).length;
  return stringCount * 3 + uniqueCount + followingNumericCount * 2 + headerSignals * 4;
}

function inferHeaderRow(rows) {
  const candidates = asArray(rows).slice(0, 8).map((row, index) => ({
    row,
    rowNumber: rowNumber(asArray(row)[0]) || index + 1,
    score: rowScore(row, rows[index + 1]),
  })).sort((a, b) => b.score - a.score || a.rowNumber - b.rowNumber);
  return candidates[0] || { row: [], rowNumber: 1, score: 0 };
}

function mergedRangeIncludesColumn(rangeRef, columnIndex) {
  if (!rangeRef) return false;
  try {
    const decoded = decodeRange(rangeRef);
    return columnIndex >= decoded.s.c && columnIndex <= decoded.e.c;
  } catch {
    return false;
  }
}

function spansMultipleColumns(cell) {
  if (!cell?.mergedRange) return false;
  try {
    const decoded = decodeRange(cell.mergedRange);
    return decoded.e.c > decoded.s.c;
  } catch {
    return false;
  }
}

function nonBlankHeaderCellForColumn(row, columnIndex) {
  const exact = asArray(row).find((cell) => cell?.col === columnIndex);
  if (exact && !isBlank(cellValue(exact))) return exact;
  return asArray(row).find((cell) => (
    !isBlank(cellValue(cell))
    && mergedRangeIncludesColumn(cell.mergedRange, columnIndex)
  )) || null;
}

function hasChildHeaders(parentRow, childRow) {
  const groupedCells = asArray(parentRow).filter((cell) => (
    !isBlank(cellValue(cell)) && spansMultipleColumns(cell)
  ));
  if (!groupedCells.length) return false;
  return asArray(childRow).some((cell) => (
    !isBlank(cellValue(cell))
    && groupedCells.some((parent) => mergedRangeIncludesColumn(parent.mergedRange, cell.col))
  ));
}

function inferHeader({ rows }) {
  const availableRows = asArray(rows);
  const proposed = inferHeaderRow(availableRows);
  const proposedIndex = availableRows.findIndex((row) => rowNumber(asArray(row)[0]) === proposed.rowNumber);
  const previousRow = proposedIndex > 0 ? availableRows[proposedIndex - 1] : null;
  const nextRow = proposedIndex >= 0 ? availableRows[proposedIndex + 1] : null;

  if (nextRow && hasChildHeaders(proposed.row, nextRow)) {
    return {
      row: nextRow,
      rowNumber: rowNumber(asArray(nextRow)[0]) || proposed.rowNumber + 1,
      rows: [proposed.row, nextRow],
    };
  }
  if (previousRow && hasChildHeaders(previousRow, proposed.row)) {
    return {
      row: proposed.row,
      rowNumber: proposed.rowNumber,
      rows: [previousRow, proposed.row],
    };
  }
  return { ...proposed, rows: [proposed.row] };
}

function inferUnit(headerText) {
  const raw = text(headerText);
  const lower = raw.toLowerCase().replace(/[°℃]/g, "c");
  const parenthetical = lower.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
  const candidate = parenthetical || lower;
  if (/(^|\W)(c|deg\s*c|celsius)($|\W)/.test(candidate)) return "degC";
  if (/(^|\W)(min|mins|minute|minutes)($|\W)/.test(candidate)) return "min";
  if (/(^|\W)(h|hr|hrs|hour|hours)($|\W)/.test(candidate) && !/\//.test(candidate)) return "h";
  if (candidate.includes("mmol/g/h") || candidate.includes("mmol g-1 h-1") || candidate.includes("mmol g h")) return "mmol_g_h";
  if (candidate.includes("mol/g/h") || candidate.includes("mol g-1 h-1") || candidate.includes("mol g h")) return "mol_g_h";
  if (candidate.includes("mol/s") || candidate.includes("mol s-1")) return "mol_s";
  if (candidate.includes("mg/h") || candidate.includes("mg h-1")) return "mg_h";
  if (candidate.includes("g/h") || candidate.includes("g h-1")) return "g_h";
  if (candidate.includes("%") || /percent/.test(candidate)) return "percent";
  if (/(^|\W)bar($|\W)/.test(candidate)) return "bar";
  if (/(^|\W)rpm($|\W)/.test(candidate)) return "rpm";
  if (/(^|\W)mg($|\W)/.test(candidate)) return "mg";
  if (/(^|\W)g($|\W)/.test(candidate)) return "g";
  if (/(^|\W)ml($|\W)/.test(candidate)) return "mL";
  return null;
}

function semanticKeyFor(headerText) {
  const value = normalized(headerText);
  if (/reaction time|^time$|start time|end time|mean time/.test(value)) return "reaction_time";
  if (/reaction rate|adjusted rate|average rate|^rate$/.test(value)) return "reaction_rate";
  if (/temperature|temp/.test(value)) return "reaction_temperature";
  if (/pressure/.test(value)) return "reaction_pressure";
  if (/experiment|experiment id|run id|sample id|^run$|^label$/.test(value)) return "experiment_id";
  if (/conversion/.test(value)) return "conversion";
  if (/yield/.test(value)) return "yield";
  if (/selectivity/.test(value)) return slug(value.replace(/percent|%/g, ""), "selectivity");
  if (/catalyst/.test(value)) return "catalyst";
  return slug(value.replace(/\b(c|degc|min|minutes|h|hr|hours|percent|bar|rpm|mg|g|ml)\b/g, ""));
}

function combinedHeaderDisplayName(parts) {
  if (parts.length <= 1) return parts[0] || "";
  let unitSuffix = "";
  const labels = parts.map((part) => {
    const match = String(part).match(/\s*\(([^)]+)\)\s*$/);
    if (!match) return part;
    if (!unitSuffix) unitSuffix = match[1].trim();
    return String(part).slice(0, match.index).trim();
  }).filter(Boolean);
  return `${labels.join(" - ")}${unitSuffix ? ` (${unitSuffix})` : ""}`;
}

function roleFor(semanticKey) {
  if (semanticKey === "experiment_id") return "identifier";
  if (/temperature|pressure|time|catalyst|loading|rpm/.test(semanticKey)) return "condition";
  if (/yield|conversion|selectivity|rate|observed|response|result/.test(semanticKey)) return "outcome";
  return "other";
}

function valueTypeFor(cells) {
  const values = asArray(cells).map(cellValue).filter((value) => !isBlank(value));
  if (values.length && values.every((value) => typeof value === "boolean" || /^(true|false)$/i.test(text(value)))) return "boolean";
  if (values.length && values.every((value) => numericValue(value) != null)) return "number";
  if (values.length && values.every((value) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text(value)))) return "date";
  return "string";
}

function sourceCellRef({ sourceDocument, sheetName, cell }) {
  return {
    sourceType: "excel_cell",
    sourceDocumentId: sourceDocument.id,
    fileObjectId: sourceDocument.fileObjectId || null,
    importRunId: sourceDocument.importRunId || null,
    sheet: sheetName,
    cell: cell.address,
  };
}

function headersFrom({ sourceDocument, rangeResult, header }) {
  const decoded = decodeRange(rangeResult.range);
  const headerRows = asArray(header.rows).length ? header.rows : [header.row];
  const fields = [];
  for (let columnIndex = decoded.s.c; columnIndex <= decoded.e.c; columnIndex += 1) {
    const pathCells = headerRows
      .map((row) => nonBlankHeaderCellForColumn(row, columnIndex))
      .filter(Boolean)
      .filter((cell, index, cells) => cells.findIndex((candidate) => candidate.address === cell.address) === index);
    const headerParts = pathCells
      .map((cell) => text(cellValue(cell)))
      .filter(Boolean)
      .filter((part, index, parts) => parts.findIndex((candidate) => normalized(candidate) === normalized(part)) === index);
    if (!headerParts.length) continue;
    const displayName = combinedHeaderDisplayName(headerParts);
    const column = columnName(columnIndex);
    const dataCells = asArray(rangeResult.rows)
      .filter((row) => rowNumber(asArray(row)[0]) > header.rowNumber)
      .map((row) => asArray(row).find((candidate) => columnFromAddress(candidate.address) === column))
      .filter(Boolean);
    const semanticKey = semanticKeyFor(displayName);
    const leafCell = [...pathCells].reverse().find((cell) => columnFromAddress(cell.address) === column)
      || pathCells[pathCells.length - 1];
    fields.push({
      column,
      headerCell: leafCell.address,
      displayName,
      semanticKey,
      role: roleFor(semanticKey),
      valueType: valueTypeFor(dataCells),
      unit: inferUnit(displayName),
      confidence: semanticKey === slug(displayName) ? 0.68 : 0.9,
      sourceRefs: pathCells.map((cell) => sourceCellRef({
        sourceDocument,
        sheetName: rangeResult.sheetName,
        cell,
      })),
    });
  }
  return fields;
}

function identityColumn(headers) {
  return headers.find((field) => field.semanticKey === "experiment_id")?.column || null;
}

function experimentLabelFrom(...values) {
  for (const value of values) {
    const match = text(value).match(/\bexp(?:eriment)?[\s_-]*0*([0-9]+)\b/i);
    if (match) return `Exp${Number(match[1])}`;
  }
  return null;
}

function inferAxis(region, headers, experimentLabel) {
  const semanticType = text(region.semanticType);
  if (NON_EXPERIMENT_SEMANTIC_TYPES.has(semanticType)) return { axis: null, confidence: 1, excluded: true };
  if (semanticType === "experiment_table") return { axis: "rows", confidence: 0.96, excluded: false };
  if (["reaction_rate_time_series", "component_distribution", "calculation_table"].includes(semanticType)) {
    return { axis: "region", confidence: 0.94, excluded: false };
  }
  if (semanticType === "generic_table" && identityColumn(headers)) return { axis: "rows", confidence: 0.82, excluded: false };
  if (semanticType === "generic_table" && experimentLabel && headers.filter((field) => field.valueType === "number").length >= 2) {
    return { axis: "region", confidence: 0.76, excluded: false };
  }
  return { axis: null, confidence: 0.35, excluded: false };
}

function skippedRowsFor({ rows, headerRow, axis, idColumn, fields }) {
  const dataRows = asArray(rows).filter((row) => rowNumber(asArray(row)[0]) > headerRow);
  return dataRows.flatMap((row) => {
    const currentRow = rowNumber(asArray(row)[0]);
    if (!currentRow) return [];
    if (axis === "rows") {
      const identityCell = asArray(row).find((cell) => columnFromAddress(cell.address) === idColumn);
      return isBlank(cellValue(identityCell)) ? [{ rowNumber: currentRow, reason: "blank_identifier" }] : [];
    }
    const includedColumns = new Set(asArray(fields).map((field) => field.column));
    const hasValue = asArray(row).some((cell) => includedColumns.has(columnFromAddress(cell.address)) && !isBlank(cellValue(cell)));
    return hasValue ? [] : [{ rowNumber: currentRow, reason: "blank_data_row" }];
  });
}

function seriesFrom(fields) {
  const xField = fields.find((field) => field.semanticKey === "reaction_time");
  const yField = fields.find((field) => field.semanticKey === "reaction_rate");
  if (!xField || !yField) return [];
  return [{
    seriesKey: "reaction_rate_over_time",
    label: "Reaction rate over time",
    xColumn: xField.column,
    yColumn: yField.column,
    xSemanticKey: xField.semanticKey,
    ySemanticKey: yField.semanticKey,
    xUnit: xField.unit,
    yUnit: yField.unit,
    confidence: 0.94,
    sourceRefs: [...xField.sourceRefs, ...yField.sourceRefs],
  }];
}

function proposalFor({ sourceDocument, region, rangeResult, fullRange, inspectionTruncated }) {
  const header = inferHeader({ rows: rangeResult.rows });
  const headers = headersFrom({ sourceDocument, rangeResult, header });
  const experimentLabel = experimentLabelFrom(
    region.description,
    region.sheetName,
    sourceDocument.metadata?.workbookName,
    sourceDocument.metadata?.fileName,
  );
  const axisProposal = inferAxis(region, headers, experimentLabel);
  const proposedIdentityColumn = axisProposal.axis === "rows" ? identityColumn(headers) : null;
  const fields = headers.filter((field) => axisProposal.axis !== "rows" || field.column !== proposedIdentityColumn);
  const startRow = header.rowNumber + 1;
  const endRow = fullRange.e.r + 1;
  const warnings = [];
  if (inspectionTruncated) {
    warnings.push({
      code: "interpretation_inspection_truncated",
      message: `Interpretation inspected ${rangeResult.range}; row inclusion still covers the selected range.`,
    });
  }
  if (!headers.length) {
    warnings.push({ code: "header_row_ambiguous", message: "No non-empty header cells were found in the bounded source range." });
  }
  return {
    schemaVersion: WORKBOOK_REGION_INTERPRETATION_SCHEMA_VERSION,
    experimentAxis: axisProposal.axis,
    headerRow: header.rowNumber,
    experimentLabel: axisProposal.axis === "region" ? experimentLabel : null,
    experimentIdColumn: proposedIdentityColumn,
    fields,
    series: axisProposal.axis === "region" ? seriesFrom(fields) : [],
    inclusion: {
      startRow,
      endRow,
      skippedRows: skippedRowsFor({
        rows: rangeResult.rows,
        headerRow: header.rowNumber,
        axis: axisProposal.axis,
        idColumn: proposedIdentityColumn,
        fields,
      }),
    },
    confidence: inspectionTruncated ? Math.min(axisProposal.confidence, 0.85) : axisProposal.confidence,
    decisionSource: "deterministic_proposal",
    warnings,
    excluded: axisProposal.excluded,
  };
}

function patchError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  error.details = details;
  throw error;
}

function validateColumn(column, fullRange, property) {
  const normalizedColumn = text(column).toUpperCase();
  if (!/^[A-Z]+$/.test(normalizedColumn)) patchError("invalid_interpretation_patch", `${property} must be an Excel column such as A or BC.`);
  const decoded = decodeRange(`${normalizedColumn}1:${normalizedColumn}1`);
  if (decoded.s.c < fullRange.s.c || decoded.s.c > fullRange.e.c) {
    patchError("interpretation_column_outside_region", `${property} must be inside the selected source range.`, { column: normalizedColumn });
  }
  return normalizedColumn;
}

function fieldFromPatch({ sourceDocument, sheetName, patch, proposedFields, fullRange, headerRow }) {
  const column = validateColumn(patch.column, fullRange, "field column");
  const proposed = proposedFields.find((field) => field.column === column) || {};
  const role = text(patch.role || proposed.role || "other");
  const valueType = text(patch.valueType || proposed.valueType || "string");
  if (!FIELD_ROLES.has(role)) patchError("invalid_field_role", `Unsupported field role: ${role}.`);
  if (!VALUE_TYPES.has(valueType)) patchError("invalid_field_value_type", `Unsupported field value type: ${valueType}.`);
  const headerCell = proposed.headerCell || `${column}${headerRow}`;
  return {
    column,
    headerCell,
    semanticKey: slug(patch.semanticKey || proposed.semanticKey || `column_${column.toLowerCase()}`),
    displayName: text(patch.displayName || proposed.displayName || column),
    role,
    valueType,
    unit: patch.unit === null ? null : text(patch.unit ?? proposed.unit) || null,
    confidence: 0.98,
    sourceRefs: asArray(proposed.sourceRefs).length
      ? proposed.sourceRefs
      : [{
        sourceType: "excel_cell",
        sourceDocumentId: sourceDocument.id,
        fileObjectId: sourceDocument.fileObjectId || null,
        importRunId: sourceDocument.importRunId || null,
        sheet: sheetName,
        cell: headerCell,
      }],
  };
}

function validatedInclusion(patch, proposal, fullRange) {
  const source = cleanObject(patch);
  const startRow = Number(source.startRow ?? proposal.startRow);
  const endRow = Number(source.endRow ?? proposal.endRow);
  const minimum = fullRange.s.r + 1;
  const maximum = fullRange.e.r + 1;
  if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || startRow < minimum || endRow > maximum || endRow < startRow) {
    patchError("invalid_inclusion_range", "Included rows must be inside the selected source range.", { startRow, endRow, minimum, maximum });
  }
  const skippedRows = asArray(source.skippedRows ?? proposal.skippedRows).map((skipped) => {
    const row = Number(skipped?.rowNumber);
    if (!Number.isInteger(row) || row < startRow || row > endRow) {
      patchError("invalid_skipped_row", "Skipped rows must be inside the included row range.", { rowNumber: row, startRow, endRow });
    }
    return { rowNumber: row, reason: text(skipped?.reason) || "user_excluded" };
  });
  return { startRow, endRow, skippedRows };
}

function applyPatch({ sourceDocument, region, rangeResult, proposal, patch, fullRange }) {
  const source = cleanObject(patch);
  if (!Object.keys(source).length) return proposal;
  const experimentAxis = text(source.experimentAxis || proposal.experimentAxis) || null;
  if (experimentAxis && !AXES.has(experimentAxis)) patchError("invalid_experiment_axis", `Unsupported experiment axis: ${experimentAxis}.`);
  const headerRow = Number(source.headerRow ?? proposal.headerRow);
  const minRow = fullRange.s.r + 1;
  const maxRow = fullRange.e.r + 1;
  if (!Number.isInteger(headerRow) || headerRow < minRow || headerRow > maxRow) {
    patchError("invalid_header_row", "Header row must be inside the selected source range.", { headerRow, minRow, maxRow });
  }
  const selectedHeaderRow = asArray(rangeResult.rows).find((row) => rowNumber(asArray(row)[0]) === headerRow) || [];
  const inferredHeader = headerRow === proposal.headerRow
    ? inferHeader({ rows: rangeResult.rows })
    : null;
  const headerFields = headersFrom({
    sourceDocument,
    rangeResult,
    header: inferredHeader || { row: selectedHeaderRow, rowNumber: headerRow },
  });
  const proposedIdentityColumn = experimentAxis === "rows" ? identityColumn(headerFields) : null;
  const identityColumnCandidate = source.experimentIdColumn === null
    ? null
    : text(source.experimentIdColumn || proposedIdentityColumn || proposal.experimentIdColumn).toUpperCase() || null;
  const proposedFields = headerFields.filter((field) => experimentAxis !== "rows" || field.column !== identityColumnCandidate);
  const proposalInclusion = {
    ...proposal.inclusion,
    startRow: Math.min(headerRow + 1, fullRange.e.r + 1),
    skippedRows: skippedRowsFor({
      rows: rangeResult.rows,
      headerRow,
      axis: experimentAxis,
      idColumn: identityColumnCandidate,
      fields: proposedFields,
    }),
  };
  let fields = source.fields
    ? asArray(source.fields).map((field) => fieldFromPatch({
      sourceDocument,
      sheetName: region.sheetName,
      patch: field,
      proposedFields,
      fullRange,
      headerRow,
    }))
    : proposedFields;
  for (const fieldPatch of asArray(source.fieldPatches)) {
    const column = text(fieldPatch?.column).toUpperCase();
    const existingIndex = fields.findIndex((field) => field.column === column);
    const nextField = fieldFromPatch({
      sourceDocument,
      sheetName: region.sheetName,
      patch: { ...(existingIndex >= 0 ? fields[existingIndex] : {}), ...fieldPatch },
      proposedFields,
      fullRange,
      headerRow,
    });
    fields = existingIndex >= 0
      ? fields.map((field, index) => index === existingIndex ? nextField : field)
      : [...fields, nextField];
  }
  const experimentIdColumn = experimentAxis === "rows"
    ? (source.experimentIdColumn === null
      ? null
      : (identityColumnCandidate
        ? validateColumn(identityColumnCandidate, fullRange, "experimentIdColumn")
        : null))
    : null;
  const experimentLabel = experimentAxis === "region"
    ? text(source.experimentLabel ?? proposal.experimentLabel) || null
    : null;
  const inclusion = validatedInclusion(source.inclusion, proposalInclusion, fullRange);
  const series = source.series
    ? asArray(source.series).map((item) => ({
      seriesKey: slug(item.seriesKey, "series"),
      label: text(item.label) || "Series",
      xColumn: validateColumn(item.xColumn, fullRange, "series xColumn"),
      yColumn: validateColumn(item.yColumn, fullRange, "series yColumn"),
      xSemanticKey: slug(item.xSemanticKey, "x"),
      ySemanticKey: slug(item.ySemanticKey, "y"),
      xUnit: text(item.xUnit) || null,
      yUnit: text(item.yUnit) || null,
      confidence: 0.98,
      sourceRefs: fields
        .filter((field) => [text(item.xColumn).toUpperCase(), text(item.yColumn).toUpperCase()].includes(field.column))
        .flatMap((field) => field.sourceRefs),
    }))
    : (experimentAxis === "region" ? seriesFrom(fields) : []);
  const decisionSource = text(source.decisionSource) || "user_patch";
  return {
    ...proposal,
    experimentAxis,
    headerRow,
    experimentIdColumn,
    experimentLabel,
    fields,
    series,
    inclusion,
    confidence: decisionSource === "backend_model" ? proposal.confidence : 0.98,
    decisionSource,
    warnings: asArray(proposal.warnings),
    excluded: NON_EXPERIMENT_SEMANTIC_TYPES.has(region.semanticType),
  };
}

function blockersFor(region, interpretation) {
  if (interpretation.excluded || NON_EXPERIMENT_SEMANTIC_TYPES.has(region.semanticType)) return [];
  const blockers = [];
  if (!interpretation.experimentAxis) {
    blockers.push({
      code: "experiment_axis_required",
      message: `Choose whether ${region.sheetName}!${region.range} contains one experiment per row or one experiment for the whole region.`,
      draftRegionId: region.draftRegionId,
    });
    return blockers;
  }
  if (interpretation.experimentAxis === "rows" && !interpretation.experimentIdColumn) {
    blockers.push({
      code: "experiment_identity_column_required",
      message: `Choose the experiment identity column for ${region.sheetName}!${region.range}.`,
      draftRegionId: region.draftRegionId,
    });
  }
  if (interpretation.experimentAxis === "region" && !interpretation.experimentLabel) {
    blockers.push({
      code: "experiment_label_required",
      message: `Enter the experiment label represented by ${region.sheetName}!${region.range}.`,
      draftRegionId: region.draftRegionId,
    });
  }
  const unitsBySemanticKey = new Map();
  asArray(interpretation.fields).forEach((field) => {
    const units = unitsBySemanticKey.get(field.semanticKey) || new Set();
    if (field.unit) units.add(field.unit);
    unitsBySemanticKey.set(field.semanticKey, units);
  });
  for (const [semanticKey, units] of unitsBySemanticKey.entries()) {
    if (units.size <= 1) continue;
    blockers.push({
      code: "incompatible_unit_ambiguity",
      message: `${semanticKey} has incompatible units in one interpretation: ${[...units].join(", ")}.`,
      draftRegionId: region.draftRegionId,
      semanticKey,
      units: [...units],
    });
  }
  return blockers;
}

function existingInterpretationPatch(existingFacts, draftRegionId) {
  const fact = asArray(existingFacts).find((candidate) => candidate?.draftRegionId === draftRegionId);
  if (!fact?.interpretation || !["user_patch", "user_message"].includes(fact.interpretation.decisionSource)) return null;
  return fact.interpretation;
}

export function parseInterpretationPatchFromMessage({ message, draftRegionId } = {}) {
  const input = text(message);
  if (!input) return null;
  const patch = { draftRegionId, decisionSource: "user_message" };
  if (/one experiment per row|each row (?:is|represents) (?:an? )?experiment|experiment.*per row/i.test(input)) patch.experimentAxis = "rows";
  if (/whole (?:red box|region).*experiment|one experiment (?:for|in) (?:the )?(?:red box|region)|\bthis (?:red box|region) is exp/i.test(input)) patch.experimentAxis = "region";
  const experimentLabel = experimentLabelFrom(input);
  if (experimentLabel) {
    patch.experimentLabel = experimentLabel;
    if (!patch.experimentAxis && /red box|region|rate|series/i.test(input)) patch.experimentAxis = "region";
  }
  const headerRow = input.match(/header(?: is| row is| row)?\s*(?:row\s*)?(\d+)/i);
  if (headerRow) patch.headerRow = Number(headerRow[1]);
  const identityColumn = input.match(/(?:experiment|identity|id|label)\s*column(?: is)?\s*([A-Z]{1,3})\b/i);
  if (identityColumn) {
    patch.experimentIdColumn = identityColumn[1].toUpperCase();
    patch.experimentAxis = patch.experimentAxis || "rows";
  }
  const skipRows = [...input.matchAll(/skip(?:ped)?\s+rows?\s*([0-9,\s]+)/gi)]
    .flatMap((match) => match[1].split(/[\s,]+/).map(Number).filter(Number.isInteger));
  if (skipRows.length) patch.inclusion = { skippedRows: skipRows.map((row) => ({ rowNumber: row, reason: "user_excluded" })) };
  const fieldPatches = new Map();
  for (const match of input.matchAll(/column\s+([A-Z]{1,3})\b[^.]*?\b(identifier|condition|outcome|series summary|other)\b/gi)) {
    const column = match[1].toUpperCase();
    fieldPatches.set(column, { ...(fieldPatches.get(column) || {}), column, role: match[2].toLowerCase().replace(/\s+/g, "_") });
  }
  for (const match of input.matchAll(/column\s+([A-Z]{1,3})\b[^.]*?\bunit(?:\s+is)?\s+([A-Za-z0-9_%./-]+)/gi)) {
    const column = match[1].toUpperCase();
    fieldPatches.set(column, { ...(fieldPatches.get(column) || {}), column, unit: match[2].replace(/[.,;:]+$/, "") });
  }
  if (fieldPatches.size) patch.fieldPatches = [...fieldPatches.values()];
  return Object.keys(patch).length > 2 ? patch : null;
}

export function buildWorkbookUnderstandingPreview({
  sourceDocument,
  indexBlobs = [],
  draftRegions = [],
  existingFacts = [],
  interpretationPatches = [],
  message = "",
  messageTargetDraftRegionIds = [],
} = {}) {
  const draftRegionIds = new Set(asArray(draftRegions).map((region) => text(region?.draftRegionId)).filter(Boolean));
  const explicitPatches = new Map(asArray(interpretationPatches).map((patch) => {
    const draftRegionId = text(patch?.draftRegionId);
    if (!draftRegionIds.has(draftRegionId)) {
      patchError("interpretation_patch_target_not_found", "Interpretation patches must target a current workbook red box.", { draftRegionId });
    }
    return [draftRegionId, patch];
  }));
  const messageTargets = new Set(asArray(messageTargetDraftRegionIds).map(text).filter(Boolean));
  const regions = asArray(draftRegions).map((region) => {
    const existingPatch = existingInterpretationPatch(existingFacts, region.draftRegionId);
    const messagePatch = messageTargets.has(region.draftRegionId)
      ? parseInterpretationPatchFromMessage({ message, draftRegionId: region.draftRegionId })
      : null;
    const patch = explicitPatches.get(region.draftRegionId) || messagePatch || existingPatch;
    const initialBounded = boundedInspectionRange(region.range);
    const initialRows = decodeRange(initialBounded.range);
    const correctedHeaderRow = Number(patch?.headerRow);
    const correctedHeaderOutsideInitialWindow = Number.isInteger(correctedHeaderRow)
      && correctedHeaderRow >= initialBounded.full.s.r + 1
      && correctedHeaderRow <= initialBounded.full.e.r + 1
      && (correctedHeaderRow < initialRows.s.r + 1 || correctedHeaderRow > initialRows.e.r + 1);
    const bounded = correctedHeaderOutsideInitialWindow
      ? boundedInspectionRange(region.range, { startRow: correctedHeaderRow })
      : initialBounded;
    const rangeResult = readSourceDocumentRange({
      sourceDocument,
      indexBlobs,
      sheetName: region.sheetName,
      range: bounded.range,
      maxCells: MAX_INSPECTION_CELLS,
    });
    const proposal = proposalFor({
      sourceDocument,
      region,
      rangeResult,
      fullRange: bounded.full,
      inspectionTruncated: bounded.truncated,
    });
    const interpretation = applyPatch({ sourceDocument, region, rangeResult, proposal, patch, fullRange: bounded.full });
    const blockers = blockersFor(region, interpretation);
    return {
      draftRegionId: region.draftRegionId,
      sourceRange: {
        sourceDocumentId: sourceDocument.id,
        sheetName: rangeResult.sheetName,
        range: region.range,
        inspectionRange: rangeResult.range,
        sourceRef: rangeResult.sourceRef,
      },
      inspection: rangeResult,
      interpretation,
      warnings: [...asArray(region.warnings), ...asArray(interpretation.warnings)],
      blockers,
    };
  });
  const blockers = regions.flatMap((region) => region.blockers);
  const warnings = regions.flatMap((region) => region.warnings);
  const confidences = regions.map((region) => Number(region.interpretation.confidence)).filter(Number.isFinite);
  return {
    schemaVersion: "labrat.workbookUnderstandingPreview.v1",
    sourceDocumentId: sourceDocument?.id || null,
    regions,
    blockers,
    warnings,
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
  };
}
