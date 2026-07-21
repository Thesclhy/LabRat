import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbookReviewDock } from "./WorkbookReviewDock.jsx";

const reviewRegions = [
  {
    id: "region_1",
    sourceDocumentId: "source_doc_1",
    sheetName: "Runs",
    rangeRef: "A1:D3",
    disposition: "active",
    reviewStatus: "awaiting_review",
    version: 2,
    currentRevisionId: "revision_1",
    acceptedRevisionId: null,
    currentRevision: {
      id: "revision_1",
      summary: [
        "Each row represents one experiment.",
        "The table contains temperature, time, and gas selectivity.",
      ],
      confidence: 0.91,
      validation: { status: "ready", blockers: [] },
      warnings: [],
    },
  },
  {
    id: "region_2",
    sourceDocumentId: "source_doc_1",
    sheetName: "Runs",
    rangeRef: "F1:H5",
    disposition: "active",
    reviewStatus: "accepted",
    version: 4,
    currentRevisionId: "revision_2",
    acceptedRevisionId: "revision_2",
    currentRevision: {
      id: "revision_2",
      summary: ["This region contains reaction rate values over time."],
      confidence: 0.74,
      validation: { status: "ready", blockers: [] },
      warnings: [{ code: "review_unit", message: "Confirm the rate unit." }],
    },
  },
];

function reviewState(overrides = {}) {
  return {
    session: { id: "session_1", status: "needs_user_review" },
    sourceDocument: { id: "source_doc_1", metadata: { workbookName: "Master.xlsx" } },
    ...overrides,
  };
}

describe("WorkbookReviewDock", () => {
  it("renders compact AI summaries and focuses one server region", () => {
    const onActiveRegionChange = vi.fn();
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        activeRegionId="region_1"
        onActiveRegionChange={onActiveRegionChange}
      />,
    );

    const dock = screen.getByLabelText("Workbook review dock");
    expect(within(dock).getByText("Each row represents one experiment.")).toBeTruthy();
    expect(within(dock).getByText("The table contains temperature, time, and gas selectivity.")).toBeTruthy();
    expect(within(dock).queryByText("Structured interpretation")).toBeNull();
    expect(within(dock).queryByRole("checkbox")).toBeNull();
    expect(within(dock).queryByRole("button", { name: "Confirm understanding" })).toBeNull();

    fireEvent.click(within(dock).getByRole("button", { name: "Focus Runs!F1:H5" }));
    expect(onActiveRegionChange).toHaveBeenCalledWith("region_2");
  });

  it("submits feedback only for the card that owns the input", async () => {
    const onReviseRegion = vi.fn(async () => ({}));
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        activeRegionId="region_1"
        onReviseRegion={onReviseRegion}
      />,
    );

    const firstCard = screen.getByRole("article", { name: "Region Runs!A1:D3" });
    fireEvent.change(within(firstCard).getByPlaceholderText("Describe what this region means or what should change..."), {
      target: { value: "Column D is liquid selectivity, not gas selectivity." },
    });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Submit revision for Runs!A1:D3" }));

    await waitFor(() => expect(onReviseRegion).toHaveBeenCalledWith("region_1", {
      feedback: "Column D is liquid selectivity, not gas selectivity.",
      previousRevisionId: "revision_1",
      expectedRegionVersion: 2,
    }));
    expect(within(firstCard).getByPlaceholderText("Describe what this region means or what should change...").value).toBe("");
  });

  it("confirms an exact current revision and disables an already accepted one", async () => {
    const onConfirmRegion = vi.fn(async () => ({}));
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        activeRegionId="region_1"
        onConfirmRegion={onConfirmRegion}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm region Runs!A1:D3" }));
    await waitFor(() => expect(onConfirmRegion).toHaveBeenCalledWith("region_1", {
      revisionId: "revision_1",
      expectedRegionVersion: 2,
    }));
    expect(screen.getByRole("button", { name: "Region Runs!F1:H5 confirmed" }).disabled).toBe(true);
  });

  it("keeps ignore and logical delete scoped to one region", async () => {
    const onIgnoreRegion = vi.fn(async () => ({}));
    const onDeleteRegion = vi.fn(async () => ({}));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        onIgnoreRegion={onIgnoreRegion}
        onDeleteRegion={onDeleteRegion}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ignore region Runs!A1:D3" }));
    await waitFor(() => expect(onIgnoreRegion).toHaveBeenCalledWith("region_1", {
      expectedRegionVersion: 2,
      reason: "Excluded during workbook review.",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Delete region Runs!F1:H5" }));
    await waitFor(() => expect(onDeleteRegion).toHaveBeenCalledWith("region_2", {
      expectedRegionVersion: 4,
      reason: "Deleted during workbook review.",
    }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("offers DataPlan review when at least one active region is accepted", () => {
    const onReviewExtractedExperiments = vi.fn();
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        onReviewExtractedExperiments={onReviewExtractedExperiments}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review extracted experiments" }));
    expect(onReviewExtractedExperiments).toHaveBeenCalledTimes(1);
  });
});
