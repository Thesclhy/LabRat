import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { readLinkedRegionSeries, resolveLinkedRegionsForExperiments, selectRegionSeries } from "./linkedRegionSeries.js";
import { makeId } from "./ids.js";
import {
  allocateSelectionOrderStyles,
  resolveReusableChartGeometry,
} from "./reusableChartGeometry.js";

export const REUSABLE_CHART_TEMPLATE_APPLICATION_SCHEMA_VERSION = "labrat.reusableChartTemplateApplication.v1";
export const REUSABLE_CHART_TEMPLATE_SLOT_BINDING_SCHEMA_VERSION = "labrat.reusableChartTemplateSlotBinding.v1";
export const CHART_TEMPLATE_EXECUTION_STRATEGY = "chart_template_v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function copy(value) {
  return structuredClone(value);
}

function applicationError(code, message, statusCode = 400, details = undefined) {
  throw Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details === undefined ? {} : { details }),
  });
}

function normalizedType(value) {
  const type = text(value).toLowerCase();
  return type === "numeric" ? "number" : type;
}

function displayedNumericValue(field) {
  const unit = text(field?.unit).toLowerCase();
  return field?.numericScale === "fraction" && new Set(["percent", "%", "percentage"]).has(unit)
    ? field.value * 100
    : field.value;
}

function fieldSignature(field) {
  return stableDataHash({
    columnId: text(field?.columnId),
    displayName: text(field?.displayName || field?.fieldKey),
    valueType: normalizedType(field?.valueType),
    unit: text(field?.unit),
    numericScale: text(field?.numericScale),
  });
}

function contractMatch(field, slot) {
  const allowedUnits = asArray(slot?.unitContract?.allowedUnits).map(text);
  return normalizedType(field?.valueType) === normalizedType(slot?.identityContract?.valueType)
    && text(field?.numericScale) === text(slot?.identityContract?.numericScale)
    && (!allowedUnits.length || allowedUnits.includes(text(field?.unit)));
}

function readableMatch(field, slot) {
  return contractMatch(field, slot)
    && text(field?.displayName || field?.fieldKey).toLowerCase()
      === text(slot?.identityContract?.readableName).toLowerCase();
}

function blocker(code, message, details = {}) {
  return { code, message, ...details };
}

function linkedSlotsOf(templateVersion) {
  return asArray(templateVersion?.inputSlots).filter((slot) => text(slot?.sourceKind) === "linked_region");
}

export function isLinkedSeriesTemplate(templateVersion) {
  return linkedSlotsOf(templateVersion).length > 0;
}

function validateExperimentCount(templateVersion, selectedExperimentIds) {
  if (new Set(selectedExperimentIds).size !== selectedExperimentIds.length) {
    applicationError("chart_template_experiment_count_invalid", "Each experiment may be selected only once.");
  }
  const limits = templateVersion?.experimentCardinality || {};
  if (
    selectedExperimentIds.length < Number(limits.minimum || 1)
    || selectedExperimentIds.length > Number(limits.hardMaximum || 12)
  ) {
    applicationError(
      "chart_template_experiment_count_invalid",
      `Select between ${Number(limits.minimum || 1)} and ${Number(limits.hardMaximum || 12)} experiments.`,
      422,
    );
  }
}

function seriesContractProblem(slot, series) {
  const contract = slot?.seriesContract || {};
  const expectedOrientation = text(contract.orientation);
  if (expectedOrientation && text(series?.orientation) !== expectedOrientation) {
    return { code: "chart_template_series_shape_mismatch", message: `The linked series is laid out as ${text(series?.orientation) || "unknown"}, but the template expects ${expectedOrientation}.` };
  }
  const allowedUnits = asArray(slot?.unitContract?.allowedUnits).map(text).filter(Boolean);
  if (allowedUnits.length && !allowedUnits.includes(text(series?.yUnit))) {
    return { code: "chart_template_unit_incompatible", message: `The linked series unit ${text(series?.yUnit) || "(none)"} does not match the template unit ${allowedUnits.join(", ")}.` };
  }
  const expectedScale = text(slot?.identityContract?.numericScale || contract.yNumericScale);
  if (expectedScale && text(series?.yNumericScale) && text(series.yNumericScale) !== expectedScale) {
    return { code: "chart_template_unit_incompatible", message: `The linked series stores ${text(series.yNumericScale)} values, but the template expects ${expectedScale}.` };
  }
  return null;
}

/**
 * Resolves a linked-region template against experiments by data kind, reads
 * each series once to confirm its shape, and reports exclusions per the
 * template's missing-series policy. No snapshot is touched.
 */
