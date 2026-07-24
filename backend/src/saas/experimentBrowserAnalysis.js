import { encodeCell } from "../import/utils/excelAddress.js";
import {
  buildExperimentProjection,
  experimentFieldColumnId,
  resolveActiveExperimentRecords,
} from "./experimentProjection.js";
import { stableDataHash } from "./dataPlanSchemas.js";

const MAX_EXPERIMENT_SELECTIONS = 1_000;
const MAX_RECORD_PATCHES = 10_000;
const MAX_FIELDS_PER_PATCH = 2_000;
const MAX_SERIES_PER_PATCH = 500;
const MAX_SERIES_POINTS = 1_000_000;
const FIELD_ROLES = new Set(["identifier", "condition", "outcome", "series_summary", "other"]);
const VALUE_TYPES = new Set(["number", "string", "date", "boolean"]);
const MISSING_REASONS = new Set([
  "source_blank",
  "source_placeholder",
  "calculation_unavailable",
]);
const SOURCE_PLACEHOLDERS = new Set(["-", "--", "—", "n/a", "na"]);
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

function analysisError(code, message, statusCode = 422, details = undefined) {
  return Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details === undefined ? {} : { details }),
  });
}

function normalizedUnit(value) {
  return text(value) || "unitless";
}

function normalizedType(value) {
  return text(value).toLowerCase() || "string";
}

function sourceGridValue(grid, rowOffset, columnOffset) {
  const row = asArray(grid)[rowOffset];
  if (!Array.isArray(row) || columnOffset >= row.length) return null;
  const value = row[columnOffset];
  return value === undefined ? null : clone(value);
}

