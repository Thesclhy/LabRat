import { describe, expect, it } from "vitest";
import {
  setChartProposalStatus,
  setMappingStatus,
  upsertGenericChartProposalSet,
  upsertGenericMappingSet,
} from "./genericProposalState.js";

describe("generic proposal state helpers", () => {
  it("updates mapping and chart proposal review statuses", () => {
    const mappingSet = {
      mappingSetId: "mapping_set_1",
      mappings: [{ mappingId: "mapping_1", status: "proposed" }],
    };
    const proposalSet = {
      proposalSetId: "chart_set_1",
      proposals: [{ proposalId: "chart_1", status: "proposed" }],
    };

    expect(setMappingStatus(mappingSet, "mapping_1", "accepted").mappings[0].status).toBe("accepted");
    expect(setChartProposalStatus(proposalSet, "chart_1", "rejected").proposals[0].status).toBe("rejected");
  });

  it("upserts mapping and chart proposal sets without rewriting raw imports", () => {
    const dataset = {
      experiments: [{ label: "Exp1" }],
      genericImports: [{ importId: "import_1" }],
      genericMappingSets: [{ mappingSetId: "mapping_set_1", mappings: [] }],
      genericChartProposals: [],
    };

    const withMapping = upsertGenericMappingSet(dataset, {
      mappingSetId: "mapping_set_1",
      mappings: [{ mappingId: "mapping_1" }],
    });
    const withChart = upsertGenericChartProposalSet(withMapping, {
      proposalSetId: "chart_set_1",
      proposals: [{ proposalId: "chart_1" }],
    });

    expect(withChart.experiments).toEqual([{ label: "Exp1" }]);
    expect(withChart.genericImports).toEqual([{ importId: "import_1" }]);
    expect(withChart.genericMappingSets).toEqual([{ mappingSetId: "mapping_set_1", mappings: [{ mappingId: "mapping_1" }] }]);
    expect(withChart.genericChartProposals).toEqual([{ proposalSetId: "chart_set_1", proposals: [{ proposalId: "chart_1" }] }]);
  });
});
