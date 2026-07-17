import {
  DATA_PLAN_SCHEMA_VERSION,
  stableDataHash,
  validateAcceptedEvidenceInputs,
  validateExperimentRecordDataPlan,
} from "./dataPlanSchemas.js";
import { createDataPlanAgentTools } from "./dataPlanAgentTools.js";
import {
  executeDataSnapshotPreview,
  executeExperimentRecordDataSnapshotPreview,
} from "./dataPlanExecutor.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function parseExperimentAlias(query = "", evidence = {}) {
  const fromQuery = text(query).match(/\bexp(?:eriment)?\s*0*([0-9]+)\b/i);
  if (fromQuery) return `Exp${Number(fromQuery[1])}`;
  const source = [
    evidence.experimentAlias,
    evidence.experimentLabel,
    evidence.sheetName,
    evidence.workbookName,
    evidence.description,
  ].join(" ");
  const fromEvidence = source.match(/\bexp\s*0*([0-9]+)\b/i);
  return fromEvidence ? `Exp${Number(fromEvidence[1])}` : text(evidence.sheetName) || "Series 1";
}

function firstCandidate(response) {
  return asArray(response?.candidates)[0] || null;
}

function normalizeAlias(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function interpretationErrors(understanding) {
  return asArray(understanding?.facts).flatMap((fact) => {
    const interpretation = fact?.interpretation || {};
    if (interpretation.excluded === true || ["ignored_region", "metadata_notes"].includes(text(fact?.semanticType))) return [];
    const errors = [];
    if (!["rows", "region"].includes(text(interpretation.experimentAxis))) {
      errors.push({ code: "experiment_axis_required", factId: fact?.factId });
    }
    if (interpretation.experimentAxis === "rows" && !text(interpretation.experimentIdColumn)) {
      errors.push({ code: "experiment_identity_column_required", factId: fact?.factId });
    }
    if (interpretation.experimentAxis === "region" && !text(interpretation.experimentLabel)) {
      errors.push({ code: "experiment_label_required", factId: fact?.factId });
    }
    if (!Number.isInteger(Number(interpretation.headerRow)) || !asArray(interpretation.fields).length) {
      errors.push({ code: "typed_fields_required", factId: fact?.factId });
    }
    const units = new Map();
    asArray(interpretation.fields).forEach((field) => {
      const key = text(field?.semanticKey);
      const set = units.get(key) || new Set();
      if (text(field?.unit)) set.add(text(field.unit));
      units.set(key, set);
    });
    for (const [semanticKey, values] of units.entries()) {
      if (values.size > 1) errors.push({
        code: "incompatible_unit_ambiguity",
        factId: fact?.factId,
        semanticKey,
        units: [...values],
      });
    }
    return errors;
  });
}

function blobsFor(sourceIndexBlobsByDocumentId, sourceDocumentId) {
  if (sourceIndexBlobsByDocumentId instanceof Map) return asArray(sourceIndexBlobsByDocumentId.get(sourceDocumentId));
  return asArray(sourceIndexBlobsByDocumentId?.[sourceDocumentId]);
}

function identityCandidateKey(alias) {
  return `identity_candidate_${stableDataHash({ normalizedAlias: normalizeAlias(alias) }).slice("sha256_".length, "sha256_".length + 16)}`;
}

function compileIdentityBindings(identityDecisions) {
  return asArray(identityDecisions).flatMap((decision) => {
    const sourceAlias = text(decision?.sourceAlias);
    const action = text(decision?.action);
    if (!sourceAlias || !["create", "reuse"].includes(action)) return [];
    return [{
      sourceAlias,
      action,
      identityCandidateKey: action === "create" ? identityCandidateKey(sourceAlias) : null,
      experimentIdentityId: action === "reuse" ? text(decision?.experimentIdentityId) || null : null,
    }];
  }).sort((a, b) => (
    normalizeAlias(a.sourceAlias).localeCompare(normalizeAlias(b.sourceAlias))
    || a.action.localeCompare(b.action)
    || text(a.experimentIdentityId).localeCompare(text(b.experimentIdentityId))
  ));
}

function compileExperimentEvidence({ acceptedUnderstandings, sourceDocuments, sourceIndexBlobsByDocumentId }) {
  const sourceDocumentById = new Map(asArray(sourceDocuments).map((document) => [document.id, document]));
  const sourceEvidence = [];
  const operations = [];
  const dependencyHashes = [];
  const sourceDependencyIds = new Set();

  const orderedUnderstandings = [...asArray(acceptedUnderstandings)].sort((a, b) => (
    text(a?.createdAt).localeCompare(text(b?.createdAt))
    || text(a?.id).localeCompare(text(b?.id))
  ));
  for (const understanding of orderedUnderstandings) {
    dependencyHashes.push({
      kind: "workbook_understanding",
      id: understanding.id,
      version: Number(understanding.version) || 1,
      hash: stableDataHash({
        id: understanding.id,
        version: Number(understanding.version) || 1,
        facts: asArray(understanding.facts),
      }),
    });
    const orderedFacts = [...asArray(understanding.facts)].sort((a, b) => (
      text(a?.sheetName).localeCompare(text(b?.sheetName))
      || text(a?.range).localeCompare(text(b?.range))
      || text(a?.factId).localeCompare(text(b?.factId))
    ));
    for (const fact of orderedFacts) {
      const interpretation = fact?.interpretation || {};
      if (interpretation.excluded === true || ["ignored_region", "metadata_notes"].includes(text(fact?.semanticType))) continue;
      const sourceDocumentId = text(fact?.sourceDocumentId || understanding.sourceDocumentId);
      const sourceDocument = sourceDocumentById.get(sourceDocumentId);
      if (!sourceDocument) {
        const error = new Error(`SourceDocument ${sourceDocumentId || "unknown"} was not found for accepted workbook evidence.`);
        error.code = "accepted_source_document_not_found";
        throw error;
      }
      if (!sourceDependencyIds.has(sourceDocument.id)) {
        const indexBlobs = blobsFor(sourceIndexBlobsByDocumentId, sourceDocument.id);
        dependencyHashes.push({
          kind: "source_document",
          id: sourceDocument.id,
          version: sourceDocument.indexVersion || null,
          hash: stableDataHash({
            id: sourceDocument.id,
            indexVersion: sourceDocument.indexVersion || null,
            updatedAt: sourceDocument.updatedAt || null,
            checksumSha256: sourceDocument.metadata?.checksumSha256 || null,
            indexBlobChecksums: indexBlobs.map((blob) => blob.checksumSha256 || null),
          }),
        });
        sourceDependencyIds.add(sourceDocument.id);
      }
      const evidenceKey = `${understanding.id}:${fact.factId}`;
      sourceEvidence.push({
        evidenceKey,
        workbookUnderstandingId: understanding.id,
        workbookUnderstandingVersion: Number(understanding.version) || 1,
        factId: fact.factId,
        sourceDocumentId: sourceDocument.id,
        fileObjectId: sourceDocument.fileObjectId || null,
        importRunId: sourceDocument.importRunId || null,
        sourceDocumentIndexVersion: sourceDocument.indexVersion || null,
        sheetName: fact.sheetName,
        range: fact.range,
        semanticType: fact.semanticType,
        evidenceStatus: "accepted",
        interpretationHash: stableDataHash(interpretation),
      });
      operations.push(
        {
          op: "read_table_region",
          evidenceKey,
          sourceDocumentId: sourceDocument.id,
          sheetName: fact.sheetName,
          range: fact.range,
        },
        { op: "use_row_as_header", evidenceKey, rowNumber: Number(interpretation.headerRow) },
        {
          op: "bind_experiment_identity",
          evidenceKey,
          experimentAxis: interpretation.experimentAxis,
          column: interpretation.experimentAxis === "rows" ? interpretation.experimentIdColumn : null,
          experimentLabel: interpretation.experimentAxis === "region" ? interpretation.experimentLabel : null,
        },
        {
          op: "bind_fields",
          evidenceKey,
          fields: asArray(interpretation.fields).map((field) => ({
            column: text(field.column).toUpperCase(),
            headerCell: field.headerCell || null,
            fieldKey: field.semanticKey,
            displayName: field.displayName,
            role: field.role,
            valueType: field.valueType,
            unit: field.unit || null,
            confidence: field.confidence ?? interpretation.confidence ?? null,
          })),
        },
        ...(asArray(interpretation.series).length ? [{
          op: "bind_series",
          evidenceKey,
          series: asArray(interpretation.series).map((series) => ({
            seriesKey: series.seriesKey,
            label: series.label,
            xColumn: text(series.xColumn).toUpperCase(),
            yColumn: text(series.yColumn).toUpperCase(),
            xField: series.xSemanticKey,
            yField: series.ySemanticKey,
            xUnit: series.xUnit || null,
            yUnit: series.yUnit || null,
          })),
        }] : []),
        {
          op: "select_data_rows",
          evidenceKey,
          startRow: Number(interpretation.inclusion?.startRow),
          endRow: Number(interpretation.inclusion?.endRow),
          skippedRows: asArray(interpretation.inclusion?.skippedRows).map((item) => ({
            rowNumber: Number(item.rowNumber),
            reason: item.reason || "user_excluded",
          })),
        },
        { op: "emit_experiment_records", evidenceKey },
      );
    }
  }
  return { sourceEvidence, operations, dependencyHashes };
}

function buildIdentityCandidates({ experimentRecords, identityBindings, existingExperimentIdentities }) {
  const groups = new Map();
  asArray(experimentRecords).forEach((record, recordIndex) => {
    const normalized = normalizeAlias(record.label);
    if (!normalized) return;
    const group = groups.get(normalized) || { sourceAlias: record.label, normalizedAlias: normalized, recordIndexes: [] };
    group.recordIndexes.push(recordIndex);
    groups.set(normalized, group);
  });
  return [...groups.values()].map((group) => {
    const matches = asArray(existingExperimentIdentities).filter((identity) => (
      [identity.canonicalLabel, identity.label, ...asArray(identity.aliases)]
        .some((alias) => normalizeAlias(alias) === group.normalizedAlias)
    )).map((identity) => ({
      id: identity.id,
      label: identity.canonicalLabel || identity.label || identity.id,
    }));
    const decision = asArray(identityBindings).find((binding) => normalizeAlias(binding.sourceAlias) === group.normalizedAlias) || null;
    return {
      ...group,
      occurrenceCount: group.recordIndexes.length,
      identityCandidateKey: identityCandidateKey(group.sourceAlias),
      matches,
      decision,
    };
  });
}

function identityBlockers(identityCandidates, experimentRecords) {
  const missingAliases = asArray(experimentRecords).flatMap((record, recordIndex) => (
    normalizeAlias(record?.label) ? [] : [{
      code: "experiment_alias_required",
      recordIndex,
      message: "Every included experiment record requires a non-blank source alias. Correct the accepted row identity or skip the row.",
    }]
  ));
  const candidateBlockers = asArray(identityCandidates).flatMap((candidate) => {
    if (candidate.occurrenceCount > 1) {
      return [{
        code: "duplicate_alias_requires_unique_source_identity",
        sourceAlias: candidate.sourceAlias,
        recordIndexes: candidate.recordIndexes,
        message: `${candidate.sourceAlias} appears in multiple source records. Correct or disambiguate the accepted identities before publish.`,
      }];
    }
    if (!candidate.decision) {
      const code = candidate.matches.length > 1
        ? "identity_match_ambiguous"
        : "identity_decision_required";
      return [{
        code,
        sourceAlias: candidate.sourceAlias,
        message: `Choose whether ${candidate.sourceAlias} creates a new experiment identity or reuses an existing one.`,
      }];
    }
    if (candidate.decision.action === "reuse" && !candidate.matches.some((match) => match.id === candidate.decision.experimentIdentityId)) {
      return [{
        code: "identity_reuse_not_found",
        sourceAlias: candidate.sourceAlias,
        message: `The selected experiment identity for ${candidate.sourceAlias} is not available in this project.`,
      }];
    }
    return [];
  });
  return [...missingAliases, ...candidateBlockers];
}

function reviewFieldSummary(experimentRecords) {
  const groups = new Map();
  asArray(experimentRecords).forEach((record) => {
    asArray(record.fields).forEach((field) => {
      const key = `${field.fieldKey}|${field.unit || ""}|${field.valueType}`;
      const current = groups.get(key) || {
        fieldKey: field.fieldKey,
        displayName: field.displayName,
        role: field.role,
        valueType: field.valueType,
        unit: field.unit || null,
        presentCount: 0,
        sourceRefs: [],
      };
      if (field.value != null) current.presentCount += 1;
      current.sourceRefs.push(...asArray(field.sourceRefs).slice(0, 1));
      groups.set(key, current);
    });
  });
  const recordCount = asArray(experimentRecords).length;
  return [...groups.values()].map((field) => ({
    ...field,
    coverage: recordCount ? field.presentCount / recordCount : 0,
    sourceRefs: field.sourceRefs.slice(0, 3),
  }));
}

export async function runExperimentRecordDataPlan({
  acceptedUnderstandings = [],
  sourceDocuments = [],
  sourceIndexBlobsByDocumentId = {},
  identityDecisions = [],
  existingExperimentIdentities = [],
  readRangePreview = null,
} = {}) {
  const understandings = asArray(acceptedUnderstandings);
  if (!understandings.length || understandings.some((understanding) => understanding?.status !== "accepted")) {
    return {
      resultKind: "clarification",
      clarification: {
        code: "accepted_workbook_understanding_required",
        message: "Select project-owned accepted WorkbookUnderstanding records before drafting Browser data.",
      },
    };
  }
  const structureErrors = understandings.flatMap(interpretationErrors);
  if (structureErrors.length) {
    return {
      resultKind: "clarification",
      clarification: {
        code: "workbook_understanding_incomplete",
        message: "Accepted workbook understanding is missing required experiment, field, or unit semantics.",
        errors: structureErrors,
      },
    };
  }

  let compiled;
  try {
    compiled = compileExperimentEvidence({ acceptedUnderstandings: understandings, sourceDocuments, sourceIndexBlobsByDocumentId });
  } catch (error) {
    return {
      resultKind: "clarification",
      clarification: { code: error.code || "source_evidence_unavailable", message: error.message },
    };
  }
  if (!compiled.sourceEvidence.length) {
    return {
      resultKind: "clarification",
      clarification: { code: "experiment_evidence_required", message: "Accepted understanding contains no experiment-bearing source regions." },
    };
  }
  const identityBindings = compileIdentityBindings(identityDecisions);
  const dependencyHash = stableDataHash(compiled.dependencyHashes);
  const planBase = {
    schemaVersion: DATA_PLAN_SCHEMA_VERSION,
    status: "draft",
    task: "experiment_browser_publish",
    outputShape: "experiment_records",
    sourceEvidence: compiled.sourceEvidence,
    dependencyHashes: compiled.dependencyHashes,
    dependencyHash,
    identityBindings,
    operations: compiled.operations,
  };
  const dataPlan = {
    ...planBase,
    id: `data_plan_preview_${stableDataHash(planBase).slice("sha256_".length, "sha256_".length + 16)}`,
  };
  const validation = validateExperimentRecordDataPlan(dataPlan);
  if (!validation.ok) {
    return {
      resultKind: "clarification",
      clarification: {
        code: "data_plan_validation_failed",
        message: "The accepted workbook interpretation could not be compiled into a valid experiment-record DataPlan.",
        errors: validation.errors,
      },
    };
  }
  const snapshotPreview = await executeExperimentRecordDataSnapshotPreview({ dataPlan, readRangePreview });
  const identityCandidates = buildIdentityCandidates({
    experimentRecords: snapshotPreview.experimentRecords,
    identityBindings,
    existingExperimentIdentities,
  });
  const blockers = identityBlockers(identityCandidates, snapshotPreview.experimentRecords);
  return {
    resultKind: "data_plan_review",
    dataPlan,
    snapshotPreview,
    identityCandidates,
    reviewSummary: {
      experimentRecordCount: snapshotPreview.experimentRecords.length,
      includedRowCount: snapshotPreview.includedRowCount,
      skippedRowCount: snapshotPreview.skippedRows.length,
      fields: reviewFieldSummary(snapshotPreview.experimentRecords),
      sourceRanges: compiled.sourceEvidence.map((evidence) => ({
        evidenceKey: evidence.evidenceKey,
        sourceDocumentId: evidence.sourceDocumentId,
        sheetName: evidence.sheetName,
        range: evidence.range,
      })),
      warnings: snapshotPreview.warnings,
      blockers,
    },
    clarification: null,
  };
}

export async function runDataPlanAgent({
  query = "",
  retrievalResults = [],
  readRangePreview = null,
  planner = null,
} = {}) {
  const acceptedCheck = validateAcceptedEvidenceInputs(retrievalResults);
  if (!acceptedCheck.ok || !acceptedCheck.evidence.length) {
    return {
      resultKind: "clarification",
      planner: { provider: "fallback_data_plan_agent", fallbackUsed: true },
      toolTrace: [],
      clarification: {
        code: "accepted_evidence_required",
        message: "A DataPlan can only be drafted from accepted workbook-understanding evidence.",
        errors: acceptedCheck.errors,
      },
    };
  }

  const tools = createDataPlanAgentTools({ evidenceResults: retrievalResults, readRangePreview });
  if (typeof planner === "function") {
    return planner({ query, retrievalResults, tools, readRangePreview });
  }

  const selectedEvidence = acceptedCheck.evidence[0];
  const evidenceResultId = selectedEvidence.retrievalResultId || asArray(retrievalResults)[0]?.resultId;
  const toolTrace = [];

  const inspected = await tools.inspect_region_schema({ evidenceResultId });
  toolTrace.push({ tool: "inspect_region_schema", status: inspected.error ? "failed" : "completed" });
  if (inspected.error) {
    return {
      resultKind: "clarification",
      planner: { provider: "fallback_data_plan_agent", fallbackUsed: true },
      toolTrace,
      clarification: inspected.error,
    };
  }

  const timeRanking = await tools.rank_candidate_columns({
    schema: inspected.schema,
    targetField: "reaction_time",
  });
  toolTrace.push({
    tool: "rank_candidate_columns",
    targetField: "reaction_time",
    status: "completed",
    resultCount: timeRanking.candidates.length,
  });
  const rateRanking = await tools.rank_candidate_columns({
    schema: inspected.schema,
    targetField: "reaction_rate",
  });
  toolTrace.push({
    tool: "rank_candidate_columns",
    targetField: "reaction_rate",
    status: "completed",
    resultCount: rateRanking.candidates.length,
  });

  const xCandidate = firstCandidate(timeRanking);
  const yCandidate = firstCandidate(rateRanking);
  if (!xCandidate || !yCandidate || xCandidate.column === yCandidate.column) {
    return {
      resultKind: "clarification",
      planner: { provider: "fallback_data_plan_agent", fallbackUsed: true },
      toolTrace,
      clarification: {
        code: "data_plan_binding_ambiguous",
        message: "I could not confidently bind reaction time and reaction rate columns from the selected workbook region.",
        candidates: {
          reaction_time: timeRanking.candidates,
          reaction_rate: rateRanking.candidates,
        },
      },
    };
  }

  const experimentAlias = parseExperimentAlias(query, asArray(retrievalResults)[0] || {});
  const draft = await tools.draft_data_plan({
    query,
    schema: inspected.schema,
    bindings: {
      x: xCandidate,
      y: yCandidate,
    },
    outputShape: "xy_series",
    experimentAlias,
  });
  toolTrace.push({ tool: "draft_data_plan", status: "completed" });

  const validation = await tools.validate_data_plan({ dataPlan: draft.dataPlan });
  toolTrace.push({
    tool: "validate_data_plan",
    status: validation.status,
    errorCount: validation.errors.length,
  });
  if (validation.status !== "valid") {
    return {
      resultKind: "clarification",
      planner: { provider: "fallback_data_plan_agent", fallbackUsed: true },
      toolTrace,
      clarification: {
        code: "data_plan_validation_failed",
        message: "The drafted DataPlan did not pass backend validation.",
        errors: validation.errors,
      },
    };
  }

  const dataSnapshotPreview = await executeDataSnapshotPreview({
    dataPlan: draft.dataPlan,
    readRangePreview,
  });
  toolTrace.push({
    tool: "execute_data_snapshot_preview",
    status: dataSnapshotPreview.status === "failed" ? "failed" : "completed",
  });

  return {
    resultKind: "data_plan_review",
    planner: {
      provider: "fallback_data_plan_agent",
      fallbackUsed: true,
    },
    toolTrace,
    query,
    dataPlanDraft: draft.dataPlan,
    dataSnapshotPreview,
    clarification: null,
  };
}
