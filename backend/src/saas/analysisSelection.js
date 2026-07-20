import { decodeRange, encodeRange } from "../import/utils/excelAddress.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { resolveActiveExperimentRecords } from "./experimentProjection.js";

const MAX_SCALAR_VALUES = 100_000;
const MAX_SERIES_POINTS = 1_000_000;
const MAX_SOURCE_RECTANGLE_CELLS = 100_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedUnit(value) {
  return text(value) || "unitless";
}

function normalizedType(value) {
  return text(value).toLowerCase() || "string";
}

function normalizeAlias(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function selectionError(code, message, details = {}) {
  return { code, message, ...details };
}

export function analysisFieldId({ fieldKey, unit, valueType } = {}) {
  return ["analysis_field", text(fieldKey), normalizedUnit(unit), normalizedType(valueType)]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function resolveExperimentScope({
  experimentIdentities = [],
  requestedExperimentIds = [],
  requestedAliases = [],
} = {}) {
  const identities = asArray(experimentIdentities);
  const byId = new Map(identities.map((item) => [text(item?.id), item]));
  const experimentIds = [];
  const errors = [];

  asArray(requestedExperimentIds).forEach((requestedId) => {
    const id = text(requestedId);
    if (!byId.has(id)) {
      errors.push(selectionError(
        "analysis_experiment_not_found",
        `Experiment ${id || "unknown"} was not found.`,
        { experimentId: id },
      ));
      return;
    }
    experimentIds.push(id);
  });

  asArray(requestedAliases).forEach((requestedAlias) => {
    const normalized = normalizeAlias(requestedAlias);
    const matches = identities.filter((identity) => [
      identity?.canonicalLabel,
      ...asArray(identity?.aliases),
    ].some((alias) => normalizeAlias(alias) === normalized));
    if (matches.length === 1) {
      experimentIds.push(matches[0].id);
      return;
    }
    errors.push(selectionError(
      matches.length
        ? "analysis_experiment_alias_ambiguous"
        : "analysis_experiment_alias_not_found",
      matches.length
        ? `Experiment alias ${requestedAlias} matches more than one experiment.`
        : `Experiment alias ${requestedAlias} was not found.`,
      {
        alias: requestedAlias,
        candidateExperimentIds: matches.map((item) => item.id),
      },
    ));
  });

  return {
    ok: errors.length === 0,
    experimentIds: [...new Set(experimentIds)],
    errors,
  };
}

function sourceCells(sourceRef, budget) {
  const ref = sourceRef || {};
  const range = text(ref.range || ref.cell);
  if (!text(ref.sourceDocumentId) || !text(ref.sheet) || !range) return [];
  let decoded;
  try {
    decoded = decodeRange(range);
  } catch {
    return [];
  }
  const cellCount = (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
  if (cellCount > budget.remaining) {
    throw Object.assign(new Error(
      `Analysis source rectangles contain more than ${MAX_SOURCE_RECTANGLE_CELLS} cells.`,
    ), {
      statusCode: 413,
      code: "analysis_source_rectangle_limit_exceeded",
      details: {
        maxCells: MAX_SOURCE_RECTANGLE_CELLS,
        requestedCellCount: budget.used + cellCount,
      },
    });
  }
  budget.remaining -= cellCount;
  budget.used += cellCount;
  const cells = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      cells.push({
        sourceDocumentId: text(ref.sourceDocumentId),
        fileObjectId: ref.fileObjectId || null,
        sheet: text(ref.sheet),
        row,
        col,
      });
    }
  }
  return cells;
}

function rowRuns(cells) {
  const byRow = new Map();
  cells.forEach((cell) => {
    const cols = byRow.get(cell.row) || [];
    cols.push(cell.col);
    byRow.set(cell.row, cols);
  });
  return [...byRow.entries()].sort(([left], [right]) => left - right).flatMap(([row, values]) => {
    const cols = [...new Set(values)].sort((left, right) => left - right);
    const runs = [];
    let start = null;
    let end = null;
    cols.forEach((col) => {
      if (start == null) {
        start = col;
        end = col;
      } else if (col === end + 1) {
        end = col;
      } else {
        runs.push({ startRow: row, endRow: row, startCol: start, endCol: end });
        start = col;
        end = col;
      }
    });
    if (start != null) runs.push({ startRow: row, endRow: row, startCol: start, endCol: end });
    return runs;
  });
}

function mergeVerticalRuns(runs) {
  const rectangles = [];
  runs.forEach((run) => {
    const prior = rectangles.find((rectangle) => (
      rectangle.endRow + 1 === run.startRow
      && rectangle.startCol === run.startCol
      && rectangle.endCol === run.endCol
    ));
    if (prior) prior.endRow = run.endRow;
    else rectangles.push({ ...run });
  });
  return rectangles;
}

export function compressSourceRefsToRectangles(sourceRefs = []) {
  const groups = new Map();
  const budget = { used: 0, remaining: MAX_SOURCE_RECTANGLE_CELLS };
  asArray(sourceRefs).flatMap((sourceRef) => sourceCells(sourceRef, budget)).forEach((cell) => {
    const key = `${cell.sourceDocumentId}\u0000${cell.sheet}`;
    const group = groups.get(key) || {
      sourceDocumentId: cell.sourceDocumentId,
      fileObjectId: cell.fileObjectId,
      sheet: cell.sheet,
      cells: [],
    };
    group.cells.push(cell);
    groups.set(key, group);
  });

  return [...groups.values()].flatMap((group) => (
    mergeVerticalRuns(rowRuns(group.cells)).map((rectangle) => ({
      sourceType: "excel_range",
      sourceDocumentId: group.sourceDocumentId,
      fileObjectId: group.fileObjectId,
      sheet: group.sheet,
      range: encodeRange({
        s: { r: rectangle.startRow, c: rectangle.startCol },
        e: { r: rectangle.endRow, c: rectangle.endCol },
      }),
      startRow: rectangle.startRow,
      endRow: rectangle.endRow,
      startCol: rectangle.startCol,
      endCol: rectangle.endCol,
      cellCount: (rectangle.endRow - rectangle.startRow + 1)
        * (rectangle.endCol - rectangle.startCol + 1),
    }))
  )).sort((left, right) => (
    left.sourceDocumentId.localeCompare(right.sourceDocumentId)
    || left.sheet.localeCompare(right.sheet)
    || left.startRow - right.startRow
    || left.startCol - right.startCol
  ));
}

function buildFieldCatalog(entries) {
  const stats = new Map();
  entries.forEach(({ record }) => {
    const seenInRecord = new Set();
    asArray(record?.fields).forEach((field) => {
      const fieldId = analysisFieldId(field);
      const current = stats.get(fieldId) || {
        fieldId,
        fieldKey: text(field.fieldKey),
        displayName: text(field.displayName || field.fieldKey),
        valueType: normalizedType(field.valueType),
        unit: field.unit || null,
        role: text(field.role) || "other",
        available: 0,
        warningCount: 0,
      };
      if (!seenInRecord.has(fieldId) && field.value !== null && field.value !== undefined && field.value !== "") {
        current.available += 1;
      }
      current.warningCount += asArray(field.warnings).length;
      seenInRecord.add(fieldId);
      stats.set(fieldId, current);
    });
  });
  return [...stats.values()].map((item) => ({
    fieldId: item.fieldId,
    fieldKey: item.fieldKey,
    displayName: item.displayName,
    valueType: item.valueType,
    unit: item.unit,
    role: item.role,
    coverage: {
      available: item.available,
      totalExperiments: entries.length,
    },
    warningCount: item.warningCount,
  })).sort((left, right) => (
    left.displayName.localeCompare(right.displayName)
    || normalizedUnit(left.unit).localeCompare(normalizedUnit(right.unit))
    || left.fieldId.localeCompare(right.fieldId)
  ));
}

function selectedEntries(entries, experimentIds) {
  if (!experimentIds.length) return entries;
  const selected = new Set(experimentIds);
  return entries.filter(({ identity }) => selected.has(identity.id));
}

export function resolveAnalysisSelection({
  projectId,
  dataSnapshots = [],
  experimentIdentities = [],
  experimentSnapshotHeads = [],
  selectionRequest = {},
} = {}) {
  const allEntries = resolveActiveExperimentRecords({
    projectId,
    dataSnapshots,
    experimentIdentities,
    experimentSnapshotHeads,
  });
  const scope = resolveExperimentScope({
    experimentIdentities: allEntries.map(({ identity }) => identity),
    requestedExperimentIds: selectionRequest.experimentIds,
    requestedAliases: selectionRequest.experimentAliases,
  });
  if (!scope.ok) {
    return {
      schemaVersion: "labrat.analysisSelection.v1",
      ok: false,
      projectId,
      experimentIds: [],
      fieldCatalog: buildFieldCatalog(allEntries),
      records: [],
      sourceRectangles: [],
      coverage: { fields: {} },
      warnings: [],
      errors: scope.errors,
    };
  }
  const entries = selectedEntries(allEntries, scope.experimentIds);
  const fieldCatalog = buildFieldCatalog(allEntries);
  const requestedFieldIds = asArray(selectionRequest.fieldIds).map(text).filter(Boolean);
  const selectedFieldIds = requestedFieldIds.length
    ? new Set(requestedFieldIds)
    : new Set(fieldCatalog.map((item) => item.fieldId));
  const unknownFieldIds = [...selectedFieldIds].filter((fieldId) => !fieldCatalog.some((item) => item.fieldId === fieldId));
  const includeSeries = selectionRequest.includeSeries === true;
  const records = entries.map(({ head, snapshot, identity, record }) => ({
    experimentId: identity.id,
    experimentLabel: identity.canonicalLabel || record.label || identity.id,
    snapshotId: snapshot.id,
    headId: head.id,
    recordIndex: Number(head.recordIndex),
    fields: asArray(record.fields).flatMap((field) => (
      selectedFieldIds.has(analysisFieldId(field))
        ? [{
          ...clone(field),
          fieldId: analysisFieldId(field),
        }]
        : []
    )),
    series: includeSeries ? clone(asArray(record.series)) : [],
  }));

  const scalarCount = records.reduce((total, record) => total + record.fields.length, 0);
  const seriesPointCount = records.reduce((total, record) => (
    total + record.series.reduce((seriesTotal, series) => seriesTotal + asArray(series.points).length, 0)
  ), 0);
  const errors = unknownFieldIds.map((fieldId) => selectionError(
    "analysis_field_not_found",
    `Analysis field ${fieldId} was not found in active accepted records.`,
    { fieldId },
  ));
  if (scalarCount > MAX_SCALAR_VALUES) {
    errors.push(selectionError(
      "analysis_scalar_limit_exceeded",
      `Analysis selection contains ${scalarCount} scalar values; maximum is ${MAX_SCALAR_VALUES}.`,
    ));
  }
  if (seriesPointCount > MAX_SERIES_POINTS) {
    errors.push(selectionError(
      "analysis_series_limit_exceeded",
      `Analysis selection contains ${seriesPointCount} series points; maximum is ${MAX_SERIES_POINTS}.`,
    ));
  }

  const sourceRefs = records.flatMap((record) => [
    ...record.fields.flatMap((field) => asArray(field.sourceRefs)),
    ...record.series.flatMap((series) => [
      ...asArray(series.sourceRefs),
      ...asArray(series.points).flatMap((point) => asArray(point.sourceRefs)),
    ]),
  ]);
  const sourceRectangles = compressSourceRefsToRectangles(sourceRefs);
  const dependencyPayload = records.map((record) => {
    const entry = entries.find(({ identity }) => identity.id === record.experimentId);
    return {
      experimentId: record.experimentId,
      headId: record.headId,
      snapshotId: record.snapshotId,
      recordIndex: record.recordIndex,
      contentHash: entry?.snapshot?.contentHash || null,
      dependencyHash: entry?.snapshot?.dependencyHash || null,
    };
  });
  const dependencyHash = stableDataHash(dependencyPayload);
  const selectionHash = stableDataHash({
    dependencyHash,
    records,
    sourceRectangles,
  });
  const coverageFields = Object.fromEntries([...selectedFieldIds].map((fieldId) => {
    const available = records.filter((record) => record.fields.some((field) => (
      field.fieldId === fieldId && field.value !== null && field.value !== undefined && field.value !== ""
    ))).length;
    return [fieldId, {
      available,
      missing: records.length - available,
      totalExperiments: records.length,
    }];
  }));

  return {
    schemaVersion: "labrat.analysisSelection.v1",
    ok: errors.length === 0,
    selectionId: `analysis_selection_${selectionHash.replace(/^sha256_/, "").slice(0, 24)}`,
    projectId,
    experimentIds: records.map((record) => record.experimentId),
    fieldIds: [...selectedFieldIds],
    fieldCatalog,
    records,
    sourceRectangles,
    dependencyHash,
    selectionHash,
    coverage: {
      fields: coverageFields,
      scalarCount,
      seriesPointCount,
    },
    warnings: [],
    errors,
  };
}
