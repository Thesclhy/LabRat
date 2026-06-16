import { buildProjectDataCatalog, searchProjectDataCatalog, slug } from "./projectDataCatalog.js";

export const IMPORT_RELATIONSHIP_PREVIEW_VERSION = "labrat.importRelationshipPreview.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

function normalizedImportsFromPatch(datasetPatch = {}) {
  return asArray(isObject(datasetPatch) ? datasetPatch.genericImports : []).filter(isObject);
}

function fileText(genericImport) {
  return slug([
    genericImport?.fileName,
    genericImport?.fileId,
    ...asArray(genericImport?.files).map((file) => file?.fileName),
  ].join(" "));
}

function experimentLabels(genericImport) {
  return unique([
    ...asArray(genericImport?.experiments).map((experiment) => experiment?.label || experiment?.name),
    ...asArray(genericImport?.observationSets).map((set) => set?.inferredExperimentLabel),
  ]);
}

function fieldsText(genericImport) {
  return slug([
    ...asArray(genericImport?.fields).map((field) => field?.displayName || field?.field || field?.fieldId),
    ...asArray(genericImport?.observationSets).flatMap((set) => [
      set?.kind,
      set?.inferredExperimentLabel,
      ...asArray(set?.fields).map((field) => field?.displayName || field?.field),
    ]),
  ].join(" "));
}

function detectSupplementType(genericImport) {
  const text = `${fileText(genericImport)} ${fieldsText(genericImport)}`;
  if (/\brate\b|\breaction rate\b|\btime\b|\bmin\b|\bhour\b/.test(text)) return "reaction_rate_time_series";
  if (/\bgc\b|\barea\b|\banalyte\b|\bpeak\b/.test(text)) return "instrument_detail";
  if (/\bc\s*[0-9]+\b|\bcarbon number\b|\bdistribution\b/.test(text)) return "component_distribution";
  return "supplemental_data";
}

function targetExperimentsFromImport(genericImport, catalog) {
  const labels = experimentLabels(genericImport);
  const text = slug([
    fileText(genericImport),
    fieldsText(genericImport),
    ...labels,
  ].join(" "));
  const filenameMatches = [];
  const filenameNumbers = [];
  const re = /\bexp(?:eriment)?\s*0*([0-9]+)\b/g;
  let match = re.exec(text);
  while (match) {
    filenameNumbers.push(Number(match[1]));
    filenameMatches.push(`exp${match[1]}`, `experiment ${Number(match[1])}`);
    match = re.exec(text);
  }
  const experimentEntries = asArray(catalog.entries).filter((entry) => entry.kind === "experiment");
  let matches = [];
  if (filenameNumbers.length) {
    experimentEntries.forEach((entry) => {
      const entryNumbers = [
        entry.label,
        ...asArray(entry.aliases),
      ].map((value) => slug(value).match(/\bexp(?:eriment)?\s*0*([0-9]+)\b/)?.[1]).filter(Boolean);
      if (entryNumbers.some((number) => filenameNumbers.includes(Number(number)))) {
        matches.push({ ...entry, retrievalScore: 10 });
      }
    });
  } else {
    const candidates = unique(labels);
    matches = candidates.flatMap((candidate) => (
      searchProjectDataCatalog(catalog, candidate, { kinds: ["experiment"], limit: 5 })
    ));
  }
  const byExperiment = new Map();
  matches.forEach((entry) => {
    const experimentId = entry.experimentIds?.[0];
    if (!experimentId) return;
    const current = byExperiment.get(experimentId);
    if (!current || entry.retrievalScore > current.retrievalScore) byExperiment.set(experimentId, entry);
  });
  return [...byExperiment.values()].sort((a, b) => b.retrievalScore - a.retrievalScore);
}

function overlapWithCurrentImport(genericImport, catalog) {
  const labels = new Set(experimentLabels(genericImport).map(slug));
  if (!labels.size) return [];
  return asArray(catalog.entries)
    .filter((entry) => entry.kind === "experiment")
    .filter((entry) => asArray(entry.aliases).some((alias) => labels.has(slug(alias))))
    .map((entry) => entry.importIds?.[0])
    .filter(Boolean);
}

function proposalId(importRunId, relationship, targetIds) {
  return `relationship_${slug(`${importRunId}_${relationship}_${targetIds.join("_")}`, "proposal").replace(/\s+/g, "_")}`;
}