function isBlankSourceValue(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function isPlaceholderSourceValue(value) {
  return SOURCE_PLACEHOLDERS.has(text(value).toLowerCase());
}

function sourceEvidenceForPointers(value, inputs) {
  return asArray(value?.sources).flatMap((pointer) => {
    if (text(pointer?.tableId)) {
      const table = asArray(inputs?.tables).find((item) => item.tableId === text(pointer.tableId));
      const rowOffset = Number(pointer?.rowOffset);
      const columnOffset = Number(pointer?.columnOffset);
      if (
        !table
        || !Number.isInteger(rowOffset)
        || !Number.isInteger(columnOffset)
        || rowOffset < 0
        || columnOffset < 0
        || rowOffset >= Number(table?.rowCount)
        || columnOffset >= Number(table?.columnCount)
      ) return [];
      return [{
        sourceType: "excel_cell",
        rawValue: sourceGridValue(table.values, rowOffset, columnOffset),
        formattedValue: sourceGridValue(table.displayValues, rowOffset, columnOffset),
      }];
    }
    if (text(pointer?.experimentId) && text(pointer?.columnId)) {
      const experiment = asArray(inputs?.experiments)
        .find((item) => item.experimentId === text(pointer.experimentId));
      const field = asArray(experiment?.fields)
        .find((item) => item.columnId === text(pointer.columnId));
      if (!field) return [];
      return [{
        sourceType: "experiment_field",
        value: field.value ?? null,
        formattedValue: field.formattedValue ?? null,
        missingReason: field.missingReason || null,
      }];
    }
    return [];
  });
}

function missingReasonMatchesEvidence(missingReason, evidence) {
  if (missingReason === "calculation_unavailable") return evidence.length > 0;
  if (missingReason === "source_blank") {
    return evidence.some((item) => (
      item.missingReason === "source_blank"
      || (item.sourceType === "excel_cell"
        && isBlankSourceValue(item.rawValue)
        && isBlankSourceValue(item.formattedValue))
    ));
  }
  if (missingReason === "source_placeholder") {
    return evidence.some((item) => (
      item.missingReason === "source_placeholder"
      || (item.sourceType === "excel_cell"
        && (isPlaceholderSourceValue(item.rawValue) || isPlaceholderSourceValue(item.formattedValue)))
    ));
  }
  return false;
}

function activeContextFromParts({
  projectId,
  dataSnapshots,
  experimentIdentities,
  experimentSnapshotHeads,
}) {
  const entries = resolveActiveExperimentRecords({
    projectId,
    dataSnapshots,
    experimentIdentities,
    experimentSnapshotHeads,
  });
  return {
    entries,
    entryByExperimentId: new Map(entries.map((entry) => [entry.identity.id, entry])),
    identityById: new Map(asArray(experimentIdentities).map((identity) => [identity.id, identity])),
  };
}

export async function loadActiveExperimentContext({ store, projectId } = {}) {
  const [dataSnapshots, experimentIdentities, experimentSnapshotHeads] = await Promise.all([
    store.listDataSnapshots({ projectId }),
    store.listExperimentIdentities({ projectId }),
    store.listExperimentSnapshotHeads({ projectId }),
  ]);
  return {
    dataSnapshots,
    experimentIdentities,
    experimentSnapshotHeads,
    ...activeContextFromParts({
      projectId,
      dataSnapshots,
      experimentIdentities,
      experimentSnapshotHeads,
    }),
  };
}

export async function experimentInputCatalog({ store, projectId } = {}) {
  const context = await loadActiveExperimentContext({ store, projectId });
  return context.entries.map(({ head, identity, record }) => ({
    experimentId: identity.id,
    label: identity.canonicalLabel || record.label || identity.id,
    aliases: [...new Set([
      identity.canonicalLabel,
      record.label,
      ...asArray(identity.aliases),
      ...asArray(record.aliases),
    ].map(text).filter(Boolean))],
    activeHead: {
      headId: head.id,
      dataSnapshotId: head.dataSnapshotId,
      recordIndex: Number(head.recordIndex),
    },
    fields: asArray(record.fields).map((field) => ({
      columnId: experimentFieldColumnId(field),
      fieldKey: text(field.fieldKey),
      displayName: text(field.displayName || field.fieldKey),
      role: text(field.role) || "other",
      valueType: normalizedType(field.valueType),
      unit: field.unit || null,
    })),
    series: asArray(record.series).map((series) => ({
      seriesKey: text(series.seriesKey),
      label: text(series.label || series.seriesKey),
      xField: text(series.xField),
      yField: text(series.yField),
      xUnit: series.xUnit || null,
      yUnit: series.yUnit || null,
      pointCount: asArray(series.points).length,
    })),
  }));
}

export async function resolveExperimentSelections({
  store,
  projectId,
  experimentSelections = [],
} = {}) {
  const requested = asArray(experimentSelections);
  if (requested.length > MAX_EXPERIMENT_SELECTIONS) {
    throw analysisError(
      "analysis_experiment_selection_limit_exceeded",
      `An Experiment Browser plan may select at most ${MAX_EXPERIMENT_SELECTIONS} active experiments.`,
    );
  }
  if (!requested.length) return [];
  const context = await loadActiveExperimentContext({ store, projectId });
  const seen = new Set();
  return requested.map((selection, index) => {
    const experimentId = text(selection?.experimentId);
    const entry = context.entryByExperimentId.get(experimentId);
    if (!entry) {
      throw analysisError(
        "analysis_experiment_selection_not_found",
        `Active experiment ${experimentId || index + 1} is not available.`,
        422,
        { experimentId: experimentId || null },
      );
    }
    if (seen.has(experimentId)) {
      throw analysisError(
        "analysis_experiment_selection_duplicate",
        "The same active experiment may appear only once in a plan.",
      );
    }
    seen.add(experimentId);
    const availableFields = new Map(asArray(entry.record.fields).map((field) => [
      experimentFieldColumnId(field),
      field,
    ]));
    const requestedColumnIds = asArray(selection?.columnIds).map(text).filter(Boolean);
    const columnIds = requestedColumnIds.length ? requestedColumnIds : [...availableFields.keys()];
    const unknown = columnIds.filter((columnId) => !availableFields.has(columnId));
    if (unknown.length) {
      throw analysisError(
        "analysis_experiment_field_not_found",
        "An active experiment selection references unavailable fields.",
        422,
        { experimentId, columnIds: unknown },
      );
    }
    return {
      experimentSelectionId: `experiment_selection_${index + 1}`,
      experimentId,
      label: entry.identity.canonicalLabel || entry.record.label || experimentId,
      columnIds: [...new Set(columnIds)],
      fieldLabels: [...new Set(columnIds.map((columnId) => {
        const field = availableFields.get(columnId);
        const label = text(field?.displayName || field?.fieldKey) || columnId;
        const unit = text(field?.unit);
        if (!unit || normalizeAlias(label) === normalizeAlias(unit)) return label;
        return label.toLowerCase().includes(`(${unit.toLowerCase()})`)
          ? label
          : `${label} (${unit})`;
      }))],
      includeSeries: selection?.includeSeries === true,
      purpose: text(selection?.purpose) || null,
      baseHeadRef: {
        experimentId,
        headId: entry.head.id,
        dataSnapshotId: entry.head.dataSnapshotId,
        recordIndex: Number(entry.head.recordIndex),
      },
    };
  });
}

export async function materializeExperimentInputs({
  store,
  projectId,
  experimentSelections = [],
} = {}) {
  const selections = await resolveExperimentSelections({
    store,
    projectId,
    experimentSelections,
  });
  if (!selections.length) return { selections: [], experiments: [], fieldCatalog: [], expectedHeadRefs: [] };
  const context = await loadActiveExperimentContext({ store, projectId });
  const fieldCatalog = new Map();
  const experiments = selections.map((selection) => {
    const entry = context.entryByExperimentId.get(selection.experimentId);
    const selected = new Set(selection.columnIds);
    const fields = asArray(entry.record.fields)
      .filter((field) => selected.has(experimentFieldColumnId(field)))
      .map((field) => {
        const columnId = experimentFieldColumnId(field);
        fieldCatalog.set(columnId, {
          columnId,
          fieldKey: text(field.fieldKey),
          displayName: text(field.displayName || field.fieldKey),
          role: text(field.role) || "other",
          valueType: normalizedType(field.valueType),
          unit: field.unit || null,
        });
        return { ...clone(field), columnId };
      });
    return {
      experimentSelectionId: selection.experimentSelectionId,
      experimentId: entry.identity.id,
      label: selection.label,
      aliases: clone(entry.identity.aliases) || [],
      activeHead: clone(selection.baseHeadRef),
      fields,
      series: selection.includeSeries ? clone(entry.record.series) || [] : [],
    };
  });
  return {
    selections,
    experiments,
    fieldCatalog: [...fieldCatalog.values()],
    expectedHeadRefs: selections.map((selection) => clone(selection.baseHeadRef)),
  };
}

export function inspectExperimentInput(inputs, {
  experimentId,
  fieldOffset = 0,
  fieldLimit = 100,
  includeSeries = false,
} = {}) {
  const experiment = asArray(inputs?.experiments).find((item) => item.experimentId === text(experimentId));
  if (!experiment) {
    throw analysisError(
      "analysis_input_experiment_not_found",
      "The requested active experiment input was not found.",
      404,
    );
  }
  const offset = Math.max(Number.parseInt(fieldOffset, 10) || 0, 0);
  const limit = Math.min(Math.max(Number.parseInt(fieldLimit, 10) || 100, 1), 500);
  return {
    ...clone(experiment),
    fields: asArray(experiment.fields).slice(offset, offset + limit),
    series: includeSeries ? clone(experiment.series) || [] : [],
    page: {
      fieldOffset: offset,
      fieldLimit: limit,
      fieldCount: asArray(experiment.fields).length,
    },
  };
}

export function buildProjectFieldCatalog(entries = []) {
  const catalog = new Map();
  asArray(entries).forEach(({ record }) => {
    asArray(record?.fields).forEach((field) => {
      const columnId = experimentFieldColumnId(field);
      if (!catalog.has(columnId)) {
        catalog.set(columnId, {
          columnId,
          fieldKey: text(field.fieldKey),
          displayName: text(field.displayName || field.fieldKey),
          role: text(field.role) || "other",
          valueType: normalizedType(field.valueType),
          unit: field.unit || null,
        });
      }
    });
  });
  return [...catalog.values()];
}

function sourceRefsForPointer(pointer, inputs, errors, path) {
  if (text(pointer?.tableId)) {
    const table = asArray(inputs?.tables).find((item) => item.tableId === text(pointer.tableId));
    const rowOffset = Number(pointer?.rowOffset);
    const columnOffset = Number(pointer?.columnOffset);
    if (
      !table
      || !Number.isInteger(rowOffset)
      || !Number.isInteger(columnOffset)
      || rowOffset < 0
      || columnOffset < 0
      || rowOffset >= Number(table?.rowCount)
      || columnOffset >= Number(table?.columnCount)
    ) {
      errors.push(error(
        "experiment_patch_source_cell_invalid",
        "A generated value references a workbook cell outside the accepted Python input.",
        { path },
      ));
      return [];
    }
    return [{
      sourceType: "excel_cell",
      sourceDocumentId: table.source.sourceDocumentId,
      fileName: table.source.workbookName
        || table.source.fileName
        || table.source.originalName
        || null,
      sheet: table.source.sheetName,
      cell: encodeCell(
        Number(table.startRow) - 1 + rowOffset,
        Number(table.startColumn) - 1 + columnOffset,
      ),
      tableId: table.tableId,
      rawValue: sourceGridValue(table.values, rowOffset, columnOffset),
      formattedValue: sourceGridValue(table.displayValues, rowOffset, columnOffset),
    }];
  }
  if (text(pointer?.experimentId) && text(pointer?.columnId)) {
    const experiment = asArray(inputs?.experiments)
      .find((item) => item.experimentId === text(pointer.experimentId));
    const field = asArray(experiment?.fields)
      .find((item) => item.columnId === text(pointer.columnId));
    if (!experiment || !field) {
      errors.push(error(
        "experiment_patch_source_field_invalid",
        "A generated value references an experiment field outside the accepted Python input.",
        { path },
      ));
      return [];
    }
    return clone(field.sourceRefs) || [];
  }
  errors.push(error(
    "experiment_patch_source_required",
    "Every generated scientific value requires at least one accepted workbook cell or active experiment field source.",
    { path },
  ));
  return [];
}

function sourceRefsForValue(value, inputs, errors, path) {
  const pointers = asArray(value?.sources);
  if (!pointers.length) {
    errors.push(error(
      "experiment_patch_source_required",
      "Every generated scientific value requires source pointers.",
      { path },
    ));
    return [];
  }
  const refs = pointers.flatMap((pointer, index) => (
    sourceRefsForPointer(pointer, inputs, errors, `${path}.sources[${index}]`)
  ));
  const seen = new Set();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeField(field, inputs, fieldTargets, fieldCatalog, errors, path, diagnostic = {}) {
  const targetFieldId = text(field?.targetFieldId);
  const target = fieldTargets.get(targetFieldId);
  if (!target) {
    errors.push(error(
      "experiment_patch_field_target_invalid",
      "Every scalar output must reference a targetFieldId from the accepted plan.",
      { path, targetFieldId: targetFieldId || null, ...diagnostic },
    ));
  }
  const forbiddenMetadata = [
    "fieldKey",
    "displayName",
    "role",
    "valueType",
    "unit",
    "columnId",
  ].filter((key) => Object.prototype.hasOwnProperty.call(field || {}, key));
  if (forbiddenMetadata.length) {
    errors.push(error(
      "experiment_patch_field_metadata_forbidden",
      "Python must not redefine accepted scalar field metadata.",
      { path, targetFieldId: targetFieldId || null, properties: forbiddenMetadata, ...diagnostic },
    ));
  }
  const existing = target?.existingColumnId
    ? fieldCatalog.get(target.existingColumnId)
    : null;
  if (target?.existingColumnId && !existing) {
    errors.push(error(
      "experiment_patch_field_selector_invalid",
      "The accepted target field no longer exists in the active project field catalog.",
      { path, targetFieldId, columnId: target.existingColumnId, ...diagnostic },
    ));
  }
  const definition = target || {
    fieldKey: "",
    displayName: "",
    role: "",
    valueType: "",
    unit: null,
    columnId: "",
  };
  if (
    !definition.fieldKey
    || !definition.displayName
    || !FIELD_ROLES.has(definition.role)
    || !VALUE_TYPES.has(definition.valueType)
  ) {
    errors.push(error(
      "experiment_patch_field_definition_invalid",
      "The accepted target field definition is incomplete or unsupported.",
      {
        path,
        targetFieldId: targetFieldId || null,
        role: definition.role || null,
        valueType: definition.valueType || null,
        allowedRoles: [...FIELD_ROLES],
        allowedValueTypes: [...VALUE_TYPES],
        ...diagnostic,
      },
    ));
  }
  const hasValue = Object.prototype.hasOwnProperty.call(field || {}, "value");
  const value = hasValue ? field.value : null;
  const missingReason = text(field?.missingReason) || null;
  const normalized = {
    fieldKey: definition.fieldKey,
    displayName: definition.displayName,
    role: definition.role,
    valueType: definition.valueType,
    unit: definition.unit || null,
    headerSourceRefs: clone(definition.sourceField?.headerSourceRefs) || [],
    value,
    formattedValue: value === null ? null : field?.formattedValue ?? null,
    ...(missingReason ? { missingReason } : {}),
    confidence: Number.isFinite(Number(field?.confidence)) ? Number(field.confidence) : 1,
    warnings: asArray(field?.warnings).map((warning) => (
      typeof warning === "string" ? { code: "analysis_warning", message: warning } : clone(warning)
    )),
    sourceRefs: sourceRefsForValue(field, inputs, errors, path),
  };
  const fieldDiagnostic = {
    path,
    experimentLabel: diagnostic.experimentLabel || null,
    fieldName: normalized.displayName || normalized.fieldKey || null,
  };
  if (!hasValue) {
    errors.push(error(
      "experiment_patch_value_required",
      "Every Experiment Browser scalar field must explicitly provide a value.",
      fieldDiagnostic,
    ));
  }
  if (normalized.value === null) {
    if (!MISSING_REASONS.has(missingReason)) {
      errors.push(error(
        "experiment_patch_missing_reason_required",
        "A null Experiment Browser field requires source_blank, source_placeholder, or calculation_unavailable.",
        fieldDiagnostic,
      ));
    } else if (!missingReasonMatchesEvidence(
      missingReason,
      sourceEvidenceForPointers(field, inputs),
    )) {
      errors.push(error(
        "experiment_patch_missing_source_mismatch",
        "The missing reason does not match the accepted source evidence.",
        { ...fieldDiagnostic, missingReason },
      ));
    }
    if (field?.formattedValue !== null && field?.formattedValue !== undefined) {
      errors.push(error(
        "experiment_patch_missing_formatted_value_invalid",
        "A null Experiment Browser field must use formattedValue null; the dash placeholder is UI-only.",
        fieldDiagnostic,
      ));
    }
  } else if (missingReason) {
    errors.push(error(
      "experiment_patch_missing_reason_unexpected",
      "A non-null Experiment Browser field cannot carry a missingReason.",
      fieldDiagnostic,
    ));
  }
  if (normalized.value !== null && normalized.valueType === "number" && (
    typeof normalized.value !== "number" || !Number.isFinite(normalized.value)
  )) {
    errors.push(error(
      "experiment_patch_numeric_value_invalid",
      "A numeric Experiment Browser field requires one finite number.",
      fieldDiagnostic,
    ));
  }
  if (
    normalized.value !== null
    && normalized.valueType === "boolean"
    && typeof normalized.value !== "boolean"
  ) {
    errors.push(error(
      "experiment_patch_boolean_value_invalid",
      "A boolean Experiment Browser field requires true or false.",
      fieldDiagnostic,
    ));
  }
  if (["string", "date"].includes(normalized.valueType) && (
    normalized.value != null && typeof normalized.value !== "string"
  )) {
    errors.push(error(
      "experiment_patch_text_value_invalid",
      "String and date Experiment Browser fields require string values.",
      fieldDiagnostic,
    ));
  }
  normalized.columnId = text(definition.columnId) || experimentFieldColumnId(normalized);
  if (existing && normalized.columnId !== existing.columnId) {
    errors.push(error(
      "experiment_patch_field_selector_mismatch",
      "An accepted replacement target may not change its field key, unit, or value type.",
      { ...fieldDiagnostic, columnId: definition.existingColumnId },
    ));
  }
  return normalized;
}

function normalizeSeries(series, inputs, errors, path) {
  const normalized = {
    seriesKey: text(series?.seriesKey),
    label: text(series?.label || series?.seriesKey),
    xField: text(series?.xField),
    yField: text(series?.yField),
    xUnit: series?.xUnit || null,
    yUnit: series?.yUnit || null,
    warnings: asArray(series?.warnings).map((warning) => (
      typeof warning === "string" ? { code: "analysis_warning", message: warning } : clone(warning)
    )),
    points: [],
    sourceRefs: sourceRefsForValue(series, inputs, errors, path),
  };
  if (!normalized.seriesKey || !normalized.label || !normalized.xField || !normalized.yField) {
    errors.push(error(
      "experiment_patch_series_definition_invalid",
      "A series requires a stable key, readable label, X field, and Y field.",
      { path },
    ));
  }
  normalized.points = asArray(series?.points).map((point, pointIndex) => {
    if (
      !["string", "number"].includes(typeof point?.x)
      || typeof point?.y !== "number"
      || !Number.isFinite(point.y)
    ) {
      errors.push(error(
        "experiment_patch_series_point_invalid",
        "Series points require a string or finite numeric X and a finite numeric Y.",
        { path, pointIndex },
      ));
    }
    return {
      x: point?.x ?? null,
      y: point?.y ?? null,
      sourceRefs: sourceRefsForValue(
        point,
        inputs,
        errors,
        `${path}.points[${pointIndex}]`,
      ),
    };
  });
  return normalized;
}

function seriesSelector(series) {
  return [
    text(series?.seriesKey),
    normalizedUnit(series?.xUnit),
    normalizedUnit(series?.yUnit),
  ].join("|");
}

function mergeRecord(baseRecord, patch, experimentId) {
  const base = baseRecord ? clone(baseRecord) : {
    label: patch.label,
    aliases: [],
    fields: [],
    series: [],
    warnings: [],
    sourceRefs: [],
  };
  const fieldById = new Map(asArray(base.fields).map((field) => [
    experimentFieldColumnId(field),
    field,
  ]));
  const seriesById = new Map(asArray(base.series).map((series) => [
    seriesSelector(series),
    series,
  ]));
  const changes = [];
  patch.upsertFields.forEach((field) => {
    const prior = fieldById.get(field.columnId);
    if (prior?.value != null && field.value === null) return;
    fieldById.set(field.columnId, {
      ...clone(field),
      columnId: undefined,
    });
    changes.push({
      kind: prior ? "changed_field" : "new_field",
      columnId: field.columnId,
      label: field.displayName,
      before: prior?.formattedValue ?? prior?.value ?? null,
      after: field.formattedValue ?? field.value ?? null,
    });
  });
  patch.upsertSeries.forEach((series) => {
    const key = seriesSelector(series);
    const prior = seriesById.get(key);
    seriesById.set(key, clone(series));
    changes.push({
      kind: prior ? "changed_series" : "new_series",
      seriesKey: series.seriesKey,
      label: series.label,
      before: prior ? asArray(prior.points).length : null,
      after: asArray(series.points).length,
    });
  });
  const sourceRefs = [
    ...asArray(base.sourceRefs),
    ...patch.upsertFields.flatMap((field) => asArray(field.sourceRefs)),
    ...patch.upsertSeries.flatMap((series) => asArray(series.sourceRefs)),
  ];
  return {
    record: {
      ...base,
      experimentId,
      label: patch.label || base.label,
      aliases: [...new Set([...asArray(base.aliases), patch.label].map(text).filter(Boolean))],
      fields: [...fieldById.values()].map((field) => {
        const next = clone(field);
        delete next.columnId;
        return next;
      }),
      series: [...seriesById.values()],
      warnings: [...asArray(base.warnings), ...asArray(patch.warnings)],
      sourceRefs: sourceRefs.filter((ref, index, all) => (
        all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(ref)) === index
      )),
      ...(baseRecord ? {
        baseSnapshotRef: patch.baseSnapshotRef,
      } : {}),
    },
    changes,
  };
}

function identityMatches(identity, normalized) {
  return [
    identity?.canonicalLabel,
    identity?.label,
    ...asArray(identity?.aliases),
  ].some((alias) => normalizeAlias(alias) === normalized);
}

function identityCandidates(patches, context) {
  return patches.map((patch, index) => {
    const normalizedAlias = normalizeAlias(patch.label);
    const matches = context.experimentIdentities
      .filter((identity) => identityMatches(identity, normalizedAlias))
      .map((identity) => ({
        id: identity.id,
        label: identity.canonicalLabel || identity.label || identity.id,
      }));
    return {
      candidateId: `experiment_candidate_${index + 1}`,
      sourceAlias: patch.label,
      normalizedAlias,
      matches,
      suggestedAction: matches.length === 0 ? "create" : matches.length === 1 ? "reuse" : null,
      suggestedExperimentId: matches.length === 1 ? matches[0].id : null,
      status: matches.length > 1 ? "conflict" : matches.length === 1 ? "reuse" : "create",
    };
  });
}

function proposedBrowserView(rawView, projection, changedColumnIds) {
  const available = new Set(asArray(projection.columns).map((column) => column.id));
  const requested = asArray(rawView?.visibleColumnIds).map(text).filter((id) => available.has(id));
  const visibleColumnIds = [
    "experiment",
    ...changedColumnIds,
    ...requested,
  ].filter((id, index, all) => available.has(id) && all.indexOf(id) === index);
  return {
    schemaVersion: "labrat.browserView.v1",
    name: text(rawView?.name) || "LabRat data update",
    visibleColumnIds,
    columnOrder: visibleColumnIds,
    columnWidths: {},
    filters: asArray(rawView?.filters).filter((filter) => available.has(text(filter?.columnId))),
    sort: asArray(rawView?.sort).filter((item) => available.has(text(item?.columnId))).slice(0, 3),
    selectedExperimentIds: [],
    makeDefault: rawView?.makeDefault === true,
  };
}

export function validateExperimentBrowserResult({
  projectId,
  plan,
  executorResult,
  inputs,
  activeContext,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!executorResult?.ok) {
    errors.push(error(
      "analysis_executor_failed",
      executorResult?.error?.message || "The Python executor failed.",
    ));
  }
  const raw = executorResult?.result && typeof executorResult.result === "object"
    ? executorResult.result
    : {};
  const rawPatches = asArray(raw.recordPatches);
  if (!rawPatches.length) {
    errors.push(error(
      "experiment_record_patches_required",
      "Python returned no Experiment Browser record patches.",
    ));
  }
  if (rawPatches.length > MAX_RECORD_PATCHES) {
    errors.push(error(
      "experiment_record_patch_limit_exceeded",
      `Python returned more than ${MAX_RECORD_PATCHES} record patches.`,
    ));
  }
  const fieldCatalog = new Map(buildProjectFieldCatalog(activeContext.entries)
    .map((field) => [field.columnId, field]));
  const fieldTargets = new Map(asArray(
    plan?.plan?.fieldTargets
      || plan?.fieldTargets
      || inputs?.targetFields,
  ).map((target) => [text(target?.targetFieldId), target]));
  if (!fieldTargets.size) {
    errors.push(error(
      "experiment_patch_field_targets_required",
      "The accepted Experiment Browser plan contains no scalar field targets.",
    ));
  }
  const seenAliases = new Set();
  let totalSeriesPoints = 0;
  const patches = rawPatches.map((patch, patchIndex) => {
    const label = text(patch?.label || patch?.sourceAlias);
    const normalized = normalizeAlias(label);
    if (!normalized) {
      errors.push(error(
        "experiment_patch_label_required",
        "Every Experiment Browser patch requires a non-blank experiment label.",
        { patchIndex },
      ));
    } else if (seenAliases.has(normalized)) {
      errors.push(error(
        "experiment_patch_label_duplicate",
        `Python returned more than one patch for ${label}.`,
        { patchIndex, label },
      ));
    }
    seenAliases.add(normalized);
    if (asArray(patch?.upsertFields).length > MAX_FIELDS_PER_PATCH) {
      errors.push(error(
        "experiment_patch_field_limit_exceeded",
        `A record patch may contain at most ${MAX_FIELDS_PER_PATCH} fields.`,
        { patchIndex },
      ));
    }
    if (asArray(patch?.upsertSeries).length > MAX_SERIES_PER_PATCH) {
      errors.push(error(
        "experiment_patch_series_limit_exceeded",
        `A record patch may contain at most ${MAX_SERIES_PER_PATCH} series.`,
        { patchIndex },
      ));
    }
    if (asArray(patch?.removeFields).length || asArray(patch?.removeSeries).length) {
      errors.push(error(
        "experiment_patch_removal_not_supported",
        "Scientific field and series removal is not supported in this release; hide fields with a BrowserView.",
        { patchIndex },
      ));
    }
    const upsertFields = asArray(patch?.upsertFields).map((field, fieldIndex) => (
      normalizeField(
        field,
        inputs,
        fieldTargets,
        fieldCatalog,
        errors,
        `recordPatches[${patchIndex}].upsertFields[${fieldIndex}]`,
        {
          patchIndex,
          experimentLabel: label,
          fieldName: fieldTargets.get(text(field?.targetFieldId))?.displayName || null,
        },
      )
    ));
    const upsertSeries = asArray(patch?.upsertSeries).map((series, seriesIndex) => {
      const normalizedSeries = normalizeSeries(
        series,
        inputs,
        errors,
        `recordPatches[${patchIndex}].upsertSeries[${seriesIndex}]`,
      );
      totalSeriesPoints += asArray(normalizedSeries.points).length;
      return normalizedSeries;
    });
    if (!upsertFields.length && !upsertSeries.length) {
      errors.push(error(
        "experiment_patch_empty",
        "Every record patch must add or replace at least one field or series.",
        { patchIndex },
      ));
    }
    return {
      patchId: `record_patch_${patchIndex + 1}`,
      label,
      upsertFields,
      upsertSeries,
      warnings: asArray(patch?.warnings),
    };
  });
  if (totalSeriesPoints > MAX_SERIES_POINTS) {
    errors.push(error(
      "experiment_patch_series_point_limit_exceeded",
      `Experiment Browser patches contain more than ${MAX_SERIES_POINTS} series points.`,
    ));
  }

  const candidates = identityCandidates(patches, activeContext);
  const previewIdentities = [];
  const previewRecords = [];
  const previewHeads = [];
  const rowChanges = [];
  const changedColumnIds = [];
  patches.forEach((patch, index) => {
    const candidate = candidates[index];
    const identity = candidate.suggestedExperimentId
      ? activeContext.identityById.get(candidate.suggestedExperimentId)
      : null;
    const experimentId = identity?.id || candidate.candidateId;
    const entry = identity ? activeContext.entryByExperimentId.get(identity.id) : null;
    const existingFields = new Map(asArray(entry?.record?.fields).map((field) => [
      experimentFieldColumnId(field),
      field,
    ]));
    patch.upsertFields.forEach((field) => {
      const prior = existingFields.get(field.columnId);
      if (prior?.value != null && field.value === null) {
        errors.push(error(
          "experiment_patch_missing_cannot_replace_value",
          "A missing value cannot replace an existing non-null scientific value.",
          {
            patchIndex: index,
            experimentLabel: patch.label,
            fieldName: field.displayName || field.fieldKey,
            columnId: field.columnId,
          },
        ));
      }
    });
    patch.baseSnapshotRef = entry ? {
      experimentId: identity.id,
      headId: entry.head.id,
      dataSnapshotId: entry.head.dataSnapshotId,
      recordIndex: Number(entry.head.recordIndex),
    } : null;
    const merged = mergeRecord(entry?.record || null, patch, experimentId);
    previewIdentities.push(identity || {
      id: experimentId,
      projectId,
      canonicalLabel: patch.label,
      aliases: [patch.label],
    });
    previewRecords.push(merged.record);
    previewHeads.push({
      id: entry?.head?.id || `preview_head_${index + 1}`,
      projectId,
      experimentId,
      dataSnapshotId: "experiment_data_preview",
      recordIndex: index,
    });
    merged.changes.forEach((change) => {
      if (change.columnId) changedColumnIds.push(change.columnId);
    });
    rowChanges.push({
      candidateId: candidate.candidateId,
      experimentId,
      label: patch.label,
      identityStatus: candidate.status,
      changes: merged.changes,
      preservedFieldCount: Math.max(
        asArray(merged.record.fields).length - patch.upsertFields.length,
        0,
      ),
    });
  });
  const previewSnapshot = {
    id: "experiment_data_preview",
    projectId,
    status: "accepted",
    acceptedAt: new Date(0).toISOString(),
    experimentRecords: previewRecords,
  };
  const projection = buildExperimentProjection({
    projectId,
    dataSnapshots: [previewSnapshot],
    experimentIdentities: previewIdentities,
    experimentSnapshotHeads: previewHeads,
    limit: Math.min(Math.max(previewRecords.length, 1), 1_000),
  });
  const exclusions = asArray(raw.exclusions).map((item, index) => ({
    label: text(item?.label) || `Excluded input ${index + 1}`,
    reason: text(item?.reason) || "Excluded by the accepted data plan.",
  }));
  const baseHeadRefs = patches.flatMap((patch) => (
    patch.baseSnapshotRef ? [clone(patch.baseSnapshotRef)] : []
  ));
  const result = {
    recordPatches: patches,
    identityCandidates: candidates,
    previewRecords,
    rowChanges,
    projection,
    browserView: proposedBrowserView(raw.browserView, projection, [...new Set(changedColumnIds)]),
    exclusions,
    baseHeadRefs,
    summary: {
      experimentCount: previewRecords.length,
      newExperimentCount: candidates.filter((candidate) => candidate.status === "create").length,
      reusedExperimentCount: candidates.filter((candidate) => candidate.status === "reuse").length,
      conflictCount: candidates.filter((candidate) => candidate.status === "conflict").length,
      newFieldCount: rowChanges.flatMap((row) => row.changes)
        .filter((change) => change.kind === "new_field").length,
      changedFieldCount: rowChanges.flatMap((row) => row.changes)
        .filter((change) => change.kind === "changed_field").length,
      newSeriesCount: rowChanges.flatMap((row) => row.changes)
        .filter((change) => change.kind === "new_series").length,
      changedSeriesCount: rowChanges.flatMap((row) => row.changes)
        .filter((change) => change.kind === "changed_series").length,
      preservedFieldCount: rowChanges
        .reduce((total, row) => total + Number(row.preservedFieldCount || 0), 0),
      missingValueCount: patches.reduce((total, patch) => (
        total + patch.upsertFields.filter((field) => field.value === null).length
      ), 0),
      missingExperimentCount: patches.filter((patch) => (
        patch.upsertFields.some((field) => field.value === null)
      )).length,
      excludedCount: exclusions.length,
    },
    execution: {
      adapter: executorResult?.adapter || "unknown",
      runtime: executorResult?.runtime || {},
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (bytes > 100 * 1024 * 1024) {
    errors.push(error(
      "experiment_browser_result_too_large",
      "The Experiment Browser result exceeds the 100 MB review limit.",
      { bytes },
    ));
  }
  const validation = {
    ok: errors.length === 0,
    errors,
    warnings,
    recordCount: previewRecords.length,
    conflictCount: result.summary.conflictCount,
    totalSeriesPoints,
  };
  return {
    ok: validation.ok,
    result,
    validation,
    errors,
    warnings,
    contentHash: stableDataHash(result),
    resultPreviewHash: stableDataHash({
      projection,
      rowChanges,
      identityCandidates: candidates,
      exclusions,
      browserView: result.browserView,
      validation,
    }),
  };
}

export function applyExperimentRecordPatches({
  projectId,
  result,
  activeContext,
  identityResolutions = [],
  identityFactory,
} = {}) {
  const resolutionByCandidate = new Map(asArray(identityResolutions)
    .map((item) => [text(item?.candidateId), item]));
  const identities = [];
  const experimentRecords = [];
  const rowChanges = [];
  const usedExperimentIds = new Set();
  asArray(result?.recordPatches).forEach((patch, index) => {
    const candidate = asArray(result?.identityCandidates)[index];
    const resolution = resolutionByCandidate.get(candidate?.candidateId) || null;
    const action = resolution?.action || candidate?.suggestedAction;
    const reuseId = text(resolution?.experimentId || candidate?.suggestedExperimentId);
    let identity;
    let entry = null;
    if (action === "reuse") {
      identity = activeContext.identityById.get(reuseId);
      entry = activeContext.entryByExperimentId.get(reuseId);
      if (!identity || !entry) {
        throw analysisError(
          "identity_reuse_not_found",
          `The selected experiment identity for ${patch.label} is not active.`,
          422,
          { candidateId: candidate?.candidateId, experimentId: reuseId || null },
        );
      }
    } else if (action === "create") {
      const normalizedLabel = normalizeAlias(patch.label);
      if (activeContext.experimentIdentities.some((candidate) => (
        identityMatches(candidate, normalizedLabel)
      ))) {
        throw analysisError(
          "identity_resolution_stale",
          `Experiment identity ${patch.label} was created after this preview. Revise or rerun before publishing.`,
          409,
          { candidateId: candidate?.candidateId },
        );
      }
      identity = identityFactory(patch.label);
    } else {
      throw analysisError(
        "identity_resolution_required",
        `Resolve the experiment identity for ${patch.label} before publishing.`,
        422,
        { candidateId: candidate?.candidateId },
      );
    }
    if (usedExperimentIds.has(identity.id)) {
      throw analysisError(
        "identity_resolution_duplicate",
        "Two output records cannot publish to the same experiment identity.",
        422,
        { experimentId: identity.id },
      );
    }
    usedExperimentIds.add(identity.id);
    const merged = mergeRecord(entry?.record || null, {
      ...patch,
      baseSnapshotRef: entry ? {
        experimentId: entry.identity.id,
        headId: entry.head.id,
        dataSnapshotId: entry.head.dataSnapshotId,
        recordIndex: Number(entry.head.recordIndex),
      } : null,
    }, identity.id);
    identities.push({
      ...clone(identity),
      aliases: [...new Set([
        ...asArray(identity.aliases),
        patch.label,
      ].map(text).filter(Boolean))],
    });
    experimentRecords.push(merged.record);
    rowChanges.push({
      candidateId: candidate.candidateId,
      experimentId: identity.id,
      label: patch.label,
      changes: merged.changes,
    });
  });
  return { identities, experimentRecords, rowChanges };
}

export const experimentBrowserAnalysisLimits = Object.freeze({
  maxExperimentSelections: MAX_EXPERIMENT_SELECTIONS,
  maxRecordPatches: MAX_RECORD_PATCHES,
  maxFieldsPerPatch: MAX_FIELDS_PER_PATCH,
  maxSeriesPerPatch: MAX_SERIES_PER_PATCH,
  maxSeriesPoints: MAX_SERIES_POINTS,
});
