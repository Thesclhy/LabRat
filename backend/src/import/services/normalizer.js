import {
  GENERIC_IMPORT_SCHEMA_VERSION,
  shapeNormalizeResponse,
} from "../schemas/normalizationSchemas.js";
import { classifyFieldRole } from "../utils/fieldRoleClassifier.js";
import {
  detectReactionRateObservationSet,
  normalizeReactionRateObservationSetBlock,
} from "./reactionRateObservationSet.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function slug(value, fallback = "field") {
  const text = String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function sourceKey(source, blockId) {
  return JSON.stringify({
    fileId: source?.fileId || null,
    fileName: source?.fileName || null,
    sheet: source?.sheet || null,
    cell: source?.cell || null,
    range: source?.range || source?.cell || null,
    blockId: source?.blockId || blockId || null,
    rawValue: source?.rawValue ?? null,
  });
}

function createSourceRegistry() {
  const sources = [];
  const refs = new Map();
  return {
    add(source, blockId) {
      if (!source) return null;
      const key = sourceKey(source, blockId);
      if (refs.has(key)) return refs.get(key);
      const sourceRef = `src_${sources.length + 1}`;
      refs.set(key, sourceRef);
      sources.push({
        sourceRef,
        fileId: source.fileId || null,
        fileName: source.fileName || null,
        sheet: source.sheet || null,
        cell: source.cell || null,
        range: source.range || source.cell || null,
        blockId: source.blockId || blockId || null,
        rawValue: source.rawValue ?? null,
      });
      return sourceRef;
    },
    values() {
      return sources;
    },
  };
}

function findApprovedBlocks(scanResult, approvedBlockIds) {
  const approved = new Set(approvedBlockIds);
  const blocks = [];
  asArray(scanResult?.sheets).forEach((sheet) => {
    asArray(sheet.blocks).forEach((block) => {
      if (approved.has(block.blockId)) blocks.push({ sheet, block });
    });
  });
  return blocks;
}

function blockWarnings(scanResult, approvedBlockIds, matchedBlocks) {
  const matchedIds = new Set(matchedBlocks.map(({ block }) => block.blockId));
  return approvedBlockIds
    .filter((blockId) => !matchedIds.has(blockId))
    .map((blockId) => ({
      code: "approved_block_not_found",
      message: `Approved block ${blockId} was not found in the scan result.`,
      blockId,
      severity: "warning",
    }));
}

function unsupportedBlockWarning(block) {
  return {
    code: "unsupported_block_type",
    message: `Approved block ${block.blockId} has unsupported type ${block.type || "unknown"} and was not normalized.`,
    blockId: block.blockId || null,
    blockType: block.type || "unknown",
    severity: "warning",
  };
}

function valuePresent(value) {
  return value?.value != null || String(value?.rawValue ?? "").trim() !== "";
}

function fieldRoleOverride(context, column, displayName) {
  return context.fieldRoleOverrides?.[column.columnId]
    || context.fieldRoleOverrides?.[displayName]
    || context.fieldRoleOverrides?.[column.fieldId]
    || {};
}

function buildFieldValue({ context, experimentId, cellValue, column, displayName, role, index, source, blockId }) {
  const override = context.mappingOverrides[cellValue.columnId] || context.mappingOverrides[displayName] || {};
  const roleOverride = fieldRoleOverride(context, column, displayName);
  const inferredRole = classifyFieldRole(displayName, { valueType: typeof cellValue.value === "number" ? "numeric" : "unknown" });
  const field = slug(override.field || displayName || column.fieldId, `field_${index}`);
  return {
    fieldValueId: `${context.importId}_field_${context.fieldOffset + index}`,
    experimentId,
    fieldId: column.fieldId || column.columnId || field,
    field,
    role: roleOverride.role || override.role || role || column.role || inferredRole.role || "measurement",
    displayName: override.displayName || displayName,
    canonicalField: override.canonicalField || null,
    value: cellValue.value ?? null,
    rawValue: cellValue.rawValue ?? "",
    unit: override.unit || column.unit || null,
    rowIndex: cellValue.rowIndex ?? null,
    columnId: cellValue.columnId || null,
    sourceRef: context.sources.add(source, blockId),
    confidence: column.confidence ?? context.blockConfidence ?? null,
    warnings: [],
  };
}

function fieldToMetadata(fieldValue, metadataId) {
  return {
    metadataId,
    field: fieldValue.field,
    displayName: fieldValue.displayName,
    value: fieldValue.value,
    rawValue: fieldValue.rawValue,
    unit: fieldValue.unit,
    sourceRef: fieldValue.sourceRef,
    confidence: fieldValue.confidence,
    warnings: fieldValue.warnings,
    role: fieldValue.role,
    fieldValueId: fieldValue.fieldValueId,
  };
}

function fieldToMeasurement(fieldValue, measurementId) {
  return {
    measurementId,
    experimentId: fieldValue.experimentId,
    field: fieldValue.field,
    displayName: fieldValue.displayName,
    value: fieldValue.value,
    rawValue: fieldValue.rawValue,
    unit: fieldValue.unit,
    rowIndex: fieldValue.rowIndex,
    columnId: fieldValue.columnId,
    sourceRef: fieldValue.sourceRef,
    confidence: fieldValue.confidence,
    warnings: fieldValue.warnings,
    role: fieldValue.role,
    fieldValueId: fieldValue.fieldValueId,
  };
}

