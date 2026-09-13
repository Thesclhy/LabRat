import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import {
  ANALYSIS_SOURCE_RANGE_MAX_CELLS,
  readSourceDocumentRange,
} from "./sourceDocuments.js";

const MAX_SOURCE_SELECTIONS = 64;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function selectionError(code, message, statusCode = 422, details = undefined) {
  return Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details === undefined ? {} : { details }),
  });
}

function workbookName(sourceDocument) {
  return text(
    sourceDocument?.originalFilename
      || sourceDocument?.filename
      || sourceDocument?.name
      || sourceDocument?.metadata?.workbookName
      || sourceDocument?.metadata?.fileName
      || sourceDocument?.metadata?.filename,
  ) || "Workbook";
}

function containsRange(outer, inner) {
  return inner.s.r >= outer.s.r
    && inner.s.c >= outer.s.c
    && inner.e.r <= outer.e.r
    && inner.e.c <= outer.e.c;
}

function canonicalRange(value) {
  try {
    return encodeRange(decodeRange(text(value)));
  } catch {
    throw selectionError(
      "analysis_source_range_invalid",
      "Every analysis source selection requires a valid Excel range.",
    );
  }
}

function activeAcceptedUnderstanding(item) {
  return item?.region?.disposition === "active"
    && item.region.acceptedRevisionId
    && item.region.acceptedRevisionId === item?.revision?.id;
}

export async function confirmedSourceRegionCatalog({ store, projectId } = {}) {
  const [accepted, sourceDocuments, identities] = await Promise.all([
    store.listAcceptedRegionUnderstandings({ projectId }),
    store.listSourceDocuments({ projectId }),
    store.listExperimentIdentities ? store.listExperimentIdentities({ projectId }) : [],
  ]);
  const sourceById = new Map(asArray(sourceDocuments).map((item) => [item.id, item]));
  const identityById = new Map(asArray(identities).map((item) => [item.id, item]));
  return asArray(accepted).filter(activeAcceptedUnderstanding).map(({ region, revision }) => {
    const interpretation = revision.interpretation || {};
    const linkedIdentity = region.linkedExperimentId ? identityById.get(region.linkedExperimentId) : null;
    return {
      regionUnderstandingRevisionId: revision.id,
      regionId: region.id,
      sourceDocumentId: region.sourceDocumentId,
      workbookName: workbookName(sourceById.get(region.sourceDocumentId)),
      sheetName: region.sheetName,
      range: canonicalRange(region.rangeRef),
      linkedExperimentId: region.linkedExperimentId || null,
      linkedExperimentLabel: linkedIdentity ? text(linkedIdentity.canonicalLabel || linkedIdentity.label) || null : null,
      dataKind: text(region.dataKind) || null,
      semanticType: text(interpretation.semanticType) || "unknown_region",
      experimentAxis: interpretation.experimentAxis || null,
      experimentLabel: interpretation.experimentLabel || null,
      experimentIdColumn: interpretation.experimentIdColumn || null,
      headerRow: Number.isInteger(Number(interpretation.headerRow))
        ? Number(interpretation.headerRow)
        : null,
      inclusion: interpretation.inclusion && typeof interpretation.inclusion === "object"
        ? structuredClone(interpretation.inclusion)
        : null,
      summary: asArray(revision.summary).map(text).filter(Boolean),
      fields: asArray(interpretation.fields).map((field) => ({
        column: text(field?.column).toUpperCase(),
        semanticKey: text(field?.semanticKey),
        displayName: text(field?.displayName || field?.semanticKey),
        role: text(field?.role) || "other",
        valueType: text(field?.valueType) || "string",
        unit: field?.unit || null,
        sourceRefs: asArray(field?.sourceRefs),
      })).filter((field) => field.column),
      series: asArray(interpretation.series).map((series) => ({
        seriesKey: text(series?.seriesKey),
        label: text(series?.label || series?.seriesKey),
        orientation: text(series?.orientation) || "column_pair",
        xColumn: text(series?.xColumn).toUpperCase(),
        yColumn: text(series?.yColumn).toUpperCase(),
        xHeaderRange: text(series?.xHeaderRange) || null,
        yValueRange: text(series?.yValueRange) || null,
        xSemanticKey: text(series?.xSemanticKey) || null,
        xUnit: series?.xUnit || null,
        yUnit: series?.yUnit || null,
        yNumericScale: series?.yNumericScale || null,
        pointCount: Number.isFinite(Number(series?.pointCount)) ? Number(series.pointCount) : null,
      })).filter((series) => series.xColumn || series.yColumn || (series.xHeaderRange && series.yValueRange)),
    };
  });
}