export async function prepareLinkedSeriesTemplateApplication({ store, projectId, templateVersion, experimentIds, explicitBindings = [] } = {}) {
  const linkedSlots = linkedSlotsOf(templateVersion);
  if (linkedSlots.length !== 1 || linkedSlots.length !== asArray(templateVersion?.inputSlots).length) {
    applicationError("chart_template_slot_mix_unsupported", "Workbook series templates use exactly one linked-region slot and no snapshot slots.", 422);
  }
  if (asArray(explicitBindings).length) {
    applicationError("chart_template_binding_invalid", "Linked-region slots bind by data kind and accept no column bindings.", 422);
  }
  const slot = linkedSlots[0];
  const selectedExperimentIds = asArray(experimentIds).map(text).filter(Boolean);
  validateExperimentCount(templateVersion, selectedExperimentIds);
  const resolved = await resolveLinkedRegionsForExperiments({ store, projectId, dataKind: slot.linkedDataKind, experimentIds: selectedExperimentIds });
  if (resolved.unknownExperimentIds.length) {
    applicationError("chart_template_input_missing", "A selected experiment does not belong to this project.", 422, { experimentIds: resolved.unknownExperimentIds });
  }
  const policy = text(templateVersion?.missingDataPolicy?.missingSeries) || "exclude_experiment";
  const excluded = [];
  const warnings = [];
  const ready = [];
  for (const missing of resolved.missingExperiments) {
    excluded.push({
      experimentId: missing.experimentId,
      label: missing.label,
      code: missing.reason === "session_deleted" ? "chart_template_session_deleted" : "chart_template_input_missing",
      message: missing.reason === "session_deleted"
        ? `${missing.label}: the workbook that held its ${resolved.dataKind} was deleted from review.`
        : `${missing.label} has no confirmed ${resolved.dataKind} linked to it.`,
    });
  }
  for (const experiment of resolved.experiments) {
    const selector = slot.seriesContract?.seriesSelector || null;
    const series = selectRegionSeries(experiment.series, selector);
    if (!series) {
      const wanted = text(selector?.label || selector?.seriesKey);
      const available = experiment.series.map((item) => text(item?.label || item?.seriesKey)).filter(Boolean);
      excluded.push({
        experimentId: experiment.experimentId,
        label: experiment.label,
        code: "chart_template_series_shape_mismatch",
        message: wanted
          ? `${experiment.label}: the linked region has no "${wanted}" series (it defines ${available.length ? available.join(", ") : "none"}).`
          : `${experiment.label}: the linked region defines ${experiment.series.length} series; the template cannot tell which one to use.`,
      });
      continue;
    }
    const problem = seriesContractProblem(slot, series);
    if (problem) {
      excluded.push({ experimentId: experiment.experimentId, label: experiment.label, code: problem.code, message: `${experiment.label}: ${problem.message}` });
      continue;
    }
    let read;
    try {
      read = await readLinkedRegionSeries({
        store,
        projectId,
        region: { sourceDocumentId: experiment.sourceDocumentId, sheetName: experiment.sheetName, range: experiment.range },
        series,
        headerRow: experiment.headerRow,
        inclusion: experiment.inclusion,
      });
    } catch (error) {
      if (["chart_template_range_too_large", "chart_template_series_shape_mismatch", "chart_template_series_outside_region", "chart_template_source_document_missing"].includes(error?.code)) {
        excluded.push({ experimentId: experiment.experimentId, label: experiment.label, code: error.code, message: `${experiment.label}: ${error.message}` });
        continue;
      }
      throw error;
    }
    if (!read.valueCount) {
      excluded.push({ experimentId: experiment.experimentId, label: experiment.label, code: "chart_template_input_missing", message: `${experiment.label}: every point in ${experiment.sheetName}!${experiment.range} is missing (${[...new Set(read.points.map((point) => point.missingReason))].join(", ")}).` });
      continue;
    }
    if (experiment.alternativeRegionIds.length) {
      warnings.push({ code: "chart_template_multiple_regions", message: `${experiment.label} has ${experiment.alternativeRegionIds.length + 1} linked ${resolved.dataKind} regions; the most recently confirmed one is used.`, experimentId: experiment.experimentId });
    }
    ready.push({ ...experiment, read, seriesKey: text(series.seriesKey) || null, seriesLabel: text(series.label) || null });
  }
  const blockers = [];
  if (policy === "block") {
    excluded.forEach((item) => blockers.push(blocker(item.code, item.message, { experimentId: item.experimentId })));
  }
  if (!ready.length) {
    blockers.push(blocker("chart_template_input_missing", `No selected experiment has usable linked ${resolved.dataKind} data.`, { experimentIds: selectedExperimentIds }));
  }
  const categories = [];
  const seen = new Set();
  ready.forEach((item) => item.read.points.forEach((point) => {
    const key = point.x == null ? null : String(point.x);
    if (key == null || seen.has(key)) return;
    seen.add(key);
    categories.push(key);
  }));
  const status = blockers.length ? "blocked" : "ready";
  const sourceSelections = status === "ready" ? ready.map((item, index) => ({
    sourceSelectionId: `template_source_selection_${index + 1}`,
    regionUnderstandingRevisionId: item.revisionId,
    sourceDocumentId: item.sourceDocumentId,
    workbookName: item.workbookName,
    sheetName: item.sheetName,
    range: item.range,
    label: item.label,
    purpose: `Apply reusable chart template ${templateVersion.reusableChartTemplateId}.`,
  })) : [];
  const frozenRegionRefs = ready.map((item) => ({
    experimentId: item.experimentId,
    label: item.label,
    regionId: item.regionId,
    regionUnderstandingRevisionId: item.revisionId,
    workbookReviewSessionId: item.workbookReviewSessionId,
    sourceDocumentId: item.sourceDocumentId,
    workbookName: item.workbookName,
    sheetName: item.sheetName,
    range: item.range,
    seriesKey: item.seriesKey,
    seriesLabel: item.seriesLabel,
  }));
  return {
    schemaVersion: "labrat.reusableChartTemplateCompatibility.v1",
    status,
    sourceKind: "linked_region",
    linkedDataKind: resolved.dataKind,
    templateVersionId: templateVersion.id,
    experimentCount: ready.length,
    experiments: ready.map((item) => ({
      experimentId: item.experimentId,
      label: item.label,
      region: { regionId: item.regionId, regionUnderstandingRevisionId: item.revisionId, workbookName: item.workbookName, sheetName: item.sheetName, range: item.range },
      pointCount: item.read.pointCount,
      valueCount: item.read.valueCount,
      missingCount: item.read.missingCount,
      missingCategories: categories.filter((category) => !item.read.points.some((point) => String(point.x) === category && !point.missing)),
    })),
    excludedExperiments: excluded,
    warnings,
    resolvedBindings: [{
      slotId: slot.slotId,
      mode: "data_kind",
      linkedDataKind: resolved.dataKind,
      valueType: "series",
      unit: asArray(slot.unitContract?.allowedUnits)[0] || null,
      sourceSignature: text(slot.identityContract?.sourceSignature) || null,
      explicit: false,
    }],
    executionBindings: [],
    blockers,
    experimentSelections: [],
    sourceSelections,
    frozenHeadRefs: [],
    frozenRegionRefs,
    alignment: { categories, policy: text(slot.seriesContract?.alignmentPolicy) || "union_with_gaps" },
    linkedSeries: status === "ready" ? ready.map((item) => ({
      experimentId: item.experimentId,
      label: item.label,
      regionId: item.regionId,
      regionUnderstandingRevisionId: item.revisionId,
      orientation: item.read.orientation,
      yUnit: item.read.yUnit,
      yNumericScale: item.read.yNumericScale,
      points: copy(item.read.points),
      sourceRefs: copy(item.read.sourceRefs),
    })) : [],
  };
}