function labelColumn(columns) {
  return columns.find((column) => column.role === "identifier")
    || columns.find((column) => /\b(label|exp|experiment|run|sample|id)\b/i.test(column.rawName || column.label || ""))
    || columns[0];
}

function normalizeStandardTableBlock({ block }, context) {
  const table = block.table;
  const rows = asArray(table?.rows);
  const columns = asArray(table?.columns);
  if (!table || !rows.length || !columns.length) {
    return {
      experiments: [],
      fields: [],
      measurements: [],
      warnings: [{
        code: "standard_table_empty",
        message: `Approved standard table ${block.blockId} has no table rows or columns to normalize.`,
        blockId: block.blockId,
        severity: "warning",
      }],
    };
  }

  const experiments = [];
  const fields = [];
  const measurements = [];
  const labelCol = labelColumn(columns);
  rows.forEach((row, rowIndex) => {
    const rowValues = asArray(row.values).map((value) => ({ ...value, rowIndex: row.rowIndex ?? null }));
    const labelValue = rowValues.find((value) => value.columnId === labelCol?.columnId && valuePresent(value));
    const firstValue = labelValue || rowValues.find(valuePresent);
    const experimentId = `${context.importId}_exp_${experiments.length + 1}`;
    const sourceRef = context.sources.add(firstValue?.source || table.source || block.source, block.blockId);
    const experiment = {
      experimentId,
      label: firstValue?.rawValue ? String(firstValue.rawValue) : `${context.sheetName || "Sheet"} row ${row.rowIndex || rowIndex + 1}`,
      name: firstValue?.rawValue ? String(firstValue.rawValue) : `${context.sheetName || "Sheet"} row ${row.rowIndex || rowIndex + 1}`,
      sourceBlockId: block.blockId,
      sourceRef,
      confidence: block.confidence ?? null,
      metadata: [],
      warnings: [],
    };
    experiments.push(experiment);

    rowValues.forEach((cellValue) => {
      if (!valuePresent(cellValue)) return;
      const column = columns.find((candidate) => candidate.columnId === cellValue.columnId) || {};
      const displayName = column.rawName || column.label || cellValue.columnId || "Value";
      const source = cellValue.source || column.source || table.source || block.source;
      const fieldValue = buildFieldValue({
        context,
        experimentId,
        cellValue,
        column,
        displayName,
        role: column.role,
        index: fields.length + 1,
        source,
        blockId: block.blockId,
      });
      fields.push(fieldValue);
      if (fieldValue.role === "measurement") {
        measurements.push(fieldToMeasurement(fieldValue, `${context.importId}_measurement_${context.measurementOffset + measurements.length + 1}`));
      } else if (fieldValue.role !== "identifier" && fieldValue.role !== "ignored") {
        experiment.metadata.push(fieldToMetadata(fieldValue, `${experimentId}_meta_${experiment.metadata.length + 1}`));
      }
    });
  });

  return { experiments, fields, measurements, warnings: [] };
}

function normalizeBlockTableBlock({ block }, context) {
  const table = block.table;
  const columns = asArray(table?.columns);
  const rows = asArray(table?.rows);
  if (!table || !columns.length || !rows.length) {
    return {
      experiments: [],
      fields: [],
      measurements: [],
      warnings: [{
        code: "experiment_block_empty",
        message: `Approved experiment block ${block.blockId} has no table rows or columns to normalize.`,
        blockId: block.blockId,
        severity: "warning",
      }],
    };
  }

  const experimentId = `${context.importId}_exp_${context.experimentOffset + 1}`;
  const experimentSource = block.title?.source || block.source || table.source;
  const experiment = {
    experimentId,
    name: block.title?.value || block.title?.rawValue || block.blockId,
    sourceBlockId: block.blockId,
    sourceRef: context.sources.add(experimentSource, block.blockId),
    confidence: block.confidence ?? null,
    metadata: asArray(block.metadata).map((metadata, index) => {
      const displayName = metadata.rawKey || `Metadata ${index + 1}`;
      const override = context.mappingOverrides[displayName] || context.mappingOverrides[metadata.rawKey] || {};
      return {
        metadataId: `${experimentId}_meta_${index + 1}`,
        field: slug(override.field || displayName, `metadata_${index + 1}`),
        displayName: override.displayName || displayName,
        value: metadata.parsedValue ?? metadata.rawValue ?? null,
        rawValue: metadata.rawValue ?? "",
        unit: override.unit || metadata.unit || null,
        sourceRef: context.sources.add(metadata.source, block.blockId),
        confidence: metadata.confidence ?? block.confidence ?? null,
        warnings: [],
        role: "metadata",
      };
    }),
    warnings: [],
  };

  const fields = [];
  const measurements = [];
  asArray(experiment.metadata).forEach((metadata) => {
    fields.push({
      fieldValueId: `${context.importId}_field_${context.fieldOffset + fields.length + 1}`,
      experimentId,
      fieldId: metadata.field,
      field: metadata.field,
      role: metadata.role || "metadata",
      displayName: metadata.displayName,
      canonicalField: null,
      value: metadata.value,
      rawValue: metadata.rawValue,
      unit: metadata.unit,
      rowIndex: null,
      columnId: null,
      sourceRef: metadata.sourceRef,
      confidence: metadata.confidence,
      warnings: metadata.warnings,
    });
  });
  rows.forEach((row) => {
    asArray(row.values).forEach((cellValue) => {
      if (!valuePresent(cellValue)) return;
      const column = columns.find((candidate) => candidate.columnId === cellValue.columnId) || {};
      const displayName = column.rawName || column.label || cellValue.columnId || "Value";
      const fieldValue = buildFieldValue({
        context,
        experimentId,
        cellValue: { ...cellValue, rowIndex: row.rowIndex ?? null },
        column,
        displayName,
        role: column.role,
        index: fields.length + 1,
        source: cellValue.source || column.source || table.source || block.source,
        blockId: block.blockId,
      });
      fields.push(fieldValue);
      if (fieldValue.role === "measurement") {
        measurements.push(fieldToMeasurement(fieldValue, `${context.importId}_measurement_${context.measurementOffset + measurements.length + 1}`));
      }
    });
  });

  return {
    experiments: [experiment],
    fields,
    measurements,
    warnings: [],
  };
}