async function acceptedSourceContext({ store, projectId } = {}) {
  const [catalog, sourceDocuments] = await Promise.all([
    confirmedSourceRegionCatalog({ store, projectId }),
    store.listSourceDocuments({ projectId }),
  ]);
  return {
    catalog,
    catalogByRevisionId: new Map(catalog.map((item) => [
      item.regionUnderstandingRevisionId,
      item,
    ])),
    sourceById: new Map(asArray(sourceDocuments).map((item) => [item.id, item])),
  };
}

async function rangeCells({ store, projectId, sourceDocumentId, sheetName, range }) {
  const sourceDocument = await store.findSourceDocumentById(sourceDocumentId);
  if (!sourceDocument || sourceDocument.projectId !== projectId) {
    throw selectionError(
      "analysis_source_document_not_found",
      "The selected workbook is not available in this project.",
      404,
    );
  }
  const indexBlobs = await store.listSourceIndexBlobs({ sourceDocumentId });
  return readSourceDocumentRange({
    sourceDocument,
    indexBlobs,
    sheetName,
    range,
    maxCells: ANALYSIS_SOURCE_RANGE_MAX_CELLS,
    maxAllowedCells: ANALYSIS_SOURCE_RANGE_MAX_CELLS,
  });
}

export async function inspectConfirmedSourceRange({
  store,
  projectId,
  regionUnderstandingRevisionId,
  range,
} = {}) {
  const context = await acceptedSourceContext({ store, projectId });
  const region = context.catalogByRevisionId.get(text(regionUnderstandingRevisionId));
  if (!region) {
    throw selectionError(
      "analysis_confirmed_region_not_found",
      "The requested confirmed workbook region is not active.",
      404,
    );
  }
  const normalizedRange = canonicalRange(range);
  if (!containsRange(decodeRange(region.range), decodeRange(normalizedRange))) {
    throw selectionError(
      "analysis_source_range_outside_confirmed_region",
      "The requested inspection range must stay inside its confirmed workbook region.",
    );
  }
  return rangeCells({
    store,
    projectId,
    sourceDocumentId: region.sourceDocumentId,
    sheetName: region.sheetName,
    range: normalizedRange,
  });
}

export async function resolveAnalysisSourceSelections({
  store,
  projectId,
  sourceSelections = [],
} = {}) {
  const requested = asArray(sourceSelections);
  if (!requested.length) {
    throw selectionError(
      "analysis_source_selection_required",
      "The analysis plan must select at least one confirmed workbook range.",
    );
  }
  if (requested.length > MAX_SOURCE_SELECTIONS) {
    throw selectionError(
      "analysis_source_selection_limit_exceeded",
      `An analysis plan may select at most ${MAX_SOURCE_SELECTIONS} source ranges.`,
    );
  }
  const context = await acceptedSourceContext({ store, projectId });
  const seen = new Set();
  return requested.map((selection, index) => {
    const revisionId = text(selection?.regionUnderstandingRevisionId);
    const region = context.catalogByRevisionId.get(revisionId);
    if (!region) {
      throw selectionError(
        "analysis_confirmed_region_not_found",
        `Confirmed workbook region ${revisionId || index + 1} is not active.`,
        422,
        { regionUnderstandingRevisionId: revisionId || null },
      );
    }
    const range = canonicalRange(selection?.range);
    if (
      text(selection?.sourceDocumentId) !== region.sourceDocumentId
      || text(selection?.sheetName) !== region.sheetName
      || !containsRange(decodeRange(region.range), decodeRange(range))
    ) {
      throw selectionError(
        "analysis_source_selection_invalid",
        "The selected source range must match and stay inside its confirmed workbook region.",
        422,
        {
          regionUnderstandingRevisionId: revisionId,
          confirmedRange: region.range,
          requestedRange: range,
        },
      );
    }
    const uniquenessKey = `${region.sourceDocumentId}:${region.sheetName}:${range}`;
    if (seen.has(uniquenessKey)) {
      throw selectionError(
        "analysis_source_selection_duplicate",
        "The analysis plan selected the same workbook range more than once.",
      );
    }
    seen.add(uniquenessKey);
    return {
      sourceSelectionId: `source_selection_${index + 1}`,
      regionUnderstandingRevisionId: revisionId,
      sourceDocumentId: region.sourceDocumentId,
      workbookName: region.workbookName,
      sheetName: region.sheetName,
      range,
      label: text(selection?.label) || `Input ${index + 1}`,
      purpose: text(selection?.purpose) || null,
    };
  });
}