export async function prepareReusableChartTemplateApplication({
  store,
  projectId,
  templateVersion,
  experimentIds,
  explicitBindings = [],
} = {}) {
  if (isLinkedSeriesTemplate(templateVersion)) {
    return prepareLinkedSeriesTemplateApplication({ store, projectId, templateVersion, experimentIds, explicitBindings });
  }
  const selectedExperimentIds = asArray(experimentIds).map(text).filter(Boolean);
  validateExperimentCount(templateVersion, selectedExperimentIds);
  const heads = await store.listExperimentSnapshotHeads({ projectId });
  const headByExperimentId = new Map(heads.map((head) => [head.experimentId, head]));
  const selected = [];
  for (const experimentId of selectedExperimentIds) {
    const head = headByExperimentId.get(experimentId);
    const snapshot = head ? await store.findDataSnapshotById(head.dataSnapshotId) : null;
    const record = snapshot?.experimentRecords?.[Number(head?.recordIndex)];
    if (!head || !snapshot || snapshot.projectId !== projectId || snapshot.status !== "accepted" || !record) {
      applicationError(
        "chart_template_input_missing",
        "A selected experiment does not have an active accepted snapshot.",
        422,
        { experimentId },
      );
    }
    selected.push({
      experimentId,
      label: text(record.label) || experimentId,
      head: {
        experimentId,
        headId: head.id,
        dataSnapshotId: head.dataSnapshotId,
        recordIndex: Number(head.recordIndex),
      },
      record,
    });
  }

  const activeBindings = await store.listReusableChartTemplateSlotBindings({
    reusableChartTemplateVersionId: templateVersion.id,
    status: "active",
  });
  const slotIds = new Set(asArray(templateVersion.inputSlots).map((slot) => text(slot?.slotId)));
  const explicitSlotIds = new Set();
  for (const binding of asArray(explicitBindings)) {
    const slotId = text(binding?.slotId);
    if (!slotIds.has(slotId) || !text(binding?.columnId) || explicitSlotIds.has(slotId)) {
      applicationError(
        "chart_template_binding_invalid",
        "Explicit bindings must reference each known template slot at most once and name a column.",
        422,
        { slotId: slotId || null },
      );
    }
    explicitSlotIds.add(slotId);
  }
  const explicitBySlot = new Map(asArray(explicitBindings).map((binding) => [text(binding?.slotId), binding]));
  const activeBySlot = new Map(activeBindings.map((binding) => [binding.slotId, binding]));
  const blockers = [];
  const resolvedBindings = [];

  for (const slot of asArray(templateVersion.inputSlots)) {
    const explicit = explicitBySlot.get(slot.slotId);
    const prior = activeBySlot.get(slot.slotId);
    const requestedColumnId = text(explicit?.columnId || prior?.columnId || slot.identityContract?.preferredColumnId);
    let mode = explicit ? "explicit" : prior ? "reviewed" : "exact";
    let columnId = requestedColumnId;
    let fields = selected.map((item) => asArray(item.record.fields).find((field) => text(field?.columnId) === columnId));

    if (!fields.every(Boolean) && !explicit && !prior) {
      const candidateSets = selected.map((item) => asArray(item.record.fields).filter((field) => readableMatch(field, slot)));
      const commonIds = candidateSets.length
        ? [...new Set(candidateSets[0].map((field) => text(field.columnId)))].filter((candidateId) => (
          candidateSets.every((candidates) => candidates.some((field) => text(field.columnId) === candidateId))
        ))
        : [];
      if (commonIds.length === 1) {
        blockers.push(blocker(
          "chart_template_input_ambiguous",
          `Confirm the field binding for ${slot.label}.`,
          { slotId: slot.slotId, status: "confirmation_required", candidates: commonIds },
        ));
        continue;
      }
      if (commonIds.length > 1) {
        blockers.push(blocker(
          "chart_template_input_ambiguous",
          `Multiple fields could fill ${slot.label}.`,
          { slotId: slot.slotId, status: "ambiguous", candidates: commonIds },
        ));
        continue;
      }
    }

    if (!columnId || !fields.every(Boolean)) {
      blockers.push(blocker(
        "chart_template_input_missing",
        `The required input ${slot.label} is missing from one or more experiments.`,
        {
          slotId: slot.slotId,
          columnId: columnId || null,
          experimentIds: selected.filter((_, index) => !fields[index]).map((item) => item.experimentId),
        },
      ));
      continue;
    }
    const incompatibleIndexes = fields.flatMap((field, index) => contractMatch(field, slot) ? [] : [index]);
    if (incompatibleIndexes.length) {
      blockers.push(blocker(
        "chart_template_unit_incompatible",
        `The required input ${slot.label} has an incompatible type or unit.`,
        {
          slotId: slot.slotId,
          experimentIds: incompatibleIndexes.map((index) => selected[index].experimentId),
        },
      ));
      continue;
    }
    const missingIndexes = fields.flatMap((field, index) => (
      field?.value == null || typeof field.value !== "number" || !Number.isFinite(field.value) ? [index] : []
    ));
    if (missingIndexes.length) {
      blockers.push(blocker(
        "chart_template_input_missing",
        `The required input ${slot.label} has missing scalar values.`,
        {
          slotId: slot.slotId,
          experimentIds: missingIndexes.map((index) => selected[index].experimentId),
        },
      ));
      continue;
    }
    const columnIndexes = fields.map((field, index) => asArray(selected[index].record.fields).indexOf(field));
    resolvedBindings.push({
      slotId: slot.slotId,
      columnId,
      mode,
      valueType: normalizedType(fields[0].valueType),
      unit: text(fields[0].unit) || null,
      sourceSignature: fieldSignature(fields[0]),
      columnIndexes,
      explicit: Boolean(explicit),
    });
  }

  const status = blockers.length ? "blocked" : "ready";
  const experimentSelections = status === "ready" ? selected.map((item, experimentIndex) => ({
    experimentSelectionId: `template_experiment_selection_${experimentIndex + 1}`,
    experimentId: item.experimentId,
    label: item.label,
    columnIndexes: resolvedBindings.map((binding) => binding.columnIndexes[experimentIndex]),
    fieldLabels: asArray(templateVersion.inputSlots).map((slot) => slot.label),
    includeSeries: false,
    purpose: `Apply reusable chart template ${templateVersion.reusableChartTemplateId}.`,
    baseHeadRef: copy(item.head),
  })) : [];

  return {
    schemaVersion: "labrat.reusableChartTemplateCompatibility.v1",
    status,
    templateVersionId: templateVersion.id,
    experimentCount: selected.length,
    experiments: selected.map((item) => ({
      experimentId: item.experimentId,
      label: item.label,
      activeHead: copy(item.head),
    })),
    resolvedBindings: resolvedBindings.map(({ columnIndexes: _indexes, ...binding }) => binding),
    executionBindings: copy(resolvedBindings),
    blockers,
    experimentSelections,
    frozenHeadRefs: selected.map((item) => copy(item.head)),
  };
}