export function buildImportRelationshipPreview({
  project,
  parentCommit,
  datasetPatch = {},
  importRunId = null,
  mappingSets = [],
  chartSpecs = [],
} = {}) {
  const catalog = buildProjectDataCatalog({
    project,
    datasetCommit: parentCommit,
    mappingSets,
    chartSpecs,
  });
  const normalizedImports = normalizedImportsFromPatch(datasetPatch);
  const warnings = [
    ...asArray(catalog.warnings),
    ...(!normalizedImports.length ? [{
      code: "normalized_import_required",
      message: "Relationship preview requires a normalized import preview.",
      severity: "warning",
    }] : []),
  ];
  const proposals = normalizedImports.map((genericImport, index) => {
    const targets = targetExperimentsFromImport(genericImport, catalog);
    const overlapImportIds = unique(overlapWithCurrentImport(genericImport, catalog));
    const targetExperimentIds = targets.map((entry) => entry.experimentIds?.[0]).filter(Boolean);
    const evidence = [];
    if (targets.length) {
      evidence.push(...targets.slice(0, 3).map((entry) => `Matched existing experiment ${entry.label}.`));
    }
    if (/\bexp/i.test(genericImport.fileName || "")) {
      evidence.push("Filename contains an experiment-like label.");
    }
    if (fieldsText(genericImport)) {
      evidence.push("Normalized fields can be compared with the project data catalog.");
    }

    let relationship = "standalone_import";
    let confidence = 0.52;
    if (targetExperimentIds.length === 1) {
      relationship = "supplement";
      confidence = Math.min(0.95, 0.72 + (targets[0].retrievalScore || 0) * 0.03);
    } else if (targetExperimentIds.length > 1 && overlapImportIds.length) {
      relationship = "replace_import";
      confidence = 0.72;
      evidence.push("Uploaded data overlaps multiple existing experiment labels.");
    } else if (!genericImport.experiments?.length && !genericImport.fields?.length) {
      relationship = "ignore";
      confidence = 0.5;
      evidence.push("No normalized experiments or fields were found.");
    }

    return {
      relationshipProposalId: proposalId(importRunId || genericImport.importId || `import_${index + 1}`, relationship, targetExperimentIds),
      importRunId,
      importId: genericImport.importId || null,
      proposedRelationship: relationship,
      supplementType: relationship === "supplement" ? detectSupplementType(genericImport) : null,
      targetExperimentIds,
      targetImportId: relationship === "replace_import" ? overlapImportIds[0] || null : null,
      evidence,
      confidence: Number(confidence.toFixed(3)),
      warnings: !targetExperimentIds.length && relationship === "standalone_import" ? [{
        code: "relationship_target_unclear",
        message: "No existing experiment target was confidently matched.",
        severity: "warning",
      }] : [],
      status: "proposed",
    };
  });

  return {
    schemaVersion: IMPORT_RELATIONSHIP_PREVIEW_VERSION,
    projectId: project?.id || parentCommit?.projectId || null,
    parentDatasetCommitId: parentCommit?.id || null,
    importRunId,
    proposals,
    summary: {
      proposalCount: proposals.length,
      supplementCount: proposals.filter((proposal) => proposal.proposedRelationship === "supplement").length,
      replaceCount: proposals.filter((proposal) => proposal.proposedRelationship === "replace_import").length,
      standaloneCount: proposals.filter((proposal) => proposal.proposedRelationship === "standalone_import").length,
    },
    warnings,
  };
}

export function annotateSupplementDatasetPatch(datasetPatch = {}, relationshipDecision = {}) {
  const targetExperimentIds = unique(asArray(relationshipDecision.targetExperimentIds));
  const supplementType = relationshipDecision.supplementType || "supplemental_data";
  const appliedAt = new Date().toISOString();
  const relationship = {
    schemaVersion: "labrat.importRelationship.v1",
    relationship: "supplement",
    supplementType,
    targetExperimentIds,
    targetImportId: relationshipDecision.targetImportId || null,
    relationshipProposalId: relationshipDecision.relationshipProposalId || null,
    appliedAt,
  };
  const annotateObservationRecord = (item) => (
    item?.recordKind === "observation"
      ? { ...item, relatedExperimentIds: unique([...asArray(item.relatedExperimentIds), ...targetExperimentIds]) }
      : item
  );
  return {
    ...datasetPatch,
    genericImports: normalizedImportsFromPatch(datasetPatch).map((genericImport) => ({
      ...genericImport,
      relationship,
      relatedExperimentIds: unique([
        ...asArray(genericImport.relatedExperimentIds),
        ...targetExperimentIds,
      ]),
      observationSets: asArray(genericImport.observationSets).map((set) => ({
        ...set,
        relationship,
        targetExperimentIds: unique([...asArray(set.targetExperimentIds), ...targetExperimentIds]),
      })),
      fields: asArray(genericImport.fields).map(annotateObservationRecord),
      measurements: asArray(genericImport.measurements).map(annotateObservationRecord),
    })),
  };
}