export function sourceRectanglesForSelections(sourceSelections = []) {
  return asArray(sourceSelections).map((selection) => ({
    sourceType: "excel_range",
    sourceSelectionId: selection.sourceSelectionId,
    regionUnderstandingRevisionId: selection.regionUnderstandingRevisionId,
    sourceDocumentId: selection.sourceDocumentId,
    workbookName: selection.workbookName,
    sheetName: selection.sheetName,
    sheet: selection.sheetName,
    range: selection.range,
    label: selection.label,
    purpose: selection.purpose || null,
  }));
}

function tileRanges(range) {
  const decoded = decodeRange(range);
  const ranges = [];
  for (let col = decoded.s.c; col <= decoded.e.c;) {
    const columnCount = Math.min(decoded.e.c - col + 1, ANALYSIS_SOURCE_RANGE_MAX_CELLS);
    const rowCount = Math.max(1, Math.floor(ANALYSIS_SOURCE_RANGE_MAX_CELLS / columnCount));
    const endCol = col + columnCount - 1;
    for (let row = decoded.s.r; row <= decoded.e.r; row += rowCount) {
      ranges.push(encodeRange({
        s: { r: row, c: col },
        e: { r: Math.min(decoded.e.r, row + rowCount - 1), c: endCol },
      }));
    }
    col = endCol + 1;
  }
  return ranges;
}

function sourceColumnLetter(columnIndex) {
  return encodeRange({
    s: { r: 0, c: columnIndex },
    e: { r: 0, c: columnIndex },
  }).replace(/\d+$/, "");
}

function inferredColumnType(values) {
  const populated = asArray(values).filter((value) => (
    value !== null && value !== undefined && value !== ""
  ));
  if (!populated.length) return "string";
  if (populated.every((value) => typeof value === "number" && Number.isFinite(value))) return "number";
  if (populated.every((value) => typeof value === "boolean")) return "boolean";
  return "string";
}

function sourceHeader(values, acceptedField, columnIndex, startRow, headerRow) {
  const headerOffset = Number(headerRow) - Number(startRow);
  if (Number.isInteger(headerOffset) && headerOffset >= 0 && headerOffset < values.length) {
    const headerValue = asArray(values[headerOffset])[columnIndex];
    if (typeof headerValue === "string" && text(headerValue)) return text(headerValue);
  }
  return text(acceptedField?.displayName) || null;
}

