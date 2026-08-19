import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { stableDataHash } from "./dataPlanSchemas.js";
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

export async function prepareReusableChartTemplateApplication({
  store,
  projectId,
  templateVersion,
  experimentIds,
  explicitBindings = [],
} = {}) {
  const selectedExperimentIds = asArray(experimentIds).map(text).filter(Boolean);
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
  const plan = ready ? {
    outputTarget: "chart",
    sourceSelections: [],
    experimentSelections: copy(compatibility.experimentSelections),
    reviewPlan: {
      summary: `Apply ${templateName} to ${compatibility.experimentCount} selected experiment${compatibility.experimentCount === 1 ? "" : "s"}.`,
      calculationSteps: [
        "Read the exact accepted scalar inputs declared by the reusable template.",
        "Apply the accepted deterministic chart recipe without AI or Python.",
        "Validate the resulting Plotly chart before user review.",
      ],
      chart: {
        chartType: templateVersion.encoding?.chartType || "bar",
        title: templateName,
        xDescription: "Experiment",
        yDescription: asArray(templateVersion.inputSlots)[0]?.unitContract?.allowedUnits?.[0] || "Value",
        seriesDescription: asArray(templateVersion.inputSlots).map((slot) => slot.label).join(", "),
      },
      invariants: [],
    },
    displayPlan: [
      `Use ${compatibility.experimentCount} frozen accepted experiment snapshot${compatibility.experimentCount === 1 ? "" : "s"}.`,
      `Render ${asArray(templateVersion.inputSlots).length} reusable scalar input${asArray(templateVersion.inputSlots).length === 1 ? "" : "s"}.`,
    ],
    templateLineage,
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
      sourceRectangles: [],
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
      inputHash: null,
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

export function executeReusableChartTemplate({ templateVersion, application, experiments, styleVersion = null } = {}) {
  if (!templateVersion || !application || application.status !== "queued") {
    applicationError("chart_template_application_conflict", "The reusable chart application is not queued for execution.", 409);
  }
  const slots = asArray(templateVersion.inputSlots);
  const operations = asArray(templateVersion.recipe?.operations);
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