export function buildReusableChartTemplateApplicationArtifacts({
  project,
  actorUserId,
  templateVersion,
  compatibility,
  idempotencyKey,
  requestHash,
  createdAt = new Date().toISOString(),
} = {}) {
  const applicationId = makeId("chart_template_application");
  const ready = compatibility.status === "ready";
  const templateName = text(templateVersion.templateName) || "Reusable chart";
  const threadId = ready ? makeId("analysis_thread") : null;
  const revisionId = ready ? makeId("analysis_plan_revision") : null;
  const runId = ready ? makeId("analysis_run") : null;
  const templateLineage = {
    reusableChartTemplateId: templateVersion.reusableChartTemplateId,
    reusableChartTemplateVersionId: templateVersion.id,
    chartStyleProfileVersionId: templateVersion.chartStyleProfileVersionId || null,
    reusableChartTemplateApplicationId: applicationId,
    executionStrategy: CHART_TEMPLATE_EXECUTION_STRATEGY,
  };
  const { executionBindings = [], ...publicCompatibility } = compatibility;
  const linked = compatibility.sourceKind === "linked_region";
  const linkedSlot = linked ? asArray(templateVersion.inputSlots)[0] : null;
  const excludedCount = asArray(compatibility.excludedExperiments).length;
  const plan = ready ? {
    outputTarget: "chart",
    inputMode: linked ? "workbook" : "experiment_browser",
    sourceSelections: linked ? copy(compatibility.sourceSelections) : [],
    experimentSelections: linked ? [] : copy(compatibility.experimentSelections),
    reviewPlan: {
      summary: `Apply ${templateName} to ${compatibility.experimentCount} selected experiment${compatibility.experimentCount === 1 ? "" : "s"}.`,
      calculationSteps: linked ? [
        `Read each experiment's confirmed ${compatibility.linkedDataKind} region exactly as stored in its workbook.`,
        "Align the series on their category labels and keep missing points as gaps.",
        "Apply the accepted deterministic chart recipe without AI or Python.",
        "Validate the resulting Plotly chart before user review.",
      ] : [
        "Read the exact accepted scalar inputs declared by the reusable template.",
        "Apply the accepted deterministic chart recipe without AI or Python.",
        "Validate the resulting Plotly chart before user review.",
      ],
      chart: {
        chartType: templateVersion.encoding?.chartType || "bar",
        title: templateName,
        xDescription: linked ? (text(linkedSlot?.seriesContract?.xMeaning).replace(/_/g, " ") || "Category") : "Experiment",
        yDescription: asArray(templateVersion.inputSlots)[0]?.unitContract?.allowedUnits?.[0] || "Value",
        seriesDescription: linked ? "One series per experiment" : asArray(templateVersion.inputSlots).map((slot) => slot.label).join(", "),
      },
      invariants: [],
    },
    displayPlan: linked ? [
      `Read ${compatibility.experimentCount} confirmed ${compatibility.linkedDataKind} region${compatibility.experimentCount === 1 ? "" : "s"} directly from the linked workbooks.`,
      ...asArray(compatibility.experiments).map((item) => `${item.label}: ${item.region.workbookName} · ${item.region.sheetName}!${item.region.range}${item.missingCount ? ` (${item.missingCount} missing point${item.missingCount === 1 ? "" : "s"})` : ""}`),
      ...(excludedCount ? [`Not included: ${asArray(compatibility.excludedExperiments).map((item) => item.label).join(", ")}`] : []),
    ] : [
      `Use ${compatibility.experimentCount} frozen accepted experiment snapshot${compatibility.experimentCount === 1 ? "" : "s"}.`,
      `Render ${asArray(templateVersion.inputSlots).length} reusable scalar input${asArray(templateVersion.inputSlots).length === 1 ? "" : "s"}.`,
    ],
    templateLineage: linked ? { ...templateLineage, linkedDataKind: compatibility.linkedDataKind, frozenRegionRefs: copy(compatibility.frozenRegionRefs) } : templateLineage,
    templateRecipe: copy(templateVersion.recipe),
    templateEncoding: copy(templateVersion.encoding),
    templateStyleProfileVersionId: templateVersion.chartStyleProfileVersionId || null,
    resolvedTemplateBindings: copy(compatibility.resolvedBindings),
  } : null;
  return {
    application: {
      id: applicationId,
      labId: project.labId,
      projectId: project.id,
      schemaVersion: REUSABLE_CHART_TEMPLATE_APPLICATION_SCHEMA_VERSION,
      reusableChartTemplateVersionId: templateVersion.id,
      status: ready ? "queued" : "blocked",
      idempotencyKey,
      requestHash,
      experimentIds: compatibility.experiments.map((item) => item.experimentId),
      frozenHeadRefs: copy(compatibility.frozenHeadRefs),
      frozenRegionRefs: copy(compatibility.frozenRegionRefs || []),
      bindings: copy(executionBindings),
      compatibility: copy(publicCompatibility),
      analysisThreadId: threadId,
      analysisPlanRevisionId: revisionId,
      analysisRunId: runId,
      createdAt,
      updatedAt: createdAt,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    },
    slotBindings: ready ? compatibility.resolvedBindings.filter((binding) => binding.explicit).map((binding) => ({
      id: makeId("chart_template_slot_binding"),
      labId: project.labId,
      projectId: project.id,
      schemaVersion: REUSABLE_CHART_TEMPLATE_SLOT_BINDING_SCHEMA_VERSION,
      reusableChartTemplateVersionId: templateVersion.id,
      slotId: binding.slotId,
      columnId: binding.columnId,
      valueType: binding.valueType,
      unit: binding.unit,
      sourceSignature: binding.sourceSignature,
      status: "active",
      createdAt,
      createdBy: actorUserId,
    })) : [],
    analysisThread: ready ? {
      id: threadId,
      labId: project.labId,
      projectId: project.id,
      schemaVersion: "labrat.analysisThread.v1",
      status: "executing",
      outputTarget: "chart",
      inputMode: linked ? "workbook" : "experiment_browser",
      originalRequest: `Apply reusable chart template: ${templateName}`,
      messages: [{
        id: makeId("analysis_message"),
        role: "user",
        content: `Apply ${templateName} to the selected experiments.`,
        createdAt,
      }],
      planRevisionIds: [revisionId],
      analysisRunIds: [runId],
      acceptedAnalysisResultIds: [],
      chartSpecIds: [],
      dataSnapshotIds: [],
      browserViewIds: [],
      createdAt,
      updatedAt: createdAt,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    } : null,
    analysisPlanRevision: ready ? {
      id: revisionId,
      labId: project.labId,
      projectId: project.id,
      analysisThreadId: threadId,
      schemaVersion: "labrat.analysisPlanRevision.v4",
      revision: 1,
      status: "accepted",
      outputTarget: "chart",
      requestSummary: plan.reviewPlan.summary,
      plan,
      sourceRectangles: linked ? asArray(compatibility.sourceSelections).map((selection) => ({
        sourceType: "excel_range",
        sourceSelectionId: selection.sourceSelectionId,
        regionUnderstandingRevisionId: selection.regionUnderstandingRevisionId,
        sourceDocumentId: selection.sourceDocumentId,
        workbookName: selection.workbookName,
        sheetName: selection.sheetName,
        sheet: selection.sheetName,
        range: selection.range,
        label: selection.label,
      })) : [],
      feedback: null,
      warnings: [],
      validation: { ok: true, errors: [], warnings: [] },
      acceptedAt: createdAt,
      acceptedBy: actorUserId,
      createdAt,
      updatedAt: createdAt,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    } : null,
    analysisRun: ready ? {
      id: runId,
      labId: project.labId,
      projectId: project.id,
      analysisThreadId: threadId,
      acceptedPlanRevisionId: revisionId,
      schemaVersion: "labrat.analysisRun.v3",
      status: "queued",
      outputTarget: "chart",
      idempotencyKey: `template_run:${applicationId}`,
      requestHash,
      inputHash: "pending",
      programHash: stableDataHash(templateVersion.recipe),
      runtimeVersion: ANALYSIS_RUNTIME_VERSION,
      resultPreviewHash: null,
      payload: {
        executionStrategy: CHART_TEMPLATE_EXECUTION_STRATEGY,
        reusableChartTemplateApplicationId: applicationId,
        reusableChartTemplateVersionId: templateVersion.id,
        templateLineage,
      },
      warnings: [],
      validation: {},
      createdAt,
      updatedAt: createdAt,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    } : null,
  };
}

