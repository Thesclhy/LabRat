import { stableDataHash } from "./dataPlanSchemas.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const RECOMMENDED_FIELD_LIMIT = 8;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizedUnit(value) {
  return text(value) || "unitless";
}

function normalizedType(value) {
  return text(value).toLowerCase() || "string";
}

export function experimentFieldColumnId({ fieldKey, unit, valueType } = {}) {
  return ["field", text(fieldKey), normalizedUnit(unit), normalizedType(valueType)]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function columnLabel(field) {
  const displayName = text(field.displayName || field.fieldKey) || "Untitled field";
  const parentheticalUnit = displayName.match(/\(([^()]*)\)\s*$/)?.[1];
  const unitToken = (value) => text(value)
    .toLowerCase()
    .replace(/°/g, "deg")
    .replace(/%/g, "percent")
    .replace(/[^a-z0-9]/g, "");
  if (field.unit && parentheticalUnit && unitToken(parentheticalUnit) === unitToken(field.unit)) return displayName;
  return field.unit ? `${displayName} (${field.unit})` : displayName;
}

function roleWeight(role) {
  if (role === "outcome") return 70;
  if (role === "condition") return 60;
  if (role === "identifier") return 50;
  if (role === "series_summary") return 45;
  return 25;
}

function canonicalFilter(filter) {
  return {
    columnId: text(filter?.columnId),
    operator: text(filter?.operator).toLowerCase() || "contains",
    value: filter?.value ?? null,
  };
}

function canonicalSort(item) {
  return {
    columnId: text(item?.columnId) || "experiment",
    direction: text(item?.direction).toLowerCase() === "desc" ? "desc" : "asc",
  };
}

function cursorSignature({ projectId, search, filters, sort }) {
  return stableDataHash({ projectId, search: text(search).toLowerCase(), filters, sort });
}

function decodeCursor(cursor, signature) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (parsed.signature !== signature || !Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error("invalid");
    return parsed.offset;
  } catch {
    throw Object.assign(new Error("The Experiment Browser cursor is invalid or no longer matches this query."), {
      statusCode: 400,
      code: "invalid_browser_cursor",
    });
  }
}

function encodeCursor(offset, signature) {
  return Buffer.from(JSON.stringify({ offset, signature }), "utf8").toString("base64url");
}

function activeRecords({ projectId, dataSnapshots, experimentIdentities, experimentSnapshotHeads }) {
  const snapshots = new Map(asArray(dataSnapshots)
    .filter((snapshot) => snapshot?.projectId === projectId && snapshot.status === "accepted")
    .map((snapshot) => [snapshot.id, snapshot]));
  const identities = new Map(asArray(experimentIdentities)
    .filter((identity) => identity?.projectId === projectId)
    .map((identity) => [identity.id, identity]));

  return asArray(experimentSnapshotHeads)
    .filter((head) => head?.projectId === projectId)
    .flatMap((head) => {
      const snapshot = snapshots.get(head.dataSnapshotId);
      const identity = identities.get(head.experimentId);
      const record = snapshot?.experimentRecords?.[Number(head.recordIndex)];
      if (!snapshot || !identity || !record || record.experimentId !== identity.id) return [];
      return [{ head, snapshot, identity, record }];
    });
}

