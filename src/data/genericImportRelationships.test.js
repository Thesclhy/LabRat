import { describe, expect, it } from "vitest";
import {
  getMasterImports,
  getSupplementalImports,
  pendingSupplementalImportRunsForProject,
  supplementalWorkbookSummariesForProject,
} from "./genericImportRelationships.js";

describe("generic import relationships", () => {
  it("treats observation sets as supplemental imports and keeps master imports separate", () => {
    const dataset = {
      genericImports: [
        { importId: "master", fileName: "master.xlsx", experiments: [{ experimentId: "exp_1" }] },
        {
          importId: "supplement",
          fileName: "rate.xlsx",
          relationship: { relationship: "supplement", supplementType: "reaction_rate_time_series", targetExperimentIds: ["exp_30"] },
          observationSets: [{ kind: "reaction_rate_time_series", observations: [{}, {}] }],
        },
      ],
    };

    expect(getMasterImports(dataset).map((item) => item.importId)).toEqual(["master"]);
    expect(getSupplementalImports(dataset).map((item) => item.importId)).toEqual(["supplement"]);
  });

  it("summarizes applied and pending supplemental workbooks for the overview card", () => {
    const projectState = {
      fileObjects: [
        { id: "file_pending", originalName: "pending-rate.xlsx" },
      ],
      importRuns: [
        {
          id: "run_pending",
          fileObjectId: "file_pending",
          status: "normalized_preview",
          scanResult: { sheets: [{ blocks: [{ detectedSupplementType: "reaction_rate_time_series" }] }] },
          normalizePreview: {
            datasetPatch: {
              genericImports: [{
                importId: "pending_import",
                observationSets: [{ kind: "reaction_rate_time_series", inferredExperimentLabel: "Exp31", observations: [{}, {}, {}] }],
                fields: [{}, {}],
              }],
            },
          },
          updatedAt: "2026-06-17T12:00:00.000Z",
        },
      ],
    };
    const dataset = {
      genericImports: [{
        importId: "applied_import",
        fileName: "rate.xlsx",
        relationship: { relationship: "supplement", supplementType: "reaction_rate_time_series", targetExperimentIds: ["exp_30"] },
        observationSets: [{ kind: "reaction_rate_time_series", inferredExperimentLabel: "Exp30", observations: Array.from({ length: 62 }, () => ({})) }],
        fields: [{}, {}, {}],
      }],
    };

    const summaries = supplementalWorkbookSummariesForProject(projectState, dataset);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      fileName: "rate.xlsx",
      supplementType: "reaction_rate_time_series",
      targetLabels: ["Exp30", "exp_30"],
      observationCount: 62,
      status: "applied",
    });
    expect(summaries[1]).toMatchObject({
      fileName: "pending-rate.xlsx",
      supplementType: "reaction_rate_time_series",
      targetLabels: ["Exp31"],
      observationCount: 3,
      status: "normalized_preview",
    });
  });

  it("finds pending supplemental import runs from scan metadata before normalize preview exists", () => {
    const pending = pendingSupplementalImportRunsForProject({
      fileObjects: [{ id: "file_1", originalName: "reaction-rate.xlsx" }],
      importRuns: [{
        id: "run_1",
        fileObjectId: "file_1",
        status: "review_ready",
        scanResult: { sheets: [{ blocks: [{ detectedSupplementType: "reaction_rate_time_series" }] }] },
      }],
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].fileName).toBe("reaction-rate.xlsx");
    expect(pending[0].status).toBe("review_ready");
  });
});
