function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export const OBSERVATION_SET_SCHEMA_VERSION = "labrat.observationSet.v1";
export const REACTION_RATE_OBSERVATION_SET_KIND = "reaction_rate_time_series";

function slug(value, fallback = "field") {
  const text = String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function normalizedText(value) {
  return String(value || "").toLowerCase()
    .replace(/[%]/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valuePresent(value) {
  return value?.value != null || String(value?.rawValue ?? "").trim() !== "";
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim().replace(/,/g, "").replace(/\s*%\s*$/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function columnText(column) {
  return normalizedText([
    column?.rawName,
    column?.displayName,
    column?.label,
    ...asArray(column?.rawHeaderPath),
  ].filter(Boolean).join(" "));
}

const COLUMN_SPECS = [
  {
    key: "reactionTimeMin",
    field: "reaction_time_min",
    displayName: "Reaction Time (min)",
    unit: "min",
    role: "condition",
    match: (text) => /\btime\b/.test(text)
      && /\bmin\b/.test(text)
      && !/\b(start|end|mean|span|sweep|hours?)\b/.test(text),
  },
  {
    key: "startTimeMin",
    field: "start_time_min",
    displayName: "Start Time (min)",
    unit: "min",
    role: "condition",
    match: (text) => /\bstart time\b/.test(text) && /\bmin\b/.test(text),
  },
  {
    key: "endTimeMin",
    field: "end_time_min",
    displayName: "End Time (min)",
    unit: "min",
    role: "condition",
    match: (text) => /\bend time\b/.test(text) && /\bmin\b/.test(text),
  },
  {
    key: "meanTimeMin",
    field: "mean_time_min",
    displayName: "Mean Time (min)",
    unit: "min",
    role: "condition",
    match: (text) => /\bmean time\b/.test(text) && /\bmin\b/.test(text),
  },
  {
    key: "rateMolPerS",
    field: "rate_mol_s",
    displayName: "Rate (mol/s)",
    unit: "mol/s",
    role: "measurement",
    match: (text) => /\brate\b/.test(text)
      && /\bmol\b/.test(text)
      && /\bs\b/.test(text)
      && !/\badjusted\b/.test(text)
      && !/\baverage\b/.test(text),
  },
  {
    key: "reactionRateMolPerGHour",
    field: "reaction_rate_mol_g_h",
    displayName: "Reaction Rate (mol/g/h)",
    unit: "mol/g/h",
    role: "measurement",
    match: (text) => /\brate\b/.test(text)
      && /\bmol\b/.test(text)
      && /\bg\b/.test(text)
      && /\bh\b/.test(text)
      && !/\badjusted\b/.test(text)
      && !/\baverage\b/.test(text),
  },
  {
    key: "standardDeviation",
    field: "standard_deviation",
    displayName: "Standard Deviation",
    unit: null,
    role: "measurement",
    match: (text) => /\bstandard deviation\b/.test(text) && !/\badjusted\b/.test(text),
  },
  {
    key: "reactionTimeMin",
    field: "reaction_time_min",
    displayName: "Reaction Time (min)",
    unit: "min",
    role: "condition",
    match: (text) => /\breaction time\b/.test(text) && /\bmin\b/.test(text),
  },
  {
    key: "timeSpanMin",
    field: "time_span_min",
    displayName: "Time Span (min)",
    unit: "min",
    role: "condition",
    match: (text) => /\btime span\b/.test(text) && /\bmin\b/.test(text),
  },
  {
    key: "adjustedRateMPerS",
    field: "adjusted_rate_m_s",
    displayName: "Adjusted Rate (M/s)",
    unit: "M/s",
    role: "measurement",
    match: (text) => /\badjusted rate\b/.test(text) && /\bm\b/.test(text) && /\bs\b/.test(text),
  },
  {
    key: "concentrationMolPerL",
    field: "concentration_mol_l",
    displayName: "Concentration (mol/L)",
    unit: "mol/L",
    role: "measurement",
    match: (text) => /\bconcentration\b/.test(text) && /\bmol\b/.test(text) && /\bl\b/.test(text),
  },
  {
    key: "adjustedStdDev",
    field: "adjusted_std_dev",
    displayName: "Adjusted Std. Dev.",
    unit: null,
    role: "measurement",
    match: (text) => /\badjusted\b/.test(text) && /\bstd\b|\bstandard deviation\b/.test(text),
  },
  {
    key: "sweepHours",
    field: "sweep_hours",
    displayName: "Data from Sweep # of Hours",
    unit: "h",
    role: "condition",
    optional: true,
    match: (text) => /\bdata from sweep\b/.test(text) && /\bhours\b/.test(text),
  },
  {
    key: "volumeReduction",
    field: "volume_reduction",
    displayName: "Data from Sweep Volume Reduction",
    unit: null,
    role: "measurement",
    optional: true,
    match: (text) => /\bdata from sweep\b/.test(text) && /\bvolume reduction\b/.test(text),
  },
  {
    key: "averageRateHours",
    field: "average_rate_hours",
    displayName: "Average Rate per Hour # of Hours",
    unit: "h",
    role: "condition",
    optional: true,
    match: (text) => /\baverage rate per hour\b/.test(text) && /\bhours\b/.test(text),
  },
  {
    key: "averageRateMPerS",
    field: "average_rate_m_s",
    displayName: "Average Rate per Hour Average Rate (M/s)",
    unit: "M/s",
    role: "measurement",
    optional: true,
    match: (text) => /\baverage rate per hour\b/.test(text) && /\baverage rate\b/.test(text) && /\bm\b/.test(text) && /\bs\b/.test(text),
  },
];

const REQUIRED_KEYS = [
  "startTimeMin",
  "endTimeMin",
  "meanTimeMin",
  "rateMolPerS",
  "reactionTimeMin",
  "adjustedRateMPerS",
  "concentrationMolPerL",
];

const LIGHTWEIGHT_RATE_KEYS = [
  "rateMolPerS",
  "reactionRateMolPerGHour",
  "adjustedRateMPerS",
  "averageRateMPerS",
];

export function inferExperimentLabelFromReactionRateContext({ fileName, sheetName, block } = {}) {
  const text = [
    fileName,
    sheetName,
    block?.title?.value,
    block?.title?.rawValue,
    ...asArray(block?.table?.columns).flatMap((column) => asArray(column?.rawHeaderPath)),
  ].filter(Boolean).join(" ");
  const match = normalizedText(text).match(/\bexp(?:eriment)?\s*0*([0-9]+)\b/);
  return match ? `Exp${Number(match[1])}` : null;
}

export function detectReactionRateObservationSet({ fileName, sheetName, block } = {}) {
  if (!block || block.type !== "standard_table") return null;
  const columns = asArray(block.table?.columns);
  const matches = new Map();
  columns.forEach((column) => {
    const text = columnText(column);
    COLUMN_SPECS.forEach((spec) => {
      if (!matches.has(spec.key) && spec.match(text)) {
        matches.set(spec.key, { spec, column });
      }
    });
  });
  const requiredFound = REQUIRED_KEYS.filter((key) => matches.has(key));
  const hasFullSchema = requiredFound.length >= REQUIRED_KEYS.length;
  const hasLightweightSchema = matches.has("reactionTimeMin")
    && LIGHTWEIGHT_RATE_KEYS.some((key) => matches.has(key));
  const contextText = normalizedText([
    fileName,
    sheetName,
    block?.title?.value,
    block?.title?.rawValue,
  ].filter(Boolean).join(" "));
  const hasReactionRateContext = /\breaction\b/.test(contextText) && /\brate\b/.test(contextText);
  if (!hasFullSchema && !(hasLightweightSchema && hasReactionRateContext)) return null;
  const inferredExperimentLabel = inferExperimentLabelFromReactionRateContext({ fileName, sheetName, block });
  return {
    kind: REACTION_RATE_OBSERVATION_SET_KIND,
    schemaVersion: OBSERVATION_SET_SCHEMA_VERSION,
    inferredExperimentLabel,
    confidence: hasFullSchema
      ? (inferredExperimentLabel ? 0.94 : 0.88)
      : (inferredExperimentLabel ? 0.86 : 0.78),
    columns: [...matches.values()].map(({ spec, column }) => ({
      key: spec.key,
      field: spec.field,
      displayName: spec.displayName,
      unit: spec.unit,
      role: spec.role,
      columnId: column.columnId,
      sourceColumnName: column.rawName || column.displayName || column.label || column.columnId,
    })),
  };
}

function sourceRefForObservation(observation, key) {
  return observation.sourceRefsByField?.[key] || null;
}

export function normalizeReactionRateObservationSetBlock({ sheet, block }, context, detection) {
  const table = block.table;
  const rows = asArray(table?.rows);
  const columns = asArray(table?.columns);
  const activeDetection = detection || detectReactionRateObservationSet({
    fileName: context.fileName,
    sheetName: sheet?.name || context.sheetName,
    block,
  });
  if (!activeDetection || !rows.length || !columns.length) {
    return null;
  }

  const observationSetId = `${context.importId}_obsset_${context.observationSetOffset + 1}`;
  const columnById = new Map(columns.map((column) => [column.columnId, column]));
  const specByColumnId = new Map(activeDetection.columns.map((item) => [item.columnId, item]));
  const observations = [];
  const fields = [];
  const measurements = [];

  rows.forEach((row) => {
    const rowValues = asArray(row.values).filter((cellValue) => {
      if (!specByColumnId.has(cellValue.columnId)) return false;
      return valuePresent(cellValue);
    });
    if (!rowValues.length) return;
    const observationId = `${observationSetId}_obs_${observations.length + 1}`;
    const observation = {
      observationId,
      rowIndex: row.rowIndex ?? null,
      sourceRefs: [],
      sourceRefsByField: {},
    };

    rowValues.forEach((cellValue) => {
      const matched = specByColumnId.get(cellValue.columnId);
      const column = columnById.get(cellValue.columnId) || {};
      const value = numericValue(cellValue.value ?? cellValue.rawValue);
      const sourceRef = context.sources.add(cellValue.source || column.source || table.source || block.source, block.blockId);
      observation[matched.key] = value ?? cellValue.value ?? cellValue.rawValue ?? null;
      observation.sourceRefs.push(sourceRef);
      observation.sourceRefsByField[matched.key] = sourceRef;
    });
    observation.sourceRefs = [...new Set(observation.sourceRefs.filter(Boolean))];
    observations.push(observation);
  });

  const timeValues = observations
    .map((observation) => numericValue(observation.reactionTimeMin))
    .filter((value) => value != null);
  const observationSet = {
    schemaVersion: OBSERVATION_SET_SCHEMA_VERSION,
    observationSetId,
    kind: REACTION_RATE_OBSERVATION_SET_KIND,
    inferredExperimentLabel: activeDetection.inferredExperimentLabel,
    sourceBlockId: block.blockId,
    sourceSheetName: sheet?.name || context.sheetName || null,
    xField: "reaction_time_min",
    yFields: activeDetection.columns
      .filter((item) => item.role === "measurement" && !/(?:std_dev|standard_deviation)$/.test(item.field))
      .map((item) => item.field),
    fields: activeDetection.columns.map((item) => ({
      key: item.key,
      field: item.field,
      displayName: item.displayName,
      unit: item.unit,
      role: item.role,
      columnId: item.columnId,
      sourceColumnName: item.sourceColumnName,
    })),
    observations: observations.map(({ sourceRefsByField, ...observation }) => observation),
    summary: {
      observationCount: observations.length,
      timeMin: timeValues.length ? Math.min(...timeValues) : null,
      timeMax: timeValues.length ? Math.max(...timeValues) : null,
    },
    confidence: activeDetection.confidence,
    warnings: [],
  };

  observations.forEach((observation) => {
    activeDetection.columns.forEach((matched) => {
      if (!(matched.key in observation)) return;
      const fieldIndex = fields.length + 1;
      const fieldValue = {
        fieldValueId: `${context.importId}_field_${context.fieldOffset + fieldIndex}`,
        experimentId: observationSetId,
        fieldId: matched.columnId || matched.field,
        field: matched.field,
        role: matched.role,
        recordKind: "observation",
        observationSetId,
        observationId: observation.observationId,
        inferredExperimentLabel: activeDetection.inferredExperimentLabel,
        relatedExperimentIds: [],
        displayName: matched.displayName,
        canonicalField: matched.field,
        value: observation[matched.key],
        rawValue: observation[matched.key] == null ? "" : String(observation[matched.key]),
        unit: matched.unit,
        rowIndex: observation.rowIndex,
        columnId: matched.columnId,
        sourceRef: sourceRefForObservation(observation, matched.key),
        confidence: activeDetection.confidence,
        warnings: [],
      };
      fields.push(fieldValue);
      if (fieldValue.role === "measurement") {
        measurements.push({
          measurementId: `${context.importId}_measurement_${context.measurementOffset + measurements.length + 1}`,
          ...fieldValue,
        });
      }
    });
  });

  return {
    experiments: [],
    fields,
    measurements,
    observationSets: [observationSet],
    warnings: [],
  };
}

export function reactionRateFieldSlug(value) {
  return slug(value);
}
