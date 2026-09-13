import * as XLSX from "xlsx";
import { linkedRegionSummaries } from "./experimentProjection.js";
import { ANALYSIS_SOURCE_RANGE_MAX_CELLS, readSourceDocumentRange } from "./sourceDocuments.js";

export const LINKED_SERIES_SCHEMA_VERSION = "labrat.linkedRegionSeries.v1";
const EXCEL_ERROR_PATTERN = /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!|ERROR)$/;
const NUMERIC_TEXT_PATTERN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?%?$/;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function fail(code, message, statusCode = 400, details = {}) {
  throw Object.assign(new Error(message), { code, statusCode, details });
}

export function normalizeDataKind(value) {
  return text(value).toLowerCase();
}

export function identityLabel(identity, fallback) {
  return text(identity?.canonicalLabel || identity?.label) || fallback;
}

export function seriesSummary(series) {
  return {
    seriesKey: text(series?.seriesKey) || null,
    label: text(series?.label || series?.seriesKey) || null,
    orientation: text(series?.orientation) || "column_pair",
    xHeaderRange: text(series?.xHeaderRange) || null,
    yValueRange: text(series?.yValueRange) || null,
    xColumn: text(series?.xColumn) || null,
    yColumn: text(series?.yColumn) || null,
    xSemanticKey: text(series?.xSemanticKey) || null,
    xValueType: text(series?.xValueType) || null,
    xUnit: series?.xUnit || null,
    yUnit: series?.yUnit || null,
    yNumericScale: series?.yNumericScale || null,
    pointCount: Number.isFinite(Number(series?.pointCount)) ? Number(series.pointCount) : null,
  };
}

/**
 * Chooses the series a template or application refers to inside a region
 * that may define several (for example a "C-Response" row and an "Area" row
 * under one header). Without a selector only a single-series region is
 * unambiguous. With one, seriesKey wins, then label, then y semantic key.
 */
export function selectRegionSeries(seriesList, selector = null) {
  const list = Array.isArray(seriesList) ? seriesList.filter(Boolean) : [];
  if (!selector || typeof selector !== "object") return list.length === 1 ? list[0] : null;
  const key = text(selector.seriesKey).toLowerCase();
  const label = text(selector.label).toLowerCase();
  const semantic = text(selector.ySemanticKey).toLowerCase();
  const byKey = key ? list.filter((item) => text(item?.seriesKey).toLowerCase() === key) : [];
  if (byKey.length === 1) return byKey[0];
  const byLabel = label ? list.filter((item) => text(item?.label).toLowerCase() === label) : [];
  if (byLabel.length === 1) return byLabel[0];
  const bySemantic = semantic ? list.filter((item) => text(item?.ySemanticKey).toLowerCase() === semantic) : [];
  if (bySemantic.length === 1) return bySemantic[0];
  return list.length === 1 && !key && !label && !semantic ? list[0] : null;
}

export function seriesSelectorOf(series) {
  return {
    seriesKey: text(series?.seriesKey) || null,
    label: text(series?.label) || null,
    ySemanticKey: text(series?.ySemanticKey) || null,
  };
}

/**
 * Loads every accepted, experiment-linked region of a project once, with its
 * series definitions, the project's experiment identities, and the linked
 * regions that were logically deleted (so a vanished workbook can be reported
 * as such rather than as "never had the data").
 */
export async function loadLinkedRegionContext({ store, projectId } = {}) {
  const [accepted, sourceDocuments, identities, allRegions] = await Promise.all([
    store.listAcceptedRegionUnderstandings({ projectId }),
    store.listSourceDocuments ? store.listSourceDocuments({ projectId }) : [],
    store.listExperimentIdentities ? store.listExperimentIdentities({ projectId }) : [],
    store.listWorkbookReviewRegions ? store.listWorkbookReviewRegions({ projectId, includeDeleted: true }) : [],
  ]);
  const revisionById = new Map(asArray(accepted).map(({ revision }) => [revision.id, revision]));
  const linked = linkedRegionSummaries({ acceptedRegionUnderstandings: accepted, sourceDocuments }).map((item) => {
    const revision = revisionById.get(item.revisionId);
    return {
      ...item,
      headerRow: Number.isInteger(Number(revision?.interpretation?.headerRow)) ? Number(revision.interpretation.headerRow) : null,
      inclusion: revision?.interpretation?.inclusion && typeof revision.interpretation.inclusion === "object"
        ? { startRow: Number(revision.interpretation.inclusion.startRow) || null, endRow: Number(revision.interpretation.inclusion.endRow) || null }
        : null,
      series: asArray(revision?.interpretation?.series).map(seriesSummary),
    };
  });
  const deletedLinked = asArray(allRegions)
    .filter((region) => region?.disposition === "deleted" && region.linkedExperimentId && text(region.dataKind))
    .map((region) => ({ experimentId: region.linkedExperimentId, dataKind: text(region.dataKind), regionId: region.id }));
  return {
    linked,
    identities: asArray(identities),
    identityById: new Map(asArray(identities).map((identity) => [identity.id, identity])),
    deletedLinked,
  };
}

