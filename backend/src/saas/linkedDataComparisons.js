import { linkedRegionSummaries } from "./experimentProjection.js";

export const LINKED_DATA_KINDS_SCHEMA_VERSION = "labrat.linkedDataKinds.v1";
export const LINKED_DATA_COMPARISON_SCHEMA_VERSION = "labrat.linkedDataComparison.v1";
export const LINKED_COMPARISON_CHART_TYPES = Object.freeze(["grouped_bar", "bar", "scatter", "point", "stacked_bar"]);
const MAX_COMPARISON_EXPERIMENTS = 64;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeKind(value) {
  return text(value).toLowerCase();
}

function fail(code, message, statusCode = 400, details = {}) {
  throw Object.assign(new Error(message), { code, statusCode, details });
}

function seriesSummary(series) {
  return {
    seriesKey: text(series?.seriesKey) || null,
    label: text(series?.label || series?.seriesKey) || null,
    orientation: text(series?.orientation) || "column_pair",
    xHeaderRange: text(series?.xHeaderRange) || null,
    yValueRange: text(series?.yValueRange) || null,
    xColumn: text(series?.xColumn) || null,
    yColumn: text(series?.yColumn) || null,
    xSemanticKey: text(series?.xSemanticKey) || null,
    xUnit: series?.xUnit || null,
    yUnit: series?.yUnit || null,
    yNumericScale: series?.yNumericScale || null,
    pointCount: Number.isFinite(Number(series?.pointCount)) ? Number(series.pointCount) : null,
  };
}

async function linkedContext({ store, projectId }) {
  const [accepted, sourceDocuments, identities] = await Promise.all([
    store.listAcceptedRegionUnderstandings({ projectId }),
    store.listSourceDocuments ? store.listSourceDocuments({ projectId }) : [],
    store.listExperimentIdentities ? store.listExperimentIdentities({ projectId }) : [],
  ]);
  const revisionById = new Map(asArray(accepted).map(({ revision }) => [revision.id, revision]));
  const linked = linkedRegionSummaries({ acceptedRegionUnderstandings: accepted, sourceDocuments }).map((item) => {
    const revision = revisionById.get(item.revisionId);
    return {
      ...item,
      series: asArray(revision?.interpretation?.series).map(seriesSummary),
    };
  });
  const identityById = new Map(asArray(identities).map((identity) => [identity.id, identity]));
  return { linked, identities: asArray(identities), identityById };
}

function identityLabel(identity, fallback) {
  return text(identity?.canonicalLabel || identity?.label) || fallback;
}