async function materializeSelection({ store, projectId, selection, region }) {
  const decoded = decodeRange(selection.range);
  const rows = decoded.e.r - decoded.s.r + 1;
  const columns = decoded.e.c - decoded.s.c + 1;
  const cellsByAddress = new Map();
  for (const range of tileRanges(selection.range)) {
    const page = await rangeCells({
      store,
      projectId,
      sourceDocumentId: selection.sourceDocumentId,
      sheetName: selection.sheetName,
      range,
    });
    asArray(page.cells).forEach((cell) => cellsByAddress.set(cell.address, cell));
  }
  const values = [];
  const displayValues = [];
  const formulas = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    const valueRow = [];
    const displayRow = [];
    const formulaRow = [];
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      const address = encodeRange({ s: { r: row, c: col }, e: { r: row, c: col } });
      const cell = cellsByAddress.get(address) || {};
      valueRow.push(cell.rawValue ?? null);
      displayRow.push(cell.formattedValue ?? cell.rawValue ?? null);
      formulaRow.push(cell.formula || null);
    }
    values.push(valueRow);
    displayValues.push(displayRow);
    formulas.push(formulaRow);
  }
  const columnMetadata = Array.from({ length: columns }, (_, columnIndex) => {
    const absoluteColumnIndex = decoded.s.c + columnIndex;
    const excelColumn = sourceColumnLetter(absoluteColumnIndex);
    const acceptedField = asArray(region?.fields)
      .find((field) => text(field?.column).toUpperCase() === excelColumn);
    const columnValues = values.map((row) => asArray(row)[columnIndex]);
    return {
      columnIndex,
      excelColumn,
      sourceHeader: sourceHeader(
        values,
        acceptedField,
        columnIndex,
        decoded.s.r + 1,
        region?.headerRow,
      ),
      valueType: text(acceptedField?.valueType).toLowerCase() || inferredColumnType(columnValues),
      unit: acceptedField?.unit || null,
      ...(acceptedField?.numericScale ? { numericScale: acceptedField.numericScale } : {}),
      headerSourceRefs: asArray(acceptedField?.sourceRefs),
    };
  });
  return {
    tableId: `table_${selection.sourceSelectionId.replace(/^source_selection_/, "")}`,
    sourceSelectionId: selection.sourceSelectionId,
    source: {
      regionUnderstandingRevisionId: selection.regionUnderstandingRevisionId,
      sourceDocumentId: selection.sourceDocumentId,
      workbookName: selection.workbookName,
      sheetName: selection.sheetName,
      range: selection.range,
    },
    startRow: decoded.s.r + 1,
    startColumn: decoded.s.c + 1,
    rowCount: rows,
    columnCount: columns,
    columns: columnMetadata,
    structure: {
      experimentAxis: region?.experimentAxis || null,
      experimentIdColumn: region?.experimentIdColumn || null,
      headerRow: region?.headerRow || null,
      inclusion: region?.inclusion || null,
      fieldMappings: asArray(region?.fields).flatMap((field) => {
        const column = columnMetadata.find((item) => item.excelColumn === field.column);
        if (!column || field.role === "identifier") return [];
        return [{
          sourceColumnIndex: column.columnIndex,
          displayName: text(field.displayName) || column.sourceHeader,
          valueType: text(field.valueType).toLowerCase() || column.valueType,
          unit: field.unit || null,
          numericScale: field.numericScale || null,
          headerSourceRefs: asArray(field.sourceRefs),
        }];
      }),
    },
    values,
    displayValues,
    formulas,
  };
}

export async function materializeAnalysisInputs({
  store,
  projectId,
  sourceSelections = [],
} = {}) {
  const selections = asArray(sourceSelections).length
    ? await resolveAnalysisSourceSelections({
      store,
      projectId,
      sourceSelections,
    })
    : [];
  const context = await acceptedSourceContext({ store, projectId });
  const tables = [];
  for (const selection of selections) {
    tables.push(await materializeSelection({
      store,
      projectId,
      selection,
      region: context.catalogByRevisionId.get(selection.regionUnderstandingRevisionId),
    }));
  }
  return {
    schemaVersion: "labrat.analysisInputs.v2",
    tables,
  };
}

export function inspectRunInput(inputs, {
  tableId,
  rowOffset = 0,
  rowLimit = 50,
  columnOffset = 0,
  columnLimit = 25,
} = {}) {
  const table = asArray(inputs?.tables).find((item) => item.tableId === text(tableId));
  if (!table) {
    throw selectionError("analysis_input_table_not_found", "The requested analysis input table was not found.", 404);
  }
  const startRow = Math.max(Number.parseInt(rowOffset, 10) || 0, 0);
  const startColumn = Math.max(Number.parseInt(columnOffset, 10) || 0, 0);
  const safeRowLimit = Math.min(Math.max(Number.parseInt(rowLimit, 10) || 50, 1), 200);
  const safeColumnLimit = Math.min(Math.max(Number.parseInt(columnLimit, 10) || 25, 1), 100);
  const projectRows = (rows) => asArray(rows).slice(startRow, startRow + safeRowLimit)
    .map((row) => asArray(row).slice(startColumn, startColumn + safeColumnLimit));
  return {
    tableId: table.tableId,
    source: table.source,
    startRow: table.startRow + startRow,
    startColumn: table.startColumn + startColumn,
    columns: asArray(table.columns).slice(startColumn, startColumn + safeColumnLimit),
    values: projectRows(table.values),
    displayValues: projectRows(table.displayValues),
    formulas: projectRows(table.formulas),
    page: {
      rowOffset: startRow,
      rowLimit: safeRowLimit,
      rowCount: table.rowCount,
      columnOffset: startColumn,
      columnLimit: safeColumnLimit,
      columnCount: table.columnCount,
    },
  };
}

export const analysisSourceSelectionLimits = Object.freeze({
  maxSelections: MAX_SOURCE_SELECTIONS,
  maxInspectionCells: ANALYSIS_SOURCE_RANGE_MAX_CELLS,
});