/**
 * Reads the series each ready experiment was frozen to when the application
 * was prepared. The frozen revision is used even when the region has since
 * been re-confirmed; a missing revision or workbook fails closed as stale.
 */
export async function materializeLinkedSeriesInputs({ store, projectId, application, templateVersion = null } = {}) {
  const refs = asArray(application?.frozenRegionRefs);
  const slotSelector = linkedSlotsOf(templateVersion)[0]?.seriesContract?.seriesSelector || null;
  const linkedSeries = [];
  for (const ref of refs) {
    const revision = await store.findRegionUnderstandingRevisionById(ref.regionUnderstandingRevisionId);
    if (!revision || revision.projectId !== projectId || revision.regionId !== ref.regionId) {
      applicationError("chart_template_inputs_stale", `The confirmed ${ref.sheetName}!${ref.range} region used for ${ref.label} is no longer available.`, 409, { experimentId: ref.experimentId, regionId: ref.regionId });
    }
    const interpretation = revision.interpretation || {};
    const frozenSelector = ref.seriesKey || ref.seriesLabel ? { seriesKey: ref.seriesKey || null, label: ref.seriesLabel || null } : null;
    const chosen = selectRegionSeries(asArray(interpretation.series), frozenSelector || slotSelector);
    if (!chosen) {
      applicationError("chart_template_inputs_stale", `The frozen region for ${ref.label} no longer defines the series this template plots.`, 409, { experimentId: ref.experimentId });
    }
    const series = [chosen];
    let read;
    try {
      read = await readLinkedRegionSeries({
        store,
        projectId,
        region: { sourceDocumentId: ref.sourceDocumentId, sheetName: ref.sheetName, range: ref.range },
        series: series[0],
        headerRow: interpretation.headerRow ?? null,
        inclusion: interpretation.inclusion ?? null,
      });
    } catch (error) {
      if (error?.code === "chart_template_source_document_missing") {
        applicationError("chart_template_inputs_stale", `The workbook behind ${ref.label} was removed after this application was prepared.`, 409, { experimentId: ref.experimentId });
      }
      throw error;
    }
    linkedSeries.push({
      ...read,
      seriesLabel: read.label,
      experimentId: ref.experimentId,
      label: ref.label,
      regionId: ref.regionId,
      regionUnderstandingRevisionId: ref.regionUnderstandingRevisionId,
      sourceDocumentId: ref.sourceDocumentId,
      workbookName: ref.workbookName,
      sheetName: ref.sheetName,
      range: ref.range,
    });
  }
  return { linkedSeries };
}

const SERIES_RECIPE_OPERATIONS = new Set(["select_series", "align_x", "filter_missing"]);

function categoryKey(value) {
  return value == null ? null : String(value);
}

function displayedSeriesValue(value, series) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const unit = text(series?.yUnit).toLowerCase();
  return text(series?.yNumericScale) === "fraction" && new Set(["percent", "%", "percentage"]).has(unit) ? value * 100 : value;
}