function buildColumns(entries) {
  const stats = new Map();
  entries.forEach(({ record }) => {
    asArray(record.fields).forEach((field) => {
      const id = experimentFieldColumnId(field);
      const current = stats.get(id) || {
        id,
        fieldKey: text(field.fieldKey),
        displayName: text(field.displayName || field.fieldKey),
        label: columnLabel(field),
        role: text(field.role) || "other",
        valueType: normalizedType(field.valueType),
        unit: field.unit || null,
        seenCount: 0,
        coverageCount: 0,
        confidenceTotal: 0,
        confidenceCount: 0,
        warningCount: 0,
      };
      current.seenCount += 1;
      if (field.value !== null && field.value !== undefined && field.value !== "") current.coverageCount += 1;
      if (Number.isFinite(Number(field.confidence))) {
        current.confidenceTotal += Number(field.confidence);
        current.confidenceCount += 1;
      }
      current.warningCount += asArray(field.warnings).length;
      stats.set(id, current);
    });
  });

  const rowCount = entries.length;
  const fieldColumns = [...stats.values()].map((column) => {
    const coverageRatio = rowCount ? column.coverageCount / rowCount : 0;
    const confidenceAverage = column.confidenceCount ? column.confidenceTotal / column.confidenceCount : 0;
    const recommendationScore = Math.round((
      roleWeight(column.role)
      + coverageRatio * 25
      + confidenceAverage * 10
      - Math.min(column.warningCount * 4, 20)
    ) * 100) / 100;
    return {
      id: column.id,
      fieldKey: column.fieldKey,
      displayName: column.displayName,
      label: column.label,
      role: column.role,
      valueType: column.valueType,
      unit: column.unit,
      coverageCount: column.coverageCount,
      coverageRatio,
      confidenceAverage,
      warningCount: column.warningCount,
      recommendationScore,
      recommended: false,
      pinned: false,
    };
  }).sort((a, b) => (
    b.recommendationScore - a.recommendationScore
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id)
  ));
  fieldColumns.slice(0, RECOMMENDED_FIELD_LIMIT).forEach((column) => { column.recommended = true; });
  return [{
    id: "experiment",
    fieldKey: null,
    displayName: "Experiment",
    label: "Experiment",
    role: "identifier",
    valueType: "string",
    unit: null,
    coverageCount: rowCount,
    coverageRatio: rowCount ? 1 : 0,
    confidenceAverage: 1,
    warningCount: 0,
    recommendationScore: 100,
    recommended: true,
    pinned: true,
  }, ...fieldColumns];
}

function summarizedSeries(series) {
  return {
    seriesKey: series.seriesKey,
    label: series.label || series.seriesKey,
    xField: series.xField || null,
    yField: series.yField || null,
    xUnit: series.xUnit || null,
    yUnit: series.yUnit || null,
    pointCount: asArray(series.points).length,
    warningCount: asArray(series.warnings).length,
  };
}

function summarizedRange(sourceRef) {
  return {
    sourceType: sourceRef.sourceType,
    sourceDocumentId: sourceRef.sourceDocumentId || null,
    sheet: sourceRef.sheet || null,
    range: sourceRef.range || sourceRef.cell || null,
  };
}

function buildRows(entries, columns) {
  const fieldColumnIds = new Set(columns.slice(1).map((column) => column.id));
  return entries.map(({ head, snapshot, identity, record }) => {
    const cells = Object.fromEntries([...fieldColumnIds].map((columnId) => [columnId, null]));
    asArray(record.fields).forEach((field) => {
      const columnId = experimentFieldColumnId(field);
      if (!fieldColumnIds.has(columnId)) return;
      cells[columnId] = {
        value: field.value ?? null,
        formattedValue: field.formattedValue ?? null,
        confidence: field.confidence ?? null,
        warningCount: asArray(field.warnings).length,
      };
    });
    return {
      experimentId: identity.id,
      label: identity.canonicalLabel || record.label || identity.id,
      sourceLabel: record.label || identity.canonicalLabel || identity.id,
      aliases: [...new Set([...asArray(identity.aliases), ...asArray(record.aliases)].filter(Boolean))],
      dataSnapshotId: snapshot.id,
      acceptedAt: snapshot.acceptedAt,
      cells,
      seriesInventory: asArray(record.series).map(summarizedSeries),
      warningCount: asArray(record.warnings).length
        + asArray(record.fields).reduce((total, field) => total + asArray(field.warnings).length, 0)
        + asArray(record.series).reduce((total, series) => total + asArray(series.warnings).length, 0),
      sourceRanges: asArray(record.sourceRefs).map(summarizedRange),
      headId: head.id,
    };
  });
}

function cellValue(row, columnId) {
  if (columnId === "experiment") return row.label;
  return row.cells[columnId]?.value ?? null;
}

