import {
  GENERIC_IMPORT_SCHEMA_VERSION,
  shapeNormalizeResponse,
} from "../schemas/normalizationSchemas.js";

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

function normalizeStandardTableBlock({ block }, context) {
  const table = block.table;
  const rows = asArray(table?.rows);
  const columns = asArray(table?.columns);
  if (!table || !rows.length || !columns.length) {
    return {
      experiments: [],
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
  const measurements = [];
  rows.forEach((row, rowIndex) => {
    const firstValue = asArray(row.values).find(valuePresent);
    const experimentId = `${context.importId}_exp_${experiments.length + 1}`;
    const sourceRef = context.sources.add(firstValue?.source || table.source || block.source, block.blockId);
    const experiment = {
      experimentId,
      name: firstValue?.rawValue ? String(firstValue.rawValue) : `${context.sheetName || "Sheet"} row ${row.rowIndex || rowIndex + 1}`,
      sourceBlockId: block.blockId,
      sourceRef,
      metadata: [],
      warnings: [],
    };
    experiments.push(experiment);

    asArray(row.values).forEach((cellValue) => {
      if (!valuePresent(cellValue)) return;
      const column = columns.find((candidate) => candidate.columnId === cellValue.columnId) || {};
      const displayName = column.rawName || column.label || cellValue.columnId || "Value";
      const override = context.mappingOverrides[cellValue.columnId] || context.mappingOverrides[displayName] || {};
      const source = cellValue.source || column.source || table.source || block.source;
      measurements.push({
        measurementId: `${context.importId}_measurement_${measurements.length + 1}`,
        experimentId,
        field: slug(override.field || displayName, `field_${measurements.length + 1}`),
        displayName: override.displayName || displayName,
        value: cellValue.value ?? null,
        rawValue: cellValue.rawValue ?? "",
        unit: override.unit || column.unit || null,
        rowIndex: row.rowIndex ?? null,
        columnId: cellValue.columnId || null,
        sourceRef: context.sources.add(source, block.blockId),
        confidence: column.confidence ?? block.confidence ?? null,
        warnings: [],
      });
    });
  });

  return { experiments, measurements, warnings: [] };
}

function normalizeBlockTableBlock({ block }, context) {
  const table = block.table;
  const columns = asArray(table?.columns);
  const rows = asArray(table?.rows);
  if (!table || !columns.length || !rows.length) {
    return {
      experiments: [],
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
      };
    }),
    warnings: [],
  };

  const measurements = [];
  rows.forEach((row) => {
    asArray(row.values).forEach((cellValue) => {
      if (!valuePresent(cellValue)) return;
      const column = columns.find((candidate) => candidate.columnId === cellValue.columnId) || {};
      const displayName = column.rawName || column.label || cellValue.columnId || "Value";
      const override = context.mappingOverrides[cellValue.columnId] || context.mappingOverrides[displayName] || {};
      measurements.push({
        measurementId: `${context.importId}_measurement_${context.measurementOffset + measurements.length + 1}`,
        experimentId,
        field: slug(override.field || displayName, `field_${context.measurementOffset + measurements.length + 1}`),
        displayName: override.displayName || displayName,
        value: cellValue.value ?? null,
        rawValue: cellValue.rawValue ?? "",
        unit: override.unit || column.unit || null,
        rowIndex: row.rowIndex ?? null,
        columnId: cellValue.columnId || null,
        sourceRef: context.sources.add(cellValue.source || column.source || table.source || block.source, block.blockId),
        confidence: column.confidence ?? block.confidence ?? null,
        warnings: [],
      });
    });
  });

  return {
    experiments: [experiment],
    measurements,
    warnings: [],
  };
}

export function normalizeApprovedScan({ scanResult, approvedBlockIds, mappingOverrides = {}, userEdits = {} }) {
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
    createdAt: userEdits.createdAt || new Date().toISOString(),
    sourceScanSchemaVersion: scanResult?.schemaVersion || null,
    approvedBlockIds,
    experiments: [],
    measurements: [],
    sources: [],
    files: [{
      fileId: scanResult?.file?.fileId || null,
      fileName: scanResult?.file?.name || "",
      fileType: scanResult?.file?.type || null,
      sizeBytes: scanResult?.file?.sizeBytes ?? null,
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
      experimentOffset: genericImport.experiments.length,
      measurementOffset: genericImport.measurements.length,
    };
    const normalized = block.type === "standard_table"
      ? normalizeStandardTableBlock({ sheet, block }, context)
      : block.type === "experiment_block"
        ? normalizeBlockTableBlock({ sheet, block }, context)
        : { experiments: [], measurements: [], warnings: [unsupportedBlockWarning(block)] };
    genericImport.experiments.push(...normalized.experiments);
    genericImport.measurements.push(...normalized.measurements);
    genericImport.warnings.push(...normalized.warnings);
  });

  genericImport.sources = sources.values();
  const confidenceValues = matchedBlocks
    .map(({ block }) => block.confidence)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  genericImport.confidence = confidenceValues.length
    ? Number((confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length).toFixed(3))
    : null;

  const genericImports = genericImport.experiments.length || genericImport.measurements.length || genericImport.warnings.length
    ? [genericImport]
    : [];

  return shapeNormalizeResponse({
    datasetPatch: { genericImports },
    warnings: [],
  });
}