export function normalizeApprovedScan({ scanResult, approvedBlockIds, approvedStructures = {}, fieldRoleOverrides = {}, mappingOverrides = {}, userEdits = {}, templateId = null }) {
  const matchedBlocks = findApprovedBlocks(scanResult, approvedBlockIds);
  const warnings = blockWarnings(scanResult, approvedBlockIds, matchedBlocks);
  const sources = createSourceRegistry();
  const importId = `import_${slug(scanResult?.file?.fileId || scanResult?.file?.name || "scan")}`;
  const genericImport = {
    importId,
    schemaVersion: GENERIC_IMPORT_SCHEMA_VERSION,
    fileId: scanResult?.file?.fileId || null,
    fileName: scanResult?.file?.name || "",
    fileType: scanResult?.file?.type || null,
    ...(scanResult?.file?.checksumSha256 ? { checksumSha256: scanResult.file.checksumSha256 } : {}),
    createdAt: userEdits.createdAt || new Date().toISOString(),
    sourceScanSchemaVersion: scanResult?.schemaVersion || null,
    approvedBlockIds,
    approvedStructures,
    fieldRoleOverrides,
    templateId,
    experiments: [],
    fields: [],
    measurements: [],
    observationSets: [],
    sources: [],
    files: [{
      fileId: scanResult?.file?.fileId || null,
      fileName: scanResult?.file?.name || "",
      fileType: scanResult?.file?.type || null,
      sizeBytes: scanResult?.file?.sizeBytes ?? null,
      ...(scanResult?.file?.checksumSha256 ? { checksumSha256: scanResult.file.checksumSha256 } : {}),
    }],
    warnings,
    confidence: null,
  };

  matchedBlocks.forEach(({ sheet, block }) => {
    const context = {
      importId,
      sheetName: sheet.name,
      sources,
      mappingOverrides,
      fieldRoleOverrides,
      experimentOffset: genericImport.experiments.length,
      measurementOffset: genericImport.measurements.length,
      fieldOffset: genericImport.fields.length,
      observationSetOffset: genericImport.observationSets.length,
      blockConfidence: block.confidence ?? null,
      fileName: scanResult?.file?.name || "",
    };
    const reactionRateDetection = detectReactionRateObservationSet({
      fileName: scanResult?.file?.name || "",
      sheetName: sheet.name,
      block,
    });
    const normalized = reactionRateDetection
      ? normalizeReactionRateObservationSetBlock({ sheet, block }, context, reactionRateDetection)
      : block.type === "standard_table"
        ? normalizeStandardTableBlock({ sheet, block }, context)
      : block.type === "experiment_block"
        ? normalizeBlockTableBlock({ sheet, block }, context)
        : { experiments: [], measurements: [], warnings: [unsupportedBlockWarning(block)] };
    genericImport.experiments.push(...normalized.experiments);
    genericImport.fields.push(...asArray(normalized.fields));
    genericImport.measurements.push(...normalized.measurements);
    genericImport.observationSets.push(...asArray(normalized.observationSets));
    genericImport.warnings.push(...normalized.warnings);
  });

  genericImport.sources = sources.values();
  const confidenceValues = matchedBlocks
    .map(({ block }) => block.confidence)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  genericImport.confidence = confidenceValues.length
    ? Number((confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length).toFixed(3))
    : null;

  const genericImports = genericImport.experiments.length || genericImport.fields.length || genericImport.measurements.length || genericImport.observationSets.length || genericImport.warnings.length
    ? [genericImport]
    : [];

  return shapeNormalizeResponse({
    datasetPatch: { genericImports },
    warnings: [],
  });
}
