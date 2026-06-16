export const PROJECT_DATA_CATALOG_VERSION = "labrat.projectDataCatalog.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function slug(value, fallback = "") {
  const text = String(value || "").trim().toLowerCase()
    .replace(/[%]/g, " pct ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function compactId(value) {
  return String(value || "").trim();
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

function tokens(value) {
  return slug(value).split(" ").filter(Boolean);
}

function labelAliases(label) {
  const value = String(label || "").trim();
  const normalized = slug(value);
  const aliases = [value, normalized];
  const exp = normalized.match(/\bexp(?:eriment)?\s*0*([0-9]+)\b/);
  if (exp) {
    aliases.push(`exp${exp[1]}`, `experiment ${exp[1]}`, `experiment ${Number(exp[1])}`);
  }
  return unique(aliases);
}

function fieldAliases(field) {
  const display = field?.displayName || field?.field || field?.fieldId || "";
  const canonical = field?.canonicalField || field?.field || "";
  const aliases = [
    display,
    canonical,
    field?.field,
    field?.fieldId,
    slug(display),
    slug(canonical),
  ];
  const text = slug(`${display} ${canonical}`);
  if (/\bgas\b/.test(text) && /\bselectivity\b/.test(text)) aliases.push("gas selectivity", "selectivity gas");
  if (/\bliquid\b/.test(text) && /\bselectivity\b/.test(text)) aliases.push("liquid selectivity", "selectivity liquid");
  if (/\bsolid\b/.test(text) && /\bselectivity\b/.test(text)) aliases.push("solid selectivity", "selectivity solid");
  if (/\btemperature\b|\btemp\b/.test(text)) aliases.push("temperature", "temp");
  if (/\bpressure\b/.test(text)) aliases.push("pressure");
  if (/\brate\b/.test(text)) aliases.push("rate", "reaction rate");
  if (/\badjusted\b/.test(text) && /\brate\b/.test(text)) aliases.push("adjusted rate");
  if (/\bmean\b/.test(text) && /\btime\b/.test(text)) aliases.push("mean time");
  if (/\bstart\b/.test(text) && /\btime\b/.test(text)) aliases.push("start time");
  if (/\bend\b/.test(text) && /\btime\b/.test(text)) aliases.push("end time");
  if (/\breaction\b/.test(text) && /\btime\b/.test(text)) aliases.push("reaction time");
  if (/^c\s*[0-9]+$/.test(text.replace(/\s+/g, " "))) aliases.push(text.replace(/\s+/g, ""));
  return unique(aliases);
}

function sourceByRef(genericImport) {
  const sources = new Map();
  asArray(genericImport?.sources).forEach((source) => {
    if (source?.sourceRef) sources.set(source.sourceRef, source);
  });
  return sources;
}

function sourceSummary(source) {
  if (!source) return {};
  return {
    sourceRef: source.sourceRef || null,
    fileId: source.fileId || null,
    fileName: source.fileName || null,
    sheetName: source.sheet || source.sheetName || null,
    cellRange: source.range || source.cell || null,
    rawValue: source.rawValue ?? null,
  };
}

function importText(genericImport) {
  return [
    genericImport?.fileName,
    genericImport?.fileId,
    ...asArray(genericImport?.files).map((file) => file?.fileName),
  ].filter(Boolean).join(" ");
}

export function genericImportsFromDatasetPayload(datasetPayload = {}) {
  return asArray(isObject(datasetPayload) ? datasetPayload.genericImports : []).filter(isObject);
}

export function buildProjectDataCatalog({
  project,
  datasetCommit,
  mappingSets = [],
  chartSpecs = [],
} = {}) {
  const entries = [];
  const datasetPayload = isObject(datasetCommit?.datasetPayload) ? datasetCommit.datasetPayload : {};
  const genericImports = genericImportsFromDatasetPayload(datasetPayload);

  genericImports.forEach((genericImport) => {
    const importId = genericImport.importId || genericImport.fileId || `import_${entries.length + 1}`;
    const importAliases = unique([
      importId,
      genericImport.fileName,
      genericImport.fileId,
      ...asArray(genericImport.files).map((file) => file?.fileName),
    ]);
    entries.push({
      entryId: `catalog_import_${importId}`,
      kind: "import_run",
      projectId: project?.id || datasetCommit?.projectId || null,
      datasetCommitId: datasetCommit?.id || null,
      label: genericImport.fileName || importId,
      aliases: importAliases,
      importIds: [importId],
      experimentIds: [],
      fieldIds: [],
      sourceRefs: asArray(genericImport.sources).map((source) => source?.sourceRef).filter(Boolean),
      sourceFileName: genericImport.fileName || null,
      textSummary: importText(genericImport),
      metadata: {
        schemaVersion: genericImport.schemaVersion || null,
        fileId: genericImport.fileId || null,
        checksumSha256: genericImport.checksumSha256 || null,
      },
      confidence: genericImport.confidence ?? null,
      warnings: asArray(genericImport.warnings),
    });

    const sources = sourceByRef(genericImport);
    const experimentById = new Map();
    asArray(genericImport.experiments).forEach((experiment, index) => {
      if (!isObject(experiment)) return;
      const experimentId = compactId(experiment.experimentId) || `${importId}_exp_${index + 1}`;
      experimentById.set(experimentId, experiment);
      const source = sources.get(experiment.sourceRef);
      const label = experiment.label || experiment.name || experiment.title || experimentId;
      entries.push({
        entryId: `catalog_experiment_${experimentId}`,
        kind: "experiment",
        projectId: project?.id || datasetCommit?.projectId || null,
        datasetCommitId: datasetCommit?.id || null,
        label,
        aliases: labelAliases(label),
        importIds: [importId],
        experimentIds: [experimentId],
        fieldIds: [],
        sourceRefs: [experiment.sourceRef].filter(Boolean),
        sourceFileName: source?.fileName || genericImport.fileName || null,
        sheetName: source?.sheet || null,
        cellRange: source?.range || source?.cell || null,
        textSummary: `${label} ${genericImport.fileName || ""}`,
        metadata: {
          importId,
          sourceBlockId: experiment.sourceBlockId || null,
        },
        confidence: experiment.confidence ?? genericImport.confidence ?? null,
        warnings: asArray(experiment.warnings),
      });
    });

    asArray(genericImport.observationSets).forEach((observationSet, index) => {
      if (!isObject(observationSet)) return;
      const observationSetId = compactId(observationSet.observationSetId) || `${importId}_obsset_${index + 1}`;
      const label = [
        observationSet.inferredExperimentLabel,
        observationSet.kind === "reaction_rate_time_series" ? "reaction rate time series" : observationSet.kind,
      ].filter(Boolean).join(" ") || observationSetId;
      entries.push({
        entryId: `catalog_observation_set_${observationSetId}`,
        kind: "observation_set",
        projectId: project?.id || datasetCommit?.projectId || null,
        datasetCommitId: datasetCommit?.id || null,
        label,
        aliases: unique([
          observationSetId,
          observationSet.inferredExperimentLabel,
          observationSet.kind,
          "reaction rate",
          "time series",
          ...asArray(observationSet.fields).map((field) => field?.displayName || field?.field),
        ]),
        importIds: [importId],
        experimentIds: asArray(observationSet.targetExperimentIds),
        fieldIds: asArray(observationSet.fields).map((field) => field?.field).filter(Boolean),
        sourceRefs: asArray(observationSet.observations).flatMap((observation) => asArray(observation?.sourceRefs)),
        sourceFileName: genericImport.fileName || null,
        sheetName: observationSet.sourceSheetName || null,
        cellRange: null,
        textSummary: `${label} ${asArray(observationSet.fields).map((field) => field?.displayName || field?.field).join(" ")}`,
        metadata: {
          importId,
          observationSetId,
          kind: observationSet.kind || null,
          inferredExperimentLabel: observationSet.inferredExperimentLabel || null,
          observationCount: observationSet.summary?.observationCount ?? asArray(observationSet.observations).length,
        },
        confidence: observationSet.confidence ?? genericImport.confidence ?? null,
        warnings: asArray(observationSet.warnings),
      });
    });

    const fieldValues = asArray(genericImport.fields).length
      ? asArray(genericImport.fields)
      : [
        ...asArray(genericImport.metadata).map((field) => ({ ...field, role: field?.role || "metadata" })),
        ...asArray(genericImport.measurements).map((field) => ({ ...field, role: field?.role || "measurement" })),
      ];
    fieldValues.forEach((field, index) => {
      if (!isObject(field)) return;
      const experiment = experimentById.get(field.experimentId);
      const source = sources.get(field.sourceRef);
      const fieldValueId = field.fieldValueId || field.measurementId || field.metadataId || `${importId}_field_${index + 1}`;
      const label = field.displayName || field.field || field.fieldId || fieldValueId;
      const role = field.role || (field.measurementId ? "measurement" : "metadata");
      const experimentIds = unique([
        field.experimentId,
        ...asArray(field.relatedExperimentIds),
      ]);
      entries.push({
        entryId: `catalog_field_${fieldValueId}`,
        kind: "field",
        projectId: project?.id || datasetCommit?.projectId || null,
        datasetCommitId: datasetCommit?.id || null,
        label,
        aliases: fieldAliases(field),
        importIds: [importId],
        experimentIds,
        fieldIds: [fieldValueId, field.fieldId, field.field].filter(Boolean),
        sourceRefs: [field.sourceRef].filter(Boolean),
        sourceFileName: source?.fileName || genericImport.fileName || null,
        sheetName: source?.sheet || null,
        cellRange: source?.range || source?.cell || null,
        role,
        unit: field.unit || null,
        valueType: typeof field.value === "number" ? "numeric" : "unknown",
        textSummary: `${experiment?.label || experiment?.name || field.inferredExperimentLabel || ""} ${label} ${field.rawValue ?? field.value ?? ""}`,
        metadata: {
          importId,
          experimentId: field.experimentId || null,
          relatedExperimentIds: asArray(field.relatedExperimentIds),
          recordKind: field.recordKind || null,
          observationSetId: field.observationSetId || null,
          observationId: field.observationId || null,
          fieldValueId,
          field: field.field || null,
          fieldId: field.fieldId || null,
          canonicalField: field.canonicalField || null,
          value: field.value ?? null,
          rawValue: field.rawValue ?? null,
          rowIndex: field.rowIndex ?? null,
          columnId: field.columnId || null,
          source: sourceSummary(source),
        },
        confidence: field.confidence ?? genericImport.confidence ?? null,
        warnings: asArray(field.warnings),
      });
    });
  });

  asArray(mappingSets).filter(isObject).forEach((set) => {
    asArray(set.payload?.mappings).forEach((mapping) => {
      if (!isObject(mapping)) return;
      entries.push({
        entryId: `catalog_mapping_${set.id}_${mapping.mappingId || entries.length}`,
        kind: "mapping",
        projectId: project?.id || set.projectId || null,
        datasetCommitId: set.datasetCommitId || datasetCommit?.id || null,
        label: mapping.rawLabel || mapping.canonicalField || mapping.mappingId || "Mapping",
        aliases: unique([mapping.rawLabel, mapping.canonicalField, mapping.semanticRole]),
        importIds: asArray(set.payload?.sourceImportIds),
        experimentIds: [],
        fieldIds: asArray(mapping.sourceIds),
        sourceRefs: asArray(mapping.sourceRefs),
        role: mapping.semanticRole || null,
        textSummary: `${mapping.rawLabel || ""} ${mapping.canonicalField || ""} ${mapping.semanticRole || ""}`,
        metadata: {
          mappingSetId: set.id,
          mappingId: mapping.mappingId || null,
          status: mapping.status || set.status || null,
        },
        confidence: mapping.confidence ?? null,
        warnings: asArray(mapping.warnings),
      });
    });
  });

  asArray(chartSpecs).filter(isObject).forEach((chartSpec) => {
    entries.push({
      entryId: `catalog_chart_spec_${chartSpec.id}`,
      kind: "chart_spec",
      projectId: project?.id || chartSpec.projectId || null,
      datasetCommitId: chartSpec.datasetCommitId || null,
      label: chartSpec.title || chartSpec.id,
      aliases: unique([chartSpec.title, chartSpec.chartType]),
      importIds: asArray(chartSpec.spec?.sourceImportIds),
      experimentIds: [],
      fieldIds: [
        chartSpec.spec?.x?.fieldId,
        chartSpec.spec?.y?.fieldId,
        ...asArray(chartSpec.spec?.yFields).map((field) => field?.fieldId),
      ].filter(Boolean),
      sourceRefs: asArray(chartSpec.spec?.sourceRefs),
      textSummary: `${chartSpec.title || ""} ${chartSpec.chartType || ""}`,
      metadata: {
        chartSpecId: chartSpec.id,
        chartType: chartSpec.chartType || chartSpec.spec?.chartType || null,
      },
      confidence: null,
      warnings: asArray(chartSpec.warnings),
    });
  });

  return {
    schemaVersion: PROJECT_DATA_CATALOG_VERSION,
    projectId: project?.id || datasetCommit?.projectId || null,
    datasetCommitId: datasetCommit?.id || null,
    entries,
    summary: {
      entryCount: entries.length,
      experimentCount: entries.filter((entry) => entry.kind === "experiment").length,
      observationSetCount: entries.filter((entry) => entry.kind === "observation_set").length,
      fieldCount: entries.filter((entry) => entry.kind === "field").length,
      importCount: entries.filter((entry) => entry.kind === "import_run").length,
    },
    warnings: !datasetCommit ? [{
      code: "dataset_commit_required",
      message: "Project does not have a current dataset commit.",
      severity: "warning",
    }] : [],
  };
}

function entryHaystack(entry) {
  return slug([
    entry.label,
    entry.textSummary,
    entry.sourceFileName,
    entry.sheetName,
    ...asArray(entry.aliases),
    ...asArray(entry.fieldIds),
    ...asArray(entry.experimentIds),
  ].join(" "));
}

export function scoreCatalogEntry(entry, query) {
  const normalized = slug(query);
  if (!normalized) return 0;
  const haystack = entryHaystack(entry);
  const queryTokens = tokens(normalized);
  let score = 0;
  if (haystack.includes(normalized)) score += 4;
  asArray(entry.aliases).forEach((alias) => {
    const normalizedAlias = slug(alias);
    if (normalizedAlias && normalized.includes(normalizedAlias)) score += 3;
    if (normalizedAlias && haystack.includes(normalizedAlias)) score += 1;
  });
  queryTokens.forEach((token) => {
    if (token.length > 1 && haystack.includes(token)) score += 1;
  });
  if (entry.kind === "experiment" && /\bexp(?:eriment)?\s*[0-9]+\b/.test(normalized)) score += 2;
  if (entry.kind === "field" && /\b(rate|selectivity|conversion|yield|temperature|pressure|c[0-9]+)\b/.test(normalized)) score += 1;
  return score;
}

export function searchProjectDataCatalog(catalog, query, { kinds = [], limit = 50 } = {}) {
  const allowed = new Set(asArray(kinds).filter(Boolean));
  return asArray(catalog?.entries)
    .filter((entry) => !allowed.size || allowed.has(entry.kind))
    .map((entry) => ({ entry, score: scoreCatalogEntry(entry, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.label).localeCompare(String(b.entry.label)))
    .slice(0, limit)
    .map(({ entry, score }) => ({ ...entry, retrievalScore: score }));
}
