import { describe, expect, it } from "vitest";
import { removeChartProposal, setChartProposalStatus } from "./chartProposalViewState.js";

describe("chartProposalViewState", () => {
  const proposalSet = {
    proposalSetId: "proposal_set_1",
    proposals: [{ proposalId: "proposal_1", status: "proposed" }],
  };

  it("updates and removes proposal display records without a dataset container", () => {
    expect(setChartProposalStatus(proposalSet, "proposal_1", "accepted").proposals[0].status).toBe("accepted");
    expect(removeChartProposal(proposalSet, "proposal_1").proposals).toEqual([]);
  });
});
