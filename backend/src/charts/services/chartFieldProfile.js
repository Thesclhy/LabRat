function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

export function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim().replace(/,/g, "").replace(/\s*%\s*$/g, "");
  if (!text || /^(n\/a|na|null|none|-|--)$/i.test(text)) return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function variance(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

function importRecords(genericImports) {
  const rows = new Map();
  asArray(genericImports).forEach((genericImport) => {
    const fields = asArray(genericImport.fields);
    const records = fields.length ? fields : [
      ...asArray(genericImport.measurements),
      ...asArray(genericImport.metadata),
    ];
    records.forEach((field) => {
      const id = field.fieldValueId || field.measurementId || field.metadataId;
      if (!id) return;
      const rowKey = `${field.experimentId || ""}|${field.rowIndex ?? ""}`;
      rows.set(id, {
        id,
        rowKey,
        experimentId: field.experimentId || null,
        rowIndex: field.rowIndex ?? null,
        value: field.value ?? field.rawValue ?? null,
      });
    });
  });
  return rows;
}

export function buildFieldProfiles(fields = []) {
  const totalRows = Math.max(1, ...asArray(fields).map((field) => asArray(field.rowIndexes).length || field.coverageCount || 0));
  const profiles = new Map();
  asArray(fields).forEach((field) => {
    const values = asArray(field.values).length ? asArray(field.values) : asArray(field.examples);
    const presentValues = values.filter((value) => {
      const text = String(value ?? "").trim();
      return text && !/^(n\/a|na|null|none|-|--)$/i.test(text);
    });
    const numericValues = presentValues.map(numberValue).filter((value) => value != null);
    const uniqueValues = unique(presentValues);
    const min = numericValues.length ? Math.min(...numericValues) : null;
    const max = numericValues.length ? Math.max(...numericValues) : null;
    const spread = min != null && max != null ? max - min : 0;
    const numericVariance = variance(numericValues);
    const coverageCount = field.coverageCount || presentValues.length || asArray(field.sourceIds).length || 0;
    const coverageRate = Math.min(1, coverageCount / totalRows);
    const profile = {
      fieldId: field.fieldId,
      field: field.field,
      displayName: field.displayName,
      role: field.role,
      valueType: field.valueType,
      unit: field.unit || null,
      coverageCount,
      coverageRate: Number(coverageRate.toFixed(3)),
      missingRate: Number(Math.max(0, 1 - coverageRate).toFixed(3)),
      numericCount: numericValues.length,
      uniqueCount: uniqueValues.length,
      min,
      max,
      variance: Number(numericVariance.toFixed(6)),
      hasUsefulSpread: field.valueType === "numeric" ? spread > 0 && uniqueValues.length > 1 : uniqueValues.length > 1,
      isMostlyConstant: uniqueValues.length <= 1 || (field.valueType === "numeric" && numericVariance < 1e-12),
    };
    profiles.set(field.fieldId, profile);
  });
  return profiles;
}

export function buildPairProfile(xField, yField, genericImports = [], groupByField = null) {
  const records = importRecords(genericImports);
  const xIds = new Set(asArray(xField?.sourceIds));
  const yIds = new Set(asArray(yField?.sourceIds));
  const groupIds = new Set(asArray(groupByField?.sourceIds));
  const xByRow = new Map();
  const yByRow = new Map();
  const groupRows = new Set();

  records.forEach((record) => {
    if (xIds.has(record.id)) xByRow.set(record.rowKey, record);
    if (yIds.has(record.id)) yByRow.set(record.rowKey, record);
    if (groupIds.has(record.id)) groupRows.add(record.rowKey);
  });

  const pairedRows = [...yByRow.keys()].filter((rowKey) => xByRow.has(rowKey));
  const xValues = pairedRows.map((rowKey) => numberValue(xByRow.get(rowKey)?.value)).filter((value) => value != null);
  const yValues = pairedRows.map((rowKey) => numberValue(yByRow.get(rowKey)?.value)).filter((value) => value != null);
  return {
    pairedCount: pairedRows.length,
    xSpread: xValues.length > 1 ? Math.max(...xValues) - Math.min(...xValues) : 0,
    ySpread: yValues.length > 1 ? Math.max(...yValues) - Math.min(...yValues) : 0,
    groupCoverage: groupByField && pairedRows.length
      ? Number((pairedRows.filter((rowKey) => groupRows.has(rowKey)).length / pairedRows.length).toFixed(3))
      : null,
  };
}

export function buildChartDataProfile({ fields = [], genericImports = [] } = {}) {
  return {
    fieldProfiles: buildFieldProfiles(fields),
    pairProfile: (xField, yField, groupByField = null) => buildPairProfile(xField, yField, genericImports, groupByField),
  };
}