export async function linkedDataKinds({ store, projectId } = {}) {
  const { linked, identities, identityById } = await linkedContext({ store, projectId });
  const byKind = new Map();
  for (const item of linked) {
    const key = normalizeKind(item.dataKind);
    if (!byKind.has(key)) byKind.set(key, { dataKind: item.dataKind, experiments: new Map() });
    const entry = byKind.get(key);
    if (!entry.experiments.has(item.linkedExperimentId)) {
      entry.experiments.set(item.linkedExperimentId, {
        experimentId: item.linkedExperimentId,
        label: identityLabel(identityById.get(item.linkedExperimentId), item.linkedExperimentId),
        regions: [],
      });
    }
    entry.experiments.get(item.linkedExperimentId).regions.push({
      regionId: item.regionId,
      revisionId: item.revisionId,
      workbookReviewSessionId: item.workbookReviewSessionId,
      sourceDocumentId: item.sourceDocumentId,
      workbookName: item.workbookName,
      sheetName: item.sheetName,
      range: item.range,
      templateVersion: item.templateVersion,
      acceptedAt: item.acceptedAt,
      series: item.series,
    });
  }
  return {
    schemaVersion: LINKED_DATA_KINDS_SCHEMA_VERSION,
    projectId,
    dataKinds: [...byKind.values()]
      .map((entry) => {
        const experiments = [...entry.experiments.values()]
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
        return {
          dataKind: entry.dataKind,
          experimentCount: experiments.length,
          regionCount: experiments.reduce((total, experiment) => total + experiment.regions.length, 0),
          experiments,
        };
      })
      .sort((a, b) => a.dataKind.localeCompare(b.dataKind)),
    experiments: identities
      .map((identity) => ({ experimentId: identity.id, label: identityLabel(identity, identity.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  };
}

function pickRegion(regions) {
  // Most recently confirmed wins; ties (same batch, same millisecond) fall back
  // to the most recently created region, then to a stable id order.
  return [...regions].sort((a, b) => (
    String(b.acceptedAt || "").localeCompare(String(a.acceptedAt || ""))
    || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    || b.regionId.localeCompare(a.regionId)
  ))[0];
}

function chartTypeFor(requested, primarySeries) {
  const wanted = text(requested);
  if (LINKED_COMPARISON_CHART_TYPES.includes(wanted)) return wanted;
  return primarySeries?.orientation === "column_pair" ? "scatter" : "grouped_bar";
}

function humanKey(value, fallback) {
  const cleaned = text(value).replace(/_/g, " ");
  return cleaned || fallback;
}

export async function buildLinkedDataComparison({ store, projectId, dataKind, experimentIds = [], chartType = null } = {}) {
  const wantedKind = normalizeKind(dataKind);
  if (!wantedKind) fail("linked_data_kind_required", "Choose a data kind to compare.");
  const requestedIds = [...new Set(asArray(experimentIds).map(text).filter(Boolean))];
  if (!requestedIds.length) fail("linked_data_experiments_required", "Choose at least one experiment to compare.");
  if (requestedIds.length > MAX_COMPARISON_EXPERIMENTS) fail("linked_data_experiment_limit", `Compare at most ${MAX_COMPARISON_EXPERIMENTS} experiments at once.`);
  const { linked, identityById } = await linkedContext({ store, projectId });
  const kindRegions = linked.filter((item) => normalizeKind(item.dataKind) === wantedKind);
  if (!kindRegions.length) fail("linked_data_kind_not_found", `No confirmed regions are linked as ${text(dataKind)} in this project.`, 404);
  const resolvedKind = kindRegions[0].dataKind;
  const experiments = [];
  const missingExperiments = [];
  for (const experimentId of requestedIds) {
    const identity = identityById.get(experimentId);
    if (!identity) fail("experiment_identity_not_found", `Experiment ${experimentId} does not belong to this project.`, 404);
    const regions = kindRegions.filter((item) => item.linkedExperimentId === experimentId);
    const label = identityLabel(identity, experimentId);
    if (!regions.length) {
      missingExperiments.push({ experimentId, label });
      continue;
    }
    const region = pickRegion(regions);
    experiments.push({
      experimentId,
      label,
      regionId: region.regionId,
      revisionId: region.revisionId,
      sourceDocumentId: region.sourceDocumentId,
      workbookReviewSessionId: region.workbookReviewSessionId,
      workbookName: region.workbookName,
      sheetName: region.sheetName,
      range: region.range,
      series: region.series,
      alternativeRegionIds: regions.filter((item) => item.regionId !== region.regionId).map((item) => item.regionId),
    });
  }
  const primarySeries = experiments.map((experiment) => experiment.series[0]).find(Boolean) || null;
  const resolvedChartType = chartTypeFor(chartType, primarySeries);
  const xDescription = primarySeries
    ? humanKey(primarySeries.xSemanticKey, primarySeries.orientation === "column_pair" ? "x values from the selected column" : "categories from the header row")
    : "categories from the header row";
  const yDescription = primarySeries
    ? `${primarySeries.label || resolvedKind}${primarySeries.yUnit ? ` (${primarySeries.yUnit})` : ""}`
    : resolvedKind;
  const labels = experiments.map((experiment) => experiment.label);
  const requestSummary = `Compare ${resolvedKind} across ${experiments.length} experiment${experiments.length === 1 ? "" : "s"}: ${labels.join(", ")}.`;
  const seriesSteps = primarySeries?.orientation === "header_row_categories"
    ? [
      "In each input table, the header row of category labels is the x axis and the row of numeric values beneath it is the y axis; ignore label cells and blanks.",
      "Keep the x categories in their original left-to-right order and align experiments on identical category labels.",
    ]
    : primarySeries?.orientation === "column_pair"
      ? ["In each input table, use the declared x column and y column as one series, keeping only rows where both are numeric."]
      : ["In each input table, treat the header row as x labels and the following numeric row as y values."];
  const plan = {
    requestSummary,
    outputTarget: "chart",
    inputMode: "workbook",
    sourceSelections: experiments.map((experiment) => ({
      regionUnderstandingRevisionId: experiment.revisionId,
      sourceDocumentId: experiment.sourceDocumentId,
      sheetName: experiment.sheetName,
      range: experiment.range,
      label: experiment.label,
      purpose: `${resolvedKind} for ${experiment.label}`,
    })),
    experimentSelections: [],
    reviewPlan: {
      summary: requestSummary,
      processingSteps: [
        `Each input table is one experiment's confirmed ${resolvedKind} region; the table label is the experiment name.`,
        ...seriesSteps,
        "Plot one trace per experiment, named by its experiment label, sharing one x axis and one y axis.",
      ],
      missingValueHandling: "Skip empty or non-numeric plotted values without inventing points.",
      chart: {
        title: `${resolvedKind} comparison`,
        chartType: resolvedChartType,
        xDescription,
        yDescription,
        seriesDescription: `One series per experiment: ${labels.join(", ")}`,
      },
      invariants: [],
    },
    displayPlan: [
      `Read ${experiments.length} confirmed ${resolvedKind} region${experiments.length === 1 ? "" : "s"} directly from the linked workbooks.`,
      ...experiments.map((experiment) => `${experiment.label}: ${experiment.workbookName} · ${experiment.sheetName}!${experiment.range}`),
      ...(missingExperiments.length ? [`Not included (no linked ${resolvedKind}): ${missingExperiments.map((item) => item.label).join(", ")}`] : []),
    ],
    linkedDataComparison: {
      schemaVersion: LINKED_DATA_COMPARISON_SCHEMA_VERSION,
      dataKind: resolvedKind,
      experiments: experiments.map((experiment, index) => ({
        experimentId: experiment.experimentId,
        label: experiment.label,
        sourceSelectionIndex: index,
        regionId: experiment.regionId,
        series: experiment.series,
      })),
      missingExperiments,
    },
  };
  return {
    schemaVersion: LINKED_DATA_COMPARISON_SCHEMA_VERSION,
    projectId,
    dataKind: resolvedKind,
    chartType: resolvedChartType,
    requestSummary,
    experiments,
    missingExperiments,
    warnings: experiments.filter((experiment) => experiment.alternativeRegionIds.length).map((experiment) => ({
      code: "linked_data_multiple_regions",
      message: `${experiment.label} has ${experiment.alternativeRegionIds.length + 1} linked ${resolvedKind} regions; the most recently confirmed one is used.`,
    })),
    plan,
  };
}
