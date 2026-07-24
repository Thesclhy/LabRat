import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import {
  ANALYSIS_SOURCE_RANGE_MAX_CELLS,
  readSourceDocumentRange,
} from "./sourceDocuments.js";
import {
  ANALYSIS_FIELD_ROLES,
  ANALYSIS_VALUE_TYPES,
} from "./analysisSchemas.js";
import { experimentFieldColumnId } from "./experimentProjection.js";

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

function normalizedUnit(value) {
  return text(value) || "unitless";
}

function normalizedType(value) {
  return text(value).toLowerCase() || "string";
}

function normalizedAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function columnIndex(column) {
  const token = text(column).toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(token)) {
    throw selectionError(
      "analysis_field_target_column_invalid",
      "A source field target requires a valid Excel column.",
    );
  }
  return decodeRange(`${token}1`).s.c;
}

function rangeContainsColumn(range, column) {
  const decoded = decodeRange(range);
  const index = columnIndex(column);
  return index >= decoded.s.c && index <= decoded.e.c;
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
  const [accepted, sourceDocuments] = await Promise.all([
    store.listAcceptedRegionUnderstandings({ projectId }),
    store.listSourceDocuments({ projectId }),
  ]);
  const sourceById = new Map(asArray(sourceDocuments).map((item) => [item.id, item]));
  return asArray(accepted).filter(activeAcceptedUnderstanding).map(({ region, revision }) => {
    const interpretation = revision.interpretation || {};
    return {
      regionUnderstandingRevisionId: revision.id,
      regionId: region.id,
      sourceDocumentId: region.sourceDocumentId,
      workbookName: workbookName(sourceById.get(region.sourceDocumentId)),
      sheetName: region.sheetName,
      range: canonicalRange(region.rangeRef),
      semanticType: text(interpretation.semanticType) || "unknown_region",
      experimentAxis: interpretation.experimentAxis || null,
      experimentLabel: interpretation.experimentLabel || null,
      experimentIdColumn: interpretation.experimentIdColumn || null,
      headerRow: Number.isInteger(Number(interpretation.headerRow))
        ? Number(interpretation.headerRow)
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
        xColumn: text(series?.xColumn).toUpperCase(),
        yColumn: text(series?.yColumn).toUpperCase(),
        xUnit: series?.xUnit || null,
        yUnit: series?.yUnit || null,
      })).filter((series) => series.xColumn || series.yColumn),
    };
  });
}

export function sourceFieldCandidatesForRequest({
  originalRequest,
  confirmedRegions = [],
} = {}) {
  const request = text(originalRequest);
  const normalizedRequest = normalizedAlias(request);
  const explicitColumns = [...request.matchAll(/\bcolumn\s+([a-z]{1,3})\b/gi)]
    .map((match) => match[1].toUpperCase());
  const ignoredAliases = new Set(["experiment", "experimentid", "id", "label"]);
  const candidates = [];
  asArray(confirmedRegions).forEach((region) => {
    asArray(region?.fields).forEach((field) => {
      const aliases = [
        normalizedAlias(field.semanticKey),
        normalizedAlias(field.displayName),
      ].filter((alias) => alias.length >= 3 && !ignoredAliases.has(alias));
      let matchReason = null;
      if (explicitColumns.includes(text(field.column).toUpperCase())) {
        matchReason = "explicit_column";
      } else if (aliases.some((alias) => normalizedRequest.includes(alias))) {
        matchReason = "field_name";
      }
      if (!matchReason) return;
      candidates.push({
        regionUnderstandingRevisionId: region.regionUnderstandingRevisionId,
        sourceDocumentId: region.sourceDocumentId,
        workbookName: region.workbookName,
        sheetName: region.sheetName,
        confirmedRange: region.range,
        column: field.column,
        semanticKey: field.semanticKey,
        displayName: field.displayName,
        role: field.role,
        valueType: field.valueType,
        unit: field.unit,
        matchReason,
      });
    });
  });
  return candidates;
}