export function pickLinkedRegion(regions) {
  // Most recently confirmed wins; ties (same batch, same millisecond) fall back
  // to the most recently created region, then to a stable id order.
  return [...regions].sort((a, b) => (
    String(b.acceptedAt || "").localeCompare(String(a.acceptedAt || ""))
    || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    || b.regionId.localeCompare(a.regionId)
  ))[0];
}

/**
 * Resolves, for one data kind, the region each requested experiment should
 * use. Shared by the Compare linked data picker and by reusable template
 * applications so both follow the same rule.
 */
export async function resolveLinkedRegionsForExperiments({ store, projectId, dataKind, experimentIds = [], context = null } = {}) {
  const wantedKind = normalizeDataKind(dataKind);
  if (!wantedKind) fail("linked_data_kind_required", "Choose a data kind to compare.");
  const resolvedContext = context || await loadLinkedRegionContext({ store, projectId });
  const kindRegions = resolvedContext.linked.filter((item) => normalizeDataKind(item.dataKind) === wantedKind);
  const experiments = [];
  const missingExperiments = [];
  const unknownExperimentIds = [];
  for (const experimentId of [...new Set(asArray(experimentIds).map(text).filter(Boolean))]) {
    const identity = resolvedContext.identityById.get(experimentId);
    if (!identity) {
      unknownExperimentIds.push(experimentId);
      continue;
    }
    const label = identityLabel(identity, experimentId);
    const regions = kindRegions.filter((item) => item.linkedExperimentId === experimentId);
    if (!regions.length) {
      const deleted = resolvedContext.deletedLinked.some((item) => item.experimentId === experimentId && normalizeDataKind(item.dataKind) === wantedKind);
      missingExperiments.push({ experimentId, label, reason: deleted ? "session_deleted" : "missing_data_kind" });
      continue;
    }
    const region = pickLinkedRegion(regions);
    experiments.push({
      experimentId,
      label,
      regionId: region.regionId,
      revisionId: region.revisionId,
      sourceDocumentId: region.sourceDocumentId,
      workbookReviewSessionId: region.workbookReviewSessionId,
      workbookName: region.workbookName,
      sheetName: region.sheetName,
      range: region.range,
      headerRow: region.headerRow,
      inclusion: region.inclusion,
      series: region.series,
      alternativeRegionIds: regions.filter((item) => item.regionId !== region.regionId).map((item) => item.regionId),
    });
  }
  return {
    dataKind: kindRegions[0]?.dataKind || text(dataKind),
    kindFound: kindRegions.length > 0,
    experiments,
    missingExperiments,
    unknownExperimentIds,
    context: resolvedContext,
  };
}

function isErrorCell(cell) {
  if (!cell) return false;
  if (cell.type === "error") return true;
  return EXCEL_ERROR_PATTERN.test(text(cell.formattedValue));
}

function numericValue(cell) {
  if (!cell) return { value: null, missingReason: "blank" };
  if (isErrorCell(cell)) return { value: null, missingReason: "excel_error" };
  const raw = cell.rawValue;
  if (raw == null || raw === "") return { value: null, missingReason: "blank" };
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw, missingReason: null } : { value: null, missingReason: "non_numeric" };
  const candidate = text(raw).replace(/,/g, "");
  if (NUMERIC_TEXT_PATTERN.test(candidate)) {
    const parsed = Number(candidate.replace(/%$/, ""));
    if (Number.isFinite(parsed)) return { value: parsed, missingReason: null };
  }
  return { value: null, missingReason: "non_numeric" };
}

function labelValue(cell) {
  const value = text(cell?.formattedValue ?? cell?.rawValue);
  return value || null;
}

function decode(range) {
  return XLSX.utils.decode_range(String(range || "").toUpperCase().replace(/\$/g, ""));
}

function contains(outer, inner) {
  return inner.s.r >= outer.s.r && inner.e.r <= outer.e.r && inner.s.c >= outer.s.c && inner.e.c <= outer.e.c;
}

async function readRange({ store, projectId, region, range, maxCells }) {
  const sourceDocument = await store.findSourceDocumentById(region.sourceDocumentId);
  if (!sourceDocument || sourceDocument.projectId !== projectId) {
    fail("chart_template_source_document_missing", "The linked workbook is no longer available in this project.", 404, { sourceDocumentId: region.sourceDocumentId });
  }
  const indexBlobs = await store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id });
  try {
    return readSourceDocumentRange({ sourceDocument, indexBlobs, sheetName: region.sheetName, range, maxCells, maxAllowedCells: maxCells });
  } catch (error) {
    if (error?.code === "source_range_too_large") {
      fail("chart_template_range_too_large", `The linked series range ${range} is larger than the ${maxCells}-cell limit.`, 422, { range, maxCells });
    }
    throw error;
  }
}

