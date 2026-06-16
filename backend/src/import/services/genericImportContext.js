function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function slug(value, fallback = "field") {
  const text = String(value || "").trim().toLowerCase()
    .replace(/[%]/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text || /^(n\/a|na|null|none|-|--|—)$/i.test(text)) return null;
  const normalized = text
    .replace(/,/g, "")
    .replace(/\s*%\s*$/g, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueTypeFor(values) {
  const present = values.filter((value) => {
    if (value == null) return false;
    const text = String(value).trim();
    return text && !/^(n\/a|na|null|none|-|--|—)$/i.test(text);
  });
  if (!present.length) return "empty";
  const numericCount = present.filter((value) => numberValue(value) != null).length;
  if (numericCount === present.length) return "numeric";
  if (present.every((value) => /^(true|false|yes|no)$/i.test(String(value).trim()))) return "boolean";
  if (present.every((value) => !Number.isNaN(Date.parse(String(value))))) return "date";
  return "categorical";
}

function semanticHints(label, valueType, targetKind) {
  const key = slug(label, "");
  if (/\b(time|minute|min|hour|hr|date|day)\b/.test(key)) {
    return {
      canonicalField: key.includes("date") ? "date" : "time",
      semanticRole: "time",
      confidence: 0.92,
      rationale: "Label appears to describe elapsed time or date.",
    };
  }
  if (/\b(exp|experiment|run|sample|id|label|name)\b/.test(key)) {
    return {
      canonicalField: key.includes("sample") ? "sample" : "experiment",
      semanticRole: "identifier",
      confidence: 0.86,
      rationale: "Label appears to identify experiments, runs, or samples.",
    };
  }
  if (/\b(conversion|conv|yield|selectivity|sel|rate|signal|intensity|response|balance|distribution|fraction)\b/.test(key)) {
    return {
      canonicalField: key.includes("conv") ? "conversion" : slug(label, "response"),
      semanticRole: "response",
      confidence: 0.84,
      rationale: "Label appears to be a measured response suitable for plotting.",
    };
  }
  if (/\b(temp|temperature|pressure|rpm|speed|catalyst|polymer|solvent|mass|loading|dose|concentration|conc|ph)\b/.test(key)) {
    return {
      canonicalField: key.includes("temp") ? "temperature" : slug(label, "condition"),
      semanticRole: "condition",
      confidence: targetKind === "metadata" ? 0.88 : 0.76,
      rationale: "Label appears to describe an experimental condition.",
    };
  }
  if (/\b(rep|replicate|trial)\b/.test(key)) {
    return {
      canonicalField: "replicate",
      semanticRole: "replicate",
      confidence: 0.78,
      rationale: "Label appears to identify replicate or trial records.",
    };
  }
  return {
    canonicalField: slug(label, targetKind),
    semanticRole: valueType === "numeric" ? "response" : "note",
    confidence: valueType === "numeric" ? 0.62 : 0.52,
    rationale: valueType === "numeric"
      ? "Numeric imported field can be reviewed as a potential response."
      : "Field meaning is not obvious from its label and should be reviewed.",
  };
}

function fieldKey(item) {
  return [
    item.importId,
    item.targetKind,
    slug(item.field || item.displayName || item.rawLabel),
    item.unit || "",
  ].join("|");
}

function addField(fields, item) {
  const key = fieldKey(item);
  if (!fields.has(key)) {
    fields.set(key, {
      fieldId: `${item.targetKind}_${fields.size + 1}_${slug(item.field || item.displayName || item.rawLabel)}`,
      targetKind: item.targetKind,
      fieldRole: item.fieldRole || null,
      importId: item.importId,
      field: item.field || slug(item.displayName || item.rawLabel, item.targetKind),
      displayName: item.displayName || item.rawLabel || item.field || "Field",
      unit: item.unit || null,
      sourceIds: [],
      sourceRefs: [],
      experimentIds: [],
      rowIndexes: [],
      values: [],
      examples: [],
      confidenceValues: [],
    });
  }
  const field = fields.get(key);
  if (item.sourceId) field.sourceIds.push(item.sourceId);
  if (item.sourceRef) field.sourceRefs.push(item.sourceRef);
  if (item.experimentId) field.experimentIds.push(item.experimentId);
  if (item.rowIndex != null) field.rowIndexes.push(item.rowIndex);
  if (item.value != null || item.rawValue != null) field.values.push(item.value ?? item.rawValue);
  if (item.rawValue != null && field.examples.length < 4) field.examples.push(item.rawValue);
  if (typeof item.confidence === "number") field.confidenceValues.push(item.confidence);
}

function normalizedFieldRecord(fieldValue) {
  return {
    targetKind: fieldValue.role === "measurement" ? "measurement" : "metadata",
    sourceId: fieldValue.fieldValueId || fieldValue.measurementId || fieldValue.metadataId,
    sourceRef: fieldValue.sourceRef,
    experimentId: fieldValue.experimentId,
    rowIndex: fieldValue.rowIndex,
    field: fieldValue.field || fieldValue.fieldId,
    displayName: fieldValue.displayName || fieldValue.field || fieldValue.fieldId,
    rawLabel: fieldValue.displayName || fieldValue.field || fieldValue.fieldId,
    value: fieldValue.value,
    rawValue: fieldValue.rawValue,
    unit: fieldValue.unit,
    confidence: fieldValue.confidence,
    fieldRole: fieldValue.role || null,
  };
}

function finalizeField(field) {
  const valueType = valueTypeFor(field.values);
  const hints = semanticHints(field.displayName || field.field, valueType, field.targetKind);
  const numericCount = field.values.filter((value) => numberValue(value) != null).length;
  const confidenceBase = field.confidenceValues.length
    ? field.confidenceValues.reduce((total, value) => total + value, 0) / field.confidenceValues.length
    : hints.confidence;
  return {
    ...field,
    sourceIds: unique(field.sourceIds),
    sourceRefs: unique(field.sourceRefs),
    experimentIds: unique(field.experimentIds),
    rowIndexes: unique(field.rowIndexes),
    examples: unique(field.examples).slice(0, 4),
    valueType,
    numericCount,
    coverageCount: field.values.length,
    canonicalField: hints.canonicalField,
    semanticRole: hints.semanticRole,
    confidence: Number(Math.min(0.98, Math.max(0.3, (confidenceBase + hints.confidence) / 2)).toFixed(3)),
    rationale: hints.rationale,
    warnings: [
      ...(!field.unit && valueType === "numeric" ? [{
        code: "unit_missing",
        message: `${field.displayName} is numeric but has no explicit unit.`,
        severity: "warning",
      }] : []),
      ...(valueType !== "numeric" && hints.semanticRole === "response" ? [{
        code: "non_numeric_response",
        message: `${field.displayName} looks like a response label but values are not all numeric.`,
        severity: "warning",
      }] : []),
    ],
  };
}

export function buildGenericImportContext(options = {}) {
  const selectedIds = new Set(asArray(options.selectedImportIds).filter(Boolean));
  const genericImports = asArray(options.genericImports)
    .filter((item) => isObject(item))
    .filter((item) => !selectedIds.size || selectedIds.has(item.importId));
  const warnings = [];

  if (!genericImports.length) {
    warnings.push({
      code: "no_generic_imports",
      message: "No generic imports were provided for proposal generation.",
      severity: "warning",
    });
  }

  const experimentsById = new Map();
  const sourcesByRef = new Map();
  const measurementFields = new Map();
  const metadataFields = new Map();

  genericImports.forEach((genericImport) => {
    asArray(genericImport.sources).forEach((source) => {
      if (source?.sourceRef) sourcesByRef.set(source.sourceRef, source);
    });
    asArray(genericImport.experiments).forEach((experiment) => {
      if (experiment?.experimentId) experimentsById.set(experiment.experimentId, {
        ...experiment,
        importId: genericImport.importId,
      });
      if (asArray(genericImport.fields).length) return;
      asArray(experiment?.metadata).forEach((metadata) => {
        addField(metadataFields, {
          targetKind: "metadata",
          importId: genericImport.importId,
          sourceId: metadata.metadataId,
          sourceRef: metadata.sourceRef,
          experimentId: experiment.experimentId,
          field: metadata.field,
          displayName: metadata.displayName || metadata.field,
          rawLabel: metadata.displayName || metadata.field,
          value: metadata.value,
          rawValue: metadata.rawValue,
          unit: metadata.unit,
          confidence: metadata.confidence,
        });
      });
    });
    if (asArray(genericImport.fields).length) {
      asArray(genericImport.fields).forEach((fieldValue) => {
        const normalized = normalizedFieldRecord(fieldValue);
        addField(normalized.targetKind === "measurement" ? measurementFields : metadataFields, {
          ...normalized,
          importId: genericImport.importId,
        });
      });
      return;
    }
    asArray(genericImport.measurements).forEach((measurement) => {
      addField(measurementFields, {
        targetKind: "measurement",
        importId: genericImport.importId,
        sourceId: measurement.measurementId,
        sourceRef: measurement.sourceRef,
        experimentId: measurement.experimentId,
        rowIndex: measurement.rowIndex,
        field: measurement.field,
        displayName: measurement.displayName || measurement.field,
        rawLabel: measurement.displayName || measurement.field,
        value: measurement.value,
        rawValue: measurement.rawValue,
        unit: measurement.unit,
        confidence: measurement.confidence,
      });
    });
  });

  return {
    sourceImportIds: genericImports.map((item) => item.importId).filter(Boolean),
    genericImports,
    experimentsById,
    sourcesByRef,
    measurementFields: [...measurementFields.values()].map(finalizeField),
    metadataFields: [...metadataFields.values()].map(finalizeField),
    warnings,
  };
}

export function isPlainObject(value) {
  return isObject(value);
}

export function asArrayValue(value) {
  return asArray(value);
}