function executeLinkedSeriesTemplate({ templateVersion, application, linkedSeries, styleVersion }) {
  const slots = asArray(templateVersion.inputSlots);
  const slot = slots[0];
  const operations = asArray(templateVersion.recipe?.operations);
  if (slots.length !== 1 || !operations.length || operations.some((operation) => !SERIES_RECIPE_OPERATIONS.has(text(operation?.op)))) {
    applicationError("chart_template_recipe_unsupported", "Workbook series templates accept only select_series, align_x, and filter_missing operations.", 422);
  }
  const select = operations.find((operation) => text(operation.op) === "select_series");
  if (!select || text(select.inputSlotId) !== slot.slotId) {
    applicationError("chart_template_recipe_unsupported", "The series recipe must select the template's linked-region slot.", 422);
  }
  const alignPolicy = text(operations.find((operation) => text(operation.op) === "align_x")?.policy) || text(slot.seriesContract?.alignmentPolicy) || "union_with_gaps";
  const missingPolicy = text(operations.find((operation) => text(operation.op) === "filter_missing")?.policy) || text(templateVersion.missingDataPolicy?.missingPoint) || "preserve_gap";
  if (!new Set(["union_with_gaps", "intersection", "exact"]).has(alignPolicy)) {
    applicationError("chart_template_recipe_unsupported", `Alignment policy ${alignPolicy} is not supported.`, 422);
  }
  if (!new Set(["preserve_gap", "omit_point"]).has(missingPolicy)) {
    applicationError("chart_template_recipe_unsupported", `Missing-point policy ${missingPolicy} is not supported.`, 422);
  }
  const chartType = text(templateVersion.encoding?.chartType) || "bar";
  if (!new Set(["bar", "scatter", "line"]).has(chartType)) {
    applicationError("chart_template_recipe_unsupported", `Chart type ${chartType} is not supported by the deterministic series renderer.`, 422);
  }
  const comparisonMode = text(templateVersion.encoding?.comparisonMode) || (chartType === "bar" ? "grouped" : "overlay");
  if (!new Set(["grouped", "overlay"]).has(comparisonMode) || (comparisonMode === "grouped" && chartType !== "bar")) {
    applicationError("chart_template_recipe_unsupported", `Workbook series templates render grouped bars or overlaid traces, not ${comparisonMode}.`, 422);
  }
  const seriesList = asArray(linkedSeries);
  const expectedIds = asArray(application.experimentIds);
  if (!seriesList.length || seriesList.length !== expectedIds.length || seriesList.some((item, index) => item.experimentId !== expectedIds[index])) {
    applicationError("chart_template_inputs_stale", "The materialized workbook series do not match the prepared application.", 409);
  }

  // align_x: category order is first-seen source order across experiments.
  const categories = [];
  const seen = new Map();
  seriesList.forEach((item) => asArray(item.points).forEach((point) => {
    const key = categoryKey(point.x);
    if (key == null) return;
    if (!seen.has(key)) {
      seen.set(key, categories.length);
      categories.push({ key, value: point.x, presentIn: 0 });
    }
  }));
  seriesList.forEach((item) => {
    const keys = new Set(asArray(item.points).map((point) => categoryKey(point.x)).filter((key) => key != null));
    categories.forEach((category) => { if (keys.has(category.key)) category.presentIn += 1; });
  });
  if (alignPolicy === "exact" && categories.some((category) => category.presentIn !== seriesList.length)) {
    applicationError("chart_template_alignment_incompatible", "The template requires identical category labels in every experiment.", 422, {
      categories: categories.filter((category) => category.presentIn !== seriesList.length).map((category) => category.key),
    });
  }
  const aligned = alignPolicy === "intersection" ? categories.filter((category) => category.presentIn === seriesList.length) : categories;
  if (!aligned.length) {
    applicationError("chart_template_alignment_incompatible", "The selected experiments share no category labels.", 422);
  }

  const labels = seriesList.map((item) => item.label);
  const experimentStyles = allocateSelectionOrderStyles({ styleVersion, itemCount: seriesList.length });
  const traceDescriptors = seriesList.map((item, index) => ({ traceId: `template_${item.experimentId}`, experimentIndex: index }));
  const styleAssignments = traceDescriptors.map((descriptor) => ({ traceId: descriptor.traceId, ...experimentStyles[descriptor.experimentIndex] }));
  const geometry = resolveReusableChartGeometry({
    styleVersion,
    templateVersion,
    comparisonMode,
    chartType,
    title: text(templateVersion.templateName) || "Reusable chart",
    experimentLabels: aligned.map((category) => category.key),
    legendLabels: labels,
    showLegend: labels.length > 1,
    styleAssignments,
  });

  const exclusions = [];
  const traces = seriesList.map((item, index) => {
    const style = styleAssignments[index];
    const byKey = new Map();
    asArray(item.points).forEach((point) => {
      const key = categoryKey(point.x);
      if (key != null && !byKey.has(key)) byKey.set(key, point);
    });
    const cells = [];
    const x = [];
    const y = [];
    aligned.forEach((category) => {
      const point = byKey.get(category.key);
      const value = point && !point.missing ? displayedSeriesValue(point.y, item) : null;
      if (value == null) {
        exclusions.push({
          code: "chart_template_missing_point",
          experimentId: item.experimentId,
          label: item.label,
          category: category.key,
          reason: point ? point.missingReason || "missing" : "category_absent",
          cell: point?.yCell || null,
        });
        if (missingPolicy === "omit_point") return;
      }
      x.push(category.value);
      y.push(value);
      if (value != null) cells.push(point.yCell);
    });
    return {
      traceId: `template_${item.experimentId}`,
      type: chartType === "bar" ? "bar" : "scatter",
      ...(chartType === "bar" ? {} : {
        mode: chartType === "line" ? "lines+markers" : "markers",
        line: { color: style.color, dash: style.lineDash },
        connectgaps: false,
      }),
      name: item.label,
      x,
      y,
      marker: {
        color: style.color,
        ...(chartType === "bar" ? { pattern: { shape: style.barPattern } } : { symbol: style.markerSymbol }),
      },
      meta: {
        labrat: {
          traceId: `template_${item.experimentId}`,
          slotId: slot.slotId,
          experimentId: item.experimentId,
          linkedDataKind: text(slot.linkedDataKind),
          sourceLineage: [{
            experimentId: item.experimentId,
            regionId: item.regionId,
            regionUnderstandingRevisionId: item.regionUnderstandingRevisionId,
            sourceRefs: copy(item.sourceRefs || []),
            cells,
          }],
        },
      },
      hovertemplate: `%{x}<br>${item.label}: %{y}<extra></extra>`,
    };
  });

  const unit = text(slot.unitContract?.allowedUnits?.[0]) || text(seriesList[0]?.yUnit);
  const xTitle = text(slot.seriesContract?.xMeaning).replace(/_/g, " ") || "Category";
  const layout = {
    ...geometry.layout,
    xaxis: {
      ...(geometry.layout.xaxis || {}),
      title: { text: xTitle, font: { size: geometry.resolvedStyle.typography.axisTitleSizePt } },
      tickangle: geometry.tickAngle,
      tickfont: { size: geometry.resolvedStyle.typography.tickSizePt },
      ...(text(slot.seriesContract?.xValueType) === "number" && aligned.every((category) => typeof category.value === "number") ? {} : { type: "category", categoryorder: "array", categoryarray: aligned.map((category) => category.value) }),
    },
    yaxis: {
      ...(geometry.layout.yaxis || {}),
      title: { text: unit || slot.label || "Value", font: { size: geometry.resolvedStyle.typography.axisTitleSizePt } },
      tickfont: { size: geometry.resolvedStyle.typography.tickSizePt },
    },
    showlegend: labels.length > 1,
    ...(chartType === "bar" ? { barmode: comparisonMode === "overlay" ? "overlay" : "group" } : {}),
  };
  const sourceRefs = seriesList.flatMap((item) => [
    ...asArray(item.sourceRefs).map((ref) => ({ ...copy(ref), experimentId: item.experimentId, slotId: slot.slotId, regionUnderstandingRevisionId: item.regionUnderstandingRevisionId })),
    ...asArray(item.points).filter((point) => !point.missing).map((point) => ({
      sourceType: "excel_cell",
      sourceDocumentId: item.sourceDocumentId,
      sheet: item.sheetName,
      cell: point.yCell,
      experimentId: item.experimentId,
      slotId: slot.slotId,
      regionUnderstandingRevisionId: item.regionUnderstandingRevisionId,
      category: categoryKey(point.x),
    })),
  ]);
  const pointDigest = seriesList.map((item) => ({
    experimentId: item.experimentId,
    regionUnderstandingRevisionId: item.regionUnderstandingRevisionId,
    points: asArray(item.points).map((point) => [categoryKey(point.x), point.missing ? null : point.y]),
  }));
  return {
    executorResult: {
      ok: true,
      adapter: CHART_TEMPLATE_EXECUTION_STRATEGY,
      runtime: { version: ANALYSIS_RUNTIME_VERSION, deterministic: true },
      result: {
        plotly: { data: traces, layout },
        resolvedGeometry: geometry.resolvedGeometry,
        exclusions,
        checks: [{
          code: "chart_template_series_alignment",
          alignmentPolicy: alignPolicy,
          missingPointPolicy: missingPolicy,
          categoryCount: aligned.length,
          experimentCount: seriesList.length,
        }],
      },
    },
    sourceRefs,
    hashes: {
      inputHash: stableDataHash({ applicationId: application.id, linkedSeries: pointDigest }),
      programHash: stableDataHash(templateVersion.recipe),
      packageHash: stableDataHash({ applicationId: application.id, templateVersionId: templateVersion.id, linkedSeries: pointDigest }),
    },
  };
}