function rangeRef(region, sourceDocument, range) {
  return {
    sourceType: "excel_range",
    sourceDocumentId: region.sourceDocumentId,
    fileObjectId: sourceDocument?.fileObjectId || null,
    sheet: region.sheetName,
    range,
  };
}

/**
 * Reads one experiment's series points straight from its confirmed region,
 * using the accepted series definition. Values are the workbook's cached
 * results; blanks, text, and Excel errors are missing points with a reason.
 * Nothing outside the region is read and no formula is evaluated.
 */
export async function readLinkedRegionSeries({
  store,
  projectId,
  region,
  series,
  headerRow = null,
  inclusion = null,
  maxCells = ANALYSIS_SOURCE_RANGE_MAX_CELLS,
} = {}) {
  const definition = seriesSummary(series);
  const regionRange = decode(region?.range);
  const points = [];
  const sourceRefs = [];
  let cellCount = 0;
  if (definition.orientation === "header_row_categories") {
    if (!definition.xHeaderRange || !definition.yValueRange) {
      fail("chart_template_series_shape_mismatch", "The linked series definition has no header and value ranges.", 422);
    }
    const header = decode(definition.xHeaderRange);
    const values = decode(definition.yValueRange);
    if (!contains(regionRange, header) || !contains(regionRange, values)) {
      fail("chart_template_series_outside_region", "The linked series ranges must stay inside the confirmed region.", 422);
    }
    if (header.s.r !== header.e.r || values.s.r !== values.e.r || header.s.c !== values.s.c || header.e.c !== values.e.c) {
      fail("chart_template_series_shape_mismatch", "Header-row series need one header row and one value row over the same columns.", 422);
    }
    const headerCells = await readRange({ store, projectId, region, range: definition.xHeaderRange, maxCells });
    const valueCells = await readRange({ store, projectId, region, range: definition.yValueRange, maxCells });
    cellCount = headerCells.cellCount + valueCells.cellCount;
    headerCells.cells.forEach((headerCell, index) => {
      const valueCell = valueCells.cells[index];
      const label = labelValue(headerCell);
      const y = numericValue(valueCell);
      const missingReason = !label ? "blank_label" : y.missingReason;
      points.push({
        index,
        x: label,
        y: missingReason ? null : y.value,
        xCell: headerCell.address,
        yCell: valueCell?.address || null,
        missing: Boolean(missingReason),
        missingReason: missingReason || null,
      });
    });
    const sourceDocument = await store.findSourceDocumentById(region.sourceDocumentId);
    sourceRefs.push(rangeRef(region, sourceDocument, headerCells.range), rangeRef(region, sourceDocument, valueCells.range));
  } else {
    if (!definition.xColumn || !definition.yColumn) {
      fail("chart_template_series_shape_mismatch", "The linked series definition has no x and y columns.", 422);
    }
    const startRow = Number(inclusion?.startRow) || (Number.isInteger(headerRow) ? headerRow + 1 : regionRange.s.r + 2);
    const endRow = Number(inclusion?.endRow) || regionRange.e.r + 1;
    const xRange = `${definition.xColumn}${startRow}:${definition.xColumn}${endRow}`;
    const yRange = `${definition.yColumn}${startRow}:${definition.yColumn}${endRow}`;
    if (!contains(regionRange, decode(xRange)) || !contains(regionRange, decode(yRange))) {
      fail("chart_template_series_outside_region", "The linked series columns must stay inside the confirmed region.", 422);
    }
    const xCells = await readRange({ store, projectId, region, range: xRange, maxCells });
    const yCells = await readRange({ store, projectId, region, range: yRange, maxCells });
    cellCount = xCells.cellCount + yCells.cellCount;
    xCells.cells.forEach((xCell, index) => {
      const yCell = yCells.cells[index];
      const x = numericValue(xCell);
      const y = numericValue(yCell);
      const missingReason = x.missingReason ? `x_${x.missingReason}` : y.missingReason;
      points.push({
        index,
        x: x.missingReason ? null : x.value,
        y: missingReason ? null : y.value,
        xCell: xCell.address,
        yCell: yCell?.address || null,
        missing: Boolean(missingReason),
        missingReason: missingReason || null,
      });
    });
    const sourceDocument = await store.findSourceDocumentById(region.sourceDocumentId);
    sourceRefs.push(rangeRef(region, sourceDocument, xCells.range), rangeRef(region, sourceDocument, yCells.range));
  }
  const valueCount = points.filter((point) => !point.missing).length;
  return {
    schemaVersion: LINKED_SERIES_SCHEMA_VERSION,
    orientation: definition.orientation,
    seriesKey: definition.seriesKey,
    label: definition.label,
    xMeaning: definition.xSemanticKey,
    xValueType: definition.xValueType,
    yUnit: definition.yUnit,
    yNumericScale: definition.yNumericScale,
    points,
    xLabels: points.map((point) => point.x),
    pointCount: points.length,
    valueCount,
    missingCount: points.length - valueCount,
    cellCount,
    sourceRefs,
  };
}
