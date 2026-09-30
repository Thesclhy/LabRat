import { MemorySaasStore } from "../memoryStore.js";
import { createAnalysisThread } from "../analysisThreads.js";

// Q09 has one scalar per experiment. A genuine within-experiment series is a separate case.
export async function temperaturePlanFixture({ seriesPoints = null, request, outputTarget = "chart" } = {}) {
  const store = new MemorySaasStore();
  const project = { id: "project_temperature", labId: "lab_temperature", name: "Temperature regression" };
  const series = seriesPoints !== null;
  const matrix = series
    ? [["Time (min)", "Temperature (C)"], ...seriesPoints.map((value, i) => [i, value])]
    : [["Experiment", "Temperature (C)"], ["Exp17", 80], ["Exp17B", 95]];
  const range = "A1:B" + matrix.length;
  store.sourceDocuments.set("source_temperature", {
    id: "source_temperature", projectId: project.id,
    originalFilename: series ? "Exp17-series.xlsx" : "Q09-raw.xlsx",
  });
  store.sourceIndexBlobs.set("blob_temperature", {
    id: "blob_temperature", sourceDocumentId: "source_temperature",
    payload: { sheets: [{ name: "Measurements", cellGrid: { cells: matrix.flatMap((row, r) => row.map((value, c) => ({
      row: r, col: c, address: String.fromCharCode(65 + c) + (r + 1),
      rawValue: value, formattedValue: String(value), type: typeof value === "number" ? "number" : "string",
    }))) } }] },
  });
  store.workbookReviewRegions.set("region_temperature", {
    id: "region_temperature", projectId: project.id, sourceDocumentId: "source_temperature",
    sheetName: "Measurements", rangeRef: range, disposition: "active", acceptedRevisionId: "revision_temperature",
  });
  store.regionUnderstandingRevisions.set("revision_temperature", {
    id: "revision_temperature", projectId: project.id, regionId: "region_temperature",
    summary: [series ? "Confirmed temperature measurements over time for Exp17." : "One scalar temperature per experiment: Exp17 and Exp17B. No within-experiment temperature series."],
    interpretation: {
      semanticType: series ? "time_series" : "experiment_table", headerRow: 1,
      experimentLabel: series ? "Exp17" : null, experimentIdColumn: series ? null : "A",
      fields: series ? [] : [{ column: "A", displayName: "Experiment", valueType: "string" }, { column: "B", displayName: "Temperature", valueType: "number", unit: "C" }],
      series: series ? [{ seriesKey: "temperature", label: "Exp17 temperature over time", xColumn: "A", yColumn: "B", xUnit: "min", yUnit: "C", pointCount: seriesPoints.length }] : [],
    },
  });
  const thread = await createAnalysisThread({ store, project, actorUserId: "user_1", outputTarget,
    originalRequest: request || "Calculate the mean of Exp17's temperature series and plot it." });
  return { store, project, thread };
}