function compareValues(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function matchesFilter(row, filter) {
  const actual = cellValue(row, filter.columnId);
  const expected = filter.value;
  if (filter.operator === "is_empty") return actual == null || actual === "";
  if (filter.operator === "not_empty") return actual != null && actual !== "";
  if (actual == null || actual === "") return false;
  if (filter.operator === "contains") return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  if (filter.operator === "eq") return compareValues(actual, expected) === 0;
  if (filter.operator === "neq") return compareValues(actual, expected) !== 0;
  if (filter.operator === "gt") return compareValues(actual, expected) > 0;
  if (filter.operator === "gte") return compareValues(actual, expected) >= 0;
  if (filter.operator === "lt") return compareValues(actual, expected) < 0;
  if (filter.operator === "lte") return compareValues(actual, expected) <= 0;
  return true;
}

export function buildExperimentProjection({
  projectId,
  dataSnapshots = [],
  experimentIdentities = [],
  experimentSnapshotHeads = [],
  search = "",
  filters = [],
  sort = [],
  cursor = null,
  limit = DEFAULT_LIMIT,
} = {}) {
  const entries = activeRecords({ projectId, dataSnapshots, experimentIdentities, experimentSnapshotHeads });
  const columns = buildColumns(entries);
  const allRows = buildRows(entries, columns);
  const normalizedSearch = text(search).toLowerCase();
  const normalizedFilters = asArray(filters).map(canonicalFilter).filter((filter) => filter.columnId);
  const normalizedSort = asArray(sort).map(canonicalSort).slice(0, 3);
  const filteredRows = allRows.filter((row) => {
    if (normalizedSearch) {
      const haystack = [
        row.label,
        row.sourceLabel,
        ...row.aliases,
        ...Object.values(row.cells).flatMap((cell) => cell ? [cell.value, cell.formattedValue] : []),
      ].join(" ").toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return normalizedFilters.every((filter) => matchesFilter(row, filter));
  });
  filteredRows.sort((left, right) => {
    for (const sortItem of normalizedSort) {
      const compared = compareValues(cellValue(left, sortItem.columnId), cellValue(right, sortItem.columnId));
      if (compared) return sortItem.direction === "desc" ? -compared : compared;
    }
    return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })
      || left.experimentId.localeCompare(right.experimentId);
  });

  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const signature = cursorSignature({ projectId, search: normalizedSearch, filters: normalizedFilters, sort: normalizedSort });
  const offset = decodeCursor(cursor, signature);
  const rows = filteredRows.slice(offset, offset + pageLimit);
  const nextOffset = offset + rows.length;
  return {
    schemaVersion: "labrat.experimentProjection.v1",
    projectId,
    columns,
    rows,
    nextCursor: nextOffset < filteredRows.length ? encodeCursor(nextOffset, signature) : null,
    totalCount: filteredRows.length,
    page: { offset, limit: pageLimit, returnedCount: rows.length },
  };
}

export function getExperimentProjectionDetail({
  projectId,
  experimentId,
  dataSnapshots = [],
  experimentIdentities = [],
  experimentSnapshotHeads = [],
} = {}) {
  const entry = activeRecords({ projectId, dataSnapshots, experimentIdentities, experimentSnapshotHeads })
    .find(({ identity }) => identity.id === experimentId);
  if (!entry) return null;
  return clone({
    schemaVersion: "labrat.experimentDetail.v1",
    projectId,
    experiment: {
      id: entry.identity.id,
      canonicalLabel: entry.identity.canonicalLabel,
      aliases: entry.identity.aliases,
    },
    activeHead: entry.head,
    dataSnapshot: {
      id: entry.snapshot.id,
      dataPlanId: entry.snapshot.dataPlanId,
      contentHash: entry.snapshot.contentHash,
      dependencyHash: entry.snapshot.dependencyHash,
      acceptedAt: entry.snapshot.acceptedAt,
      acceptedBy: entry.snapshot.acceptedBy,
    },
    record: entry.record,
  });
}