export function executeReusableChartTemplate({ templateVersion, application, experiments, linkedSeries = null, styleVersion = null } = {}) {
  if (!templateVersion || !application || application.status !== "queued") {
    applicationError("chart_template_application_conflict", "The reusable chart application is not queued for execution.", 409);
  }
  const slots = asArray(templateVersion.inputSlots);
  const operations = asArray(templateVersion.recipe?.operations);
  if (isLinkedSeriesTemplate(templateVersion)) {
    return executeLinkedSeriesTemplate({ templateVersion, application, linkedSeries, styleVersion });
  }
  if (!operations.length || operations.some((operation) => text(operation?.op) !== "select_scalar")) {
    applicationError(
      "chart_template_recipe_unsupported",
      "This deterministic executor currently accepts only reviewed scalar-selection recipes.",
      422,
    );
  }
  const selectedSlotIds = operations.map((operation) => text(operation?.inputSlotId));
  if (new Set(selectedSlotIds).size !== selectedSlotIds.length || selectedSlotIds.some((slotId) => !slots.some((slot) => slot.slotId === slotId))) {
    applicationError("chart_template_recipe_unsupported", "The accepted scalar recipe contains invalid slot references.", 422);
  }
  const bindings = new Map(asArray(application.bindings).map((binding) => [binding.slotId, binding]));
  const valuesBySlot = selectedSlotIds.map((slotId) => slots.find((slot) => slot.slotId === slotId)).map((slot) => {
    const binding = bindings.get(slot.slotId);
    if (!binding) applicationError("chart_template_input_missing", `Binding ${slot.slotId} is missing.`, 422);
    return {
      slot,
      binding,
      points: asArray(experiments).map((experiment, experimentIndex) => {
        const columnIndex = Number(binding.columnIndexes?.[experimentIndex]);
        const field = asArray(experiment.fields).find((item) => Number(item.columnIndex) === columnIndex);
        if (!field || field.value == null || typeof field.value !== "number" || !Number.isFinite(field.value)) {
          applicationError("chart_template_input_missing", `${slot.label} is missing from ${experiment.label}.`, 422, {
            slotId: slot.slotId,
            experimentId: experiment.experimentId,
          });
        }
        if (!contractMatch(field, slot)) {
          applicationError("chart_template_unit_incompatible", `${slot.label} is incompatible for ${experiment.label}.`, 422);
        }
        return { experiment, field };
      }),
    };
  });
  const labels = asArray(experiments).map((experiment) => experiment.label);
  const chartType = text(templateVersion.encoding?.chartType) || "bar";
  if (!new Set(["bar", "scatter", "line"]).has(chartType)) {
    applicationError("chart_template_recipe_unsupported", `Chart type ${chartType} is not supported by the deterministic scalar renderer.`, 422);
  }
  const comparisonMode = text(templateVersion.encoding?.comparisonMode) || (chartType === "bar" ? "grouped" : "overlay");
  if (comparisonMode === "stacked_components" && chartType !== "bar") {
    applicationError("chart_template_recipe_unsupported", "Stacked-component templates require bar traces.", 422);
  }
  if (comparisonMode === "grouped" && chartType !== "bar") {
    applicationError("chart_template_recipe_unsupported", "Grouped templates require bar traces.", 422);
  }
  const slotStyles = allocateSelectionOrderStyles({ styleVersion, itemCount: valuesBySlot.length });
  const experimentStyles = comparisonMode === "overlay"
    ? allocateSelectionOrderStyles({ styleVersion, itemCount: labels.length })
    : null;
  const pointStyles = comparisonMode !== "faceted" && valuesBySlot.length === 1 && labels.length > 1
    ? allocateSelectionOrderStyles({ styleVersion, itemCount: labels.length })
    : null;
  const traceDescriptors = comparisonMode === "faceted"
    ? asArray(experiments).flatMap((experiment, experimentIndex) => valuesBySlot.map(({ slot }, slotIndex) => ({
      traceId: `template_${slot.slotId}_${experiment.experimentId}`,
      experimentIndex,
      slotIndex,
    })))
    : comparisonMode === "overlay"
      ? asArray(experiments).map((experiment, experimentIndex) => ({
        traceId: `template_${experiment.experimentId}`,
        experimentIndex,
      }))
    : valuesBySlot.map(({ slot }, slotIndex) => ({ traceId: `template_${slot.slotId}`, slotIndex }));
  const styleAssignments = traceDescriptors.map((descriptor) => ({
    traceId: descriptor.traceId,
    ...(comparisonMode === "overlay" ? experimentStyles[descriptor.experimentIndex] : slotStyles[descriptor.slotIndex]),
  }));
  const geometry = resolveReusableChartGeometry({
    styleVersion,
    templateVersion,
    comparisonMode,
    chartType,
    title: text(templateVersion.templateName) || "Reusable chart",
    experimentLabels: labels,
    legendLabels: comparisonMode === "overlay"
      ? asArray(experiments).map((experiment) => experiment.label)
      : valuesBySlot.map(({ slot }) => slot.label),
    showLegend: comparisonMode === "overlay" ? labels.length > 1 : valuesBySlot.length > 1,
    styleAssignments,
  });
  const trace = ({ slot, binding, points, traceId, style, experimentIndex = null, facetRef = null }) => {
    const selectedPoints = experimentIndex == null ? points : [points[experimentIndex]];
    const x = selectedPoints.map((point) => point.experiment.label);
    const marker = pointStyles && experimentIndex == null
      ? {
        color: pointStyles.map((item) => item.color),
        ...(chartType === "bar"
          ? { pattern: { shape: pointStyles.map((item) => item.barPattern) } }
          : { symbol: pointStyles.map((item) => item.markerSymbol) }),
      }
      : {
        color: style.color,
        ...(chartType === "bar"
          ? { pattern: { shape: style.barPattern } }
          : { symbol: style.markerSymbol }),
      };
    return {
      traceId,
      type: chartType === "bar" ? "bar" : "scatter",
      ...(chartType === "bar" ? {} : {
        mode: "lines+markers",
        line: { color: style.color, dash: style.lineDash },
      }),
      name: slot.label,
      x,
      y: selectedPoints.map((point) => displayedNumericValue(point.field)),
      marker,
      ...(facetRef || {}),
      ...(experimentIndex != null && experimentIndex > 0 ? { showlegend: false } : {}),
      meta: {
        labrat: {
          traceId,
          slotId: slot.slotId,
          columnId: binding.columnId,
          sourceLineage: selectedPoints.map((point) => ({
            experimentId: point.experiment.experimentId,
            activeHead: copy(point.experiment.activeHead),
            sourceRefs: copy(point.field.sourceRefs || []),
          })),
        },
      },
      hovertemplate: `%{x}<br>${slot.label}: %{y}<extra></extra>`,
    };
  };
  const traces = comparisonMode === "faceted"
    ? traceDescriptors.map((descriptor, index) => {
      const value = valuesBySlot[descriptor.slotIndex];
      return trace({
        ...value,
        traceId: descriptor.traceId,
        style: styleAssignments[index],
        experimentIndex: descriptor.experimentIndex,
        facetRef: geometry.facetRefs[descriptor.experimentIndex],
      });
    })
    : comparisonMode === "overlay"
      ? traceDescriptors.map((descriptor, index) => {
        const experiment = experiments[descriptor.experimentIndex];
        const traceStyle = styleAssignments[index];
        return {
          traceId: descriptor.traceId,
          type: chartType === "bar" ? "bar" : "scatter",
          ...(chartType === "bar" ? {} : {
            mode: "lines+markers",
            line: { color: traceStyle.color, dash: traceStyle.lineDash },
          }),
          name: experiment.label,
          x: valuesBySlot.map(({ slot }) => slot.label),
          y: valuesBySlot.map(({ points }) => displayedNumericValue(points[descriptor.experimentIndex].field)),
          marker: {
            color: traceStyle.color,
            ...(chartType === "bar"
              ? { pattern: { shape: traceStyle.barPattern } }
              : { symbol: traceStyle.markerSymbol }),
          },
          meta: {
            labrat: {
              traceId: descriptor.traceId,
              experimentId: experiment.experimentId,
              sourceLineage: valuesBySlot.map(({ slot, binding, points }) => ({
                slotId: slot.slotId,
                columnId: binding.columnId,
                experimentId: experiment.experimentId,
                activeHead: copy(experiment.activeHead),
                sourceRefs: copy(points[descriptor.experimentIndex].field.sourceRefs || []),
              })),
            },
          },
          hovertemplate: `%{x}<br>${experiment.label}: %{y}<extra></extra>`,
        };
      })
    : valuesBySlot.map((value, index) => trace({
      ...value,
      traceId: `template_${value.slot.slotId}`,
      style: slotStyles[index],
    }));
  const unit = text(slots[0]?.unitContract?.allowedUnits?.[0]);
  const layout = {
    ...geometry.layout,
    xaxis: {
      ...(geometry.layout.xaxis || {}),
      title: { text: "Experiment", font: { size: geometry.resolvedStyle.typography.axisTitleSizePt } },
      tickangle: geometry.tickAngle,
      tickfont: { size: geometry.resolvedStyle.typography.tickSizePt },
    },
    yaxis: {
      ...(geometry.layout.yaxis || {}),
      title: {
        text: unit || slots[0]?.label || "Value",
        font: { size: geometry.resolvedStyle.typography.axisTitleSizePt },
      },
      tickfont: { size: geometry.resolvedStyle.typography.tickSizePt },
    },
    showlegend: comparisonMode === "overlay" ? labels.length > 1 : valuesBySlot.length > 1,
    ...(chartType === "bar" ? {
      barmode: comparisonMode === "stacked_components"
        ? "stack"
        : comparisonMode === "overlay" ? "overlay" : "group",
    } : {}),
  };
  const sourceRefs = valuesBySlot.flatMap(({ slot, points }) => points.map((point) => ({
    experimentId: point.experiment.experimentId,
    slotId: slot.slotId,
    activeHead: copy(point.experiment.activeHead),
    sourceRefs: copy(point.field.sourceRefs || []),
  })));
  return {
    executorResult: {
      ok: true,
      adapter: CHART_TEMPLATE_EXECUTION_STRATEGY,
      runtime: { version: ANALYSIS_RUNTIME_VERSION, deterministic: true },
      result: {
        plotly: { data: traces, layout },
        resolvedGeometry: geometry.resolvedGeometry,
        exclusions: [],
        checks: [],
      },
    },
    sourceRefs,
    hashes: {
      inputHash: stableDataHash({ applicationId: application.id, experiments, bindings: application.bindings }),
      programHash: stableDataHash(templateVersion.recipe),
      packageHash: stableDataHash({ applicationId: application.id, templateVersionId: templateVersion.id, experiments }),
    },
  };
}
