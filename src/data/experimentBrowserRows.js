import { getMasterImports } from "./genericImportRelationships.js";
import { formatExperimentDateForDisplay } from "../utils/date.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

function isAcceptedMapping(mapping) {
  return mapping?.status === "accepted";
}

function sourceLabel(source) {
  if (!source) return "";
  return [source.sheet, source.range || source.cell].filter(Boolean).join(" ");
}

function isDateLikeField(item) {
  const text = [
    item?.field,
    item?.fieldId,
    item?.canonicalField,
    item?.displayName,
    item?.rawLabel,
  ].filter(Boolean).join(" ").toLowerCase();
  return item?.valueType === "date" || /(^|[^a-z])date([^a-z]|$)/.test(text) || text.includes("_date");
}

export function formatGenericFieldValue(item) {
  const value = item?.value ?? item?.rawValue;
  if (value == null || value === "") return "";
  if (isDateLikeField(item)) return formatExperimentDateForDisplay(value);
  const display = item?.formattedValue || value;
  return item.unit ? `${display} ${item.unit}` : String(display);
}

function displayValue(item) {
  return formatGenericFieldValue(item);
}

function compactValues(items) {
  const values = unique(items.map(displayValue).filter(Boolean));
  if (values.length <= 3) return values.join(", ");
  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

function mappingKey(mapping) {
  return mapping.canonicalField || mapping.rawLabel || mapping.mappingId || "mapped_field";
}

export function buildAcceptedMappingColumns(mappingSets = []) {
  const columns = [];
  const seen = new Set();
  asArray(mappingSets).forEach((mappingSet) => {
    asArray(mappingSet?.mappings).forEach((mapping) => {
      if (!isAcceptedMapping(mapping)) return;
      const key = mappingKey(mapping);
      if (seen.has(key)) return;
      seen.add(key);
      columns.push({
        key,
        label: mapping.canonicalField || mapping.rawLabel || key,
        rawLabel: mapping.rawLabel || key,
        unit: mapping.unit || null,
        semanticRole: mapping.semanticRole || "",
        mappingId: mapping.mappingId || null,
      });
    });
  });
  return columns;
}

function itemId(item) {
  return item.fieldValueId || item.measurementId || item.metadataId;
}

function fieldsForExperiment(genericImport, experiment) {
  const fields = asArray(genericImport.fields).filter((field) => field.experimentId === experiment.experimentId);
  if (fields.length) return fields;
  return [
    ...asArray(experiment.metadata).map((item) => ({ ...item, role: item.role || "metadata", fieldValueId: item.metadataId })),
    ...asArray(genericImport.measurements)
      .filter((measurement) => measurement.experimentId === experiment.experimentId)
      .map((item) => ({ ...item, role: item.role || "measurement", fieldValueId: item.measurementId })),
  ];
}

function roleCounts(fields) {
  return fields.reduce((counts, field) => {
    const role = field.role || "metadata";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

export function buildAcceptedMappingIndex(mappingSets = []) {
  const bySourceId = new Map();
  asArray(mappingSets).forEach((mappingSet) => {
    asArray(mappingSet?.mappings).forEach((mapping) => {
      if (!isAcceptedMapping(mapping)) return;
      asArray(mapping.sourceIds).forEach((sourceId) => {
        if (sourceId) bySourceId.set(sourceId, mapping);
      });
    });
  });
  return bySourceId;
}

function mappedFieldsForRecord({ fields, mappingIndex }) {
  const grouped = new Map();
  fields.forEach((item) => {
    const id = itemId(item);
    const mapping = mappingIndex.get(id);
    if (!mapping) return;
    const key = mappingKey(mapping);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: mapping.canonicalField || mapping.rawLabel || item.displayName || item.field || key,
        rawLabel: mapping.rawLabel || item.displayName || item.field || key,
        unit: mapping.unit || item.unit || null,
        semanticRole: mapping.semanticRole || "",
        status: mapping.status,
        mappingId: mapping.mappingId || null,
        values: [],
      });
    }
    grouped.get(key).values.push(item);
  });
  return [...grouped.values()].map((field) => ({
    ...field,
    value: compactValues(field.values),
    count: field.values.length,
  }));
}

export function buildGenericBrowserRows(dataset = {}) {
  const mappingIndex = buildAcceptedMappingIndex(dataset.genericMappingSets);
  const acceptedMappingColumns = buildAcceptedMappingColumns(dataset.genericMappingSets);
  const rows = [];
  getMasterImports(dataset).forEach((genericImport) => {
    const sourcesByRef = new Map(asArray(genericImport.sources).map((source) => [source.sourceRef, source]));
    asArray(genericImport.experiments).forEach((experiment, index) => {
      const fields = fieldsForExperiment(genericImport, experiment);
      const counts = roleCounts(fields);
      const measurements = fields.filter((field) => (field.role || "metadata") === "measurement");
      const metadata = fields.filter((field) => !["identifier", "measurement", "ignored"].includes(field.role || "metadata"));
      const sourceRefs = unique([
        experiment.sourceRef,
        ...fields.map((item) => item.sourceRef),
      ]);
      const primarySource = sourcesByRef.get(experiment.sourceRef) || sourcesByRef.get(sourceRefs[0]) || null;
      const warnings = [
        ...asArray(experiment.warnings),
        ...fields.flatMap((item) => asArray(item.warnings)),
      ];
      const mappedFields = mappedFieldsForRecord({ fields, mappingIndex });
      const mappedByKey = new Map(mappedFields.map((field) => [field.key, field]));
      const acceptedMappingValues = Object.fromEntries(acceptedMappingColumns.map((column) => {
        const mapped = mappedByKey.get(column.key);
        return [column.key, {
          ...column,
          value: mapped?.value || "",
          count: mapped?.count || 0,
          status: mapped?.status || "accepted",
        }];
      }));
      rows.push({
        rowId: `generic:${genericImport.importId || "import"}:${experiment.experimentId || index}`,
        kind: "generic",
        label: experiment.name || experiment.label || experiment.experimentId || `Imported experiment ${index + 1}`,
        sourceFile: genericImport.fileName || primarySource?.fileName || "",
        sourceRange: sourceLabel(primarySource),
        sourceRefs,
        importId: genericImport.importId || null,
        experimentId: experiment.experimentId || null,
        sourceBlockId: experiment.sourceBlockId || null,
        fieldCount: fields.filter((field) => !["identifier", "ignored"].includes(field.role || "metadata")).length,
        measurementCount: measurements.length,
        metadataCount: metadata.length,
        materialCount: counts.material || 0,
        conditionCount: counts.condition || 0,
        identifierCount: counts.identifier || 0,
        roleCounts: counts,
        warningCount: warnings.length,
        confidence: experiment.confidence ?? genericImport.confidence ?? null,
        mappingStatus: mappedFields.length ? `${mappedFields.length} mapped` : "unmapped",
        mappedFields,
        acceptedMappingColumns,
        acceptedMappingValues,
      });
    });
  });
  return rows;
}

export function getGenericExperimentDetail(dataset = {}, row) {
  if (!row) return null;
  const genericImport = asArray(dataset.genericImports).find((item) => item?.importId === row.importId);
  if (!genericImport) return null;
  const experiment = asArray(genericImport.experiments).find((item) => item?.experimentId === row.experimentId);
  if (!experiment) return null;
  const sourcesByRef = new Map(asArray(genericImport.sources).map((source) => [source.sourceRef, source]));
  const fields = fieldsForExperiment(genericImport, experiment);
  const measurements = fields.filter((field) => (field.role || "metadata") === "measurement");
  const metadata = fields.filter((field) => !["identifier", "measurement", "ignored"].includes(field.role || "metadata"));
  const mappingIndex = buildAcceptedMappingIndex(dataset.genericMappingSets);
  return {
    row,
    genericImport,
    experiment,
    fields,
    measurements,
    metadata,
    mappedFields: mappedFieldsForRecord({ fields, mappingIndex }),
    sources: unique([
      experiment.sourceRef,
      ...fields.map((item) => item.sourceRef),
    ]).map((sourceRef) => sourcesByRef.get(sourceRef)).filter(Boolean),
    warnings: [
      ...asArray(genericImport.warnings),
      ...asArray(experiment.warnings),
      ...fields.flatMap((item) => asArray(item.warnings)),
    ],
  };
}
