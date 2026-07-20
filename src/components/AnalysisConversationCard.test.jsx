import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalysisConversationCard } from "./AnalysisConversationCard.jsx";

describe("AnalysisConversationCard", () => {
  it("reopens the same reviewable analysis revision from the LabRat conversation", () => {
    const onOpen = vi.fn();
    const thread = {
      id: "analysis_thread_1",
      originalRequest: "Normalize selectivity and compare every experiment.",
      status: "planning",
    };
    const revision = {
      id: "analysis_plan_revision_2",
      revision: 2,
      status: "awaiting_review",
      requestSummary: "Normalize Solid, Liquid, and Gas to 100%.",
      sourceRectangles: [{ sourceDocumentId: "source_1", sheetName: "Runs", range: "B2:D8" }],
    };

    render(<AnalysisConversationCard thread={thread} revision={revision} onOpen={onOpen} />);

    expect(screen.getByText("Analysis plan revision 2")).toBeTruthy();
    expect(screen.getByText("Needs review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review analysis plan" }));
    expect(onOpen).toHaveBeenCalledWith({ thread, revision });
  });
});