export async function resolveAnalysisFieldTargets({
  store,
  projectId,
  fieldTargets = [],
  sourceSelections = [],
  existingFieldCatalog = [],
} = {}) {
  const requested = asArray(fieldTargets);
  if (!requested.length) return [];
  const context = await acceptedSourceContext({ store, projectId });
  const roleSet = new Set(ANALYSIS_FIELD_ROLES);
  const valueTypeSet = new Set(ANALYSIS_VALUE_TYPES);
  const existingFields = asArray(existingFieldCatalog);
  const selectedSourceFields = asArray(sourceSelections).flatMap((selection) => {
    const region = context.catalogByRevisionId.get(selection.regionUnderstandingRevisionId);
    if (!region) return [];
    return asArray(region.fields)
      .filter((field) => rangeContainsColumn(selection.range, field.column))
      .map((field) => ({ region, field, selection }));
  });
  const seen = new Set();
  return requested.map((target, index) => {
    const kind = text(target?.kind);
    let definition;
    let sourceField = null;
    if (kind === "source_field") {
      const requestedRevisionId = text(target?.regionUnderstandingRevisionId);
      const column = text(target?.column).toUpperCase();
      const fieldAlias = normalizedAlias(target?.fieldKey);
      const displayAlias = normalizedAlias(target?.displayName);
      let matches = selectedSourceFields.filter(({ region, field }) => (
        region.regionUnderstandingRevisionId === requestedRevisionId
        && field.column === column
      ));
      if (matches.length !== 1 && column) {
        matches = selectedSourceFields.filter(({ field }) => field.column === column);
      }
      if (matches.length !== 1 && (fieldAlias || displayAlias)) {
        matches = selectedSourceFields.filter(({ field }) => {
          const aliases = new Set([
            normalizedAlias(field.semanticKey),
            normalizedAlias(field.displayName),
          ]);
          return (fieldAlias && aliases.has(fieldAlias))
            || (displayAlias && aliases.has(displayAlias));
        });
      }
      if (matches.length !== 1) {
        throw selectionError(
          "analysis_source_field_target_invalid",
          matches.length > 1
            ? "A source field target matched multiple confirmed fields inside the accepted source selections."
            : "A source field target must reference one confirmed field inside an accepted source selection.",
          422,
          {
            targetIndex: index,
            regionUnderstandingRevisionId: requestedRevisionId || null,
            column: column || null,
            fieldKey: text(target?.fieldKey) || null,
            displayName: text(target?.displayName) || null,
            matchCount: matches.length,
            selectedFields: selectedSourceFields.slice(0, 20).map(({ region, field }) => ({
              regionUnderstandingRevisionId: region.regionUnderstandingRevisionId,
              column: field.column,
              fieldKey: field.semanticKey,
              displayName: field.displayName,
            })),
          },
        );
      }
      const [{ region, field, selection }] = matches;
      const revisionId = region.regionUnderstandingRevisionId;
      const resolvedColumn = field.column;
      if (
        field.role === "identifier"
        || ["label", "experiment", "experimentid", "experimentlabel"]
          .includes(normalizedAlias(field.semanticKey))
      ) {
        throw selectionError(
          "analysis_identity_field_target_invalid",
          "Experiment identity is used to match records and cannot be published as a duplicate scientific field.",
          422,
          { targetIndex: index, column: resolvedColumn, fieldKey: field.semanticKey },
        );
      }
      definition = {
        fieldKey: field.semanticKey,
        displayName: field.displayName,
        role: field.role,
        valueType: normalizedType(field.valueType),
        unit: field.unit || null,
      };
      sourceField = {
        regionUnderstandingRevisionId: revisionId,
        sourceSelectionId: selection.sourceSelectionId,
        sourceDocumentId: region.sourceDocumentId,
        workbookName: region.workbookName,
        sheetName: region.sheetName,
        column: resolvedColumn,
        columnOffset: columnIndex(resolvedColumn) - decodeRange(selection.range).s.c,
        headerSourceRefs: asArray(field.sourceRefs),
      };
    } else if (kind === "derived_field") {
      definition = {
        fieldKey: text(target?.fieldKey),
        displayName: text(target?.displayName || target?.fieldKey),
        role: text(target?.role),
        valueType: normalizedType(target?.valueType),
        unit: text(target?.unit) || null,
      };
    } else {
      throw selectionError(
        "analysis_field_target_kind_invalid",
        "A field target kind must be source_field or derived_field.",
        422,
        { targetIndex: index, kind: kind || null },
      );
    }
    if (
      !definition.fieldKey
      || !definition.displayName
      || !roleSet.has(definition.role)
      || !valueTypeSet.has(definition.valueType)
    ) {
      throw selectionError(
        "analysis_field_target_definition_invalid",
        "A derived field target requires a stable key, readable name, supported role, and supported value type.",
        422,
        {
          targetIndex: index,
          role: definition.role || null,
          valueType: definition.valueType || null,
          allowedRoles: ANALYSIS_FIELD_ROLES,
          allowedValueTypes: ANALYSIS_VALUE_TYPES,
        },
      );
    }
    const selector = `${definition.fieldKey}|${normalizedUnit(definition.unit)}|${definition.valueType}`;
    if (seen.has(selector)) {
      throw selectionError(
        "analysis_field_target_duplicate",
        "The same field key, unit, and value type may appear only once in one plan revision.",
        422,
        { targetIndex: index, fieldKey: definition.fieldKey },
      );
    }
    seen.add(selector);
    const semanticMatches = existingFields.filter((field) => (
      text(field?.fieldKey) === definition.fieldKey
      && normalizedUnit(field?.unit) === normalizedUnit(definition.unit)
    ));
    const existing = semanticMatches.find((field) => (
      normalizedType(field?.valueType) === definition.valueType
    ));
    if (!existing && semanticMatches.length) {
      throw selectionError(
        "analysis_field_target_type_conflict",
        "A field with the same stable key and unit already exists with another value type.",
        422,
        {
          targetIndex: index,
          fieldKey: definition.fieldKey,
          unit: definition.unit,
          existingTypes: [...new Set(semanticMatches.map((field) => normalizedType(field.valueType)))],
          requestedType: definition.valueType,
        },
      );
    }
    return {
      targetFieldId: `target_field_${index + 1}`,
      kind,
      ...definition,
      description: text(target?.description) || definition.displayName,
      existingColumnId: existing?.columnId || null,
      columnId: existing?.columnId || experimentFieldColumnId(definition),
      sourceField,
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

async function materializeSelection({ store, projectId, selection }) {
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
  const tables = [];
  for (const selection of selections) {
    tables.push(await materializeSelection({ store, projectId, selection }));
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
