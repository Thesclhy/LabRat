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
    expect(within(dock).getByText("91% structure confidence")).toBeTruthy();
    expect(within(dock).queryByText("Structured interpretation")).toBeNull();
    expect(within(dock).queryByRole("checkbox")).toBeNull();
    expect(within(dock).queryByRole("button", { name: "Confirm understanding" })).toBeNull();

    fireEvent.click(within(dock).getByRole("button", { name: "Focus Runs!F1:H5" }));
    expect(onActiveRegionChange).toHaveBeenCalledWith("region_2");
  });

  it("shows an immediate interpreting card with ignore and delete actions", async () => {
    const interpretingRegion = {
      id: "region_pending",
      sourceDocumentId: "source_doc_1",
      sheetName: "Rates",
      rangeRef: "E12:K14",
      disposition: "active",
      reviewStatus: "interpreting",
      version: 1,
      currentRevisionId: null,
      acceptedRevisionId: null,
      currentRevision: null,
      warnings: [],
    };
    const onIgnoreRegion = vi.fn(async () => ({}));
    const onDeleteRegion = vi.fn(async () => ({}));
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={[interpretingRegion]}
        activeRegionId="region_pending"
        onIgnoreRegion={onIgnoreRegion}
        onDeleteRegion={onDeleteRegion}
      />,
    );

    const card = screen.getByRole("article", { name: "Region Rates!E12:K14" });
    expect(within(card).getByText("E12:K14")).toBeTruthy();
    expect(within(card).getByText("Rates")).toBeTruthy();
    expect(within(card).getByRole("status").textContent).toMatch(/AI is understanding/i);
    expect(within(card).queryByPlaceholderText("Describe what this region means or what should change...")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Confirm region Rates!E12:K14" })).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "Ignore region Rates!E12:K14" }));
    await waitFor(() => expect(onIgnoreRegion).toHaveBeenCalledWith("region_pending", {
      expectedRegionVersion: 1,
      reason: "Excluded during workbook review.",
    }));
    expect(within(card).getByRole("button", { name: "Delete region Rates!E12:K14" })).toBeTruthy();
  });

  it("retries only a failed region", async () => {
    const failedRegion = {
      ...reviewRegions[0],
      id: "region_failed",
      reviewStatus: "interpretation_failed",
      currentRevisionId: null,
      currentRevision: null,
      warnings: [{ code: "ai_unavailable", message: "Provider unavailable." }],
    };
    const onRetryRegion = vi.fn(async () => true);
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={[failedRegion]}
        onRetryRegion={onRetryRegion}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry AI for Runs!A1:D3" }));
    await waitFor(() => expect(onRetryRegion).toHaveBeenCalledWith("region_failed"));
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

  it("shows calculation provenance, a header-row series preview, and a calculation overlay toggle", () => {
    const onToggleCalculationOverlay = vi.fn();
    const regions = [{
      id: "region_calc",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      rangeRef: "P31:BA32",
      disposition: "active",
      reviewStatus: "awaiting_review",
      version: 1,
      currentRevisionId: "revision_calc",
      acceptedRevisionId: null,
      warnings: [{ code: "formula_chain_broken", message: "2 cells in this calculation chain hold typed numbers where neighbouring cells hold formulas (F43, G43)." }],
      currentRevision: {
        id: "revision_calc",
        summary: ["This row holds the overall carbon distribution for Exp31."],
        confidence: 0.9,
        validation: { status: "ready", blockers: [] },
        warnings: [{ code: "formula_chain_broken", message: "2 cells in this calculation chain hold typed numbers where neighbouring cells hold formulas (F43, G43)." }],
        interpretation: {
          semanticType: "component_distribution",
          experimentAxis: "region",
          experimentLabel: "Exp31",
          series: [{
            seriesKey: "carbon_distribution",
            label: "Overall carbon distribution",
            orientation: "header_row_categories",
            xHeaderRange: "Q31:BA31",
            yValueRange: "Q32:BA32",
            xSemanticKey: "carbon_number",
            yUnit: "% of feed carbon",
            pointCount: 37,
          }],
          provenance: {
            schemaVersion: "labrat.regionProvenance.v1",
            cellClassSummary: { terminal: 37, intermediate: 0, input: 0, constant: 38, blank: 1 },
            derivation: "Q32 = F14 where F14 = 0.5237 (Yield). Every calculated cell also depends on B12 (Total C atoms = 1.5711)",
            sharedInputs: [{ address: "B12", label: "Total C atoms", formattedValue: "1.5711" }],
            brokenCells: [{ sheetName: "Sheet1", address: "F43" }, { sheetName: "Sheet1", address: "G43" }],
            warnings: [{ code: "formula_chain_broken", message: "2 cells hold typed numbers." }],
          },
        },
      },
    }];

    const { rerender } = render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={regions}
        activeRegionId="region_calc"
        onToggleCalculationOverlay={onToggleCalculationOverlay}
      />,
    );

    const card = screen.getByRole("article", { name: "Region Sheet1!P31:BA32" });
    expect(within(card).getByText("37 results")).toBeTruthy();
    expect(within(card).getByText("38 labels or unused values")).toBeTruthy();
    expect(within(card).queryByText(/intermediate/)).toBeNull();
    expect(within(card).getByText(/^Q32 = F14 where F14 = 0\.5237 \(Yield\)/)).toBeTruthy();
    expect(within(card).getByText("Typed over formulas: F43, G43")).toBeTruthy();
    expect(within(card).getByText("Overall carbon distribution: 37 points, x = carbon number (Q31:BA31), y in % of feed carbon (Q32:BA32)")).toBeTruthy();
    const notices = within(card).getByLabelText("Notices for Sheet1!P31:BA32");
    expect(within(notices).getAllByText(/typed numbers where neighbouring cells hold formulas/)).toHaveLength(1);

    const toggle = within(card).getByRole("button", { name: "Show calculation for Sheet1!P31:BA32" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggleCalculationOverlay).toHaveBeenCalledWith(expect.objectContaining({ id: "region_calc" }));

    rerender(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={regions}
        activeRegionId="region_calc"
        calculationOverlayRegionId="region_calc"
        calculationOverlayState={{ regionId: "region_calc", loading: false, error: "" }}
        onToggleCalculationOverlay={onToggleCalculationOverlay}
      />,
    );
    expect(within(card).getByRole("button", { name: "Hide calculation for Sheet1!P31:BA32" }).getAttribute("aria-pressed")).toBe("true");

    rerender(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={regions}
        activeRegionId="region_calc"
        calculationOverlayRegionId="region_calc"
        calculationOverlayState={{ regionId: "region_calc", loading: false, error: "Cell classes are unavailable." }}
        onToggleCalculationOverlay={onToggleCalculationOverlay}
      />,
    );
    expect(within(card).getByRole("alert").textContent).toBe("Cell classes are unavailable.");
  });

  it("keeps cards without provenance unchanged", () => {
    render(<WorkbookReviewDock reviewState={reviewState()} reviewRegions={reviewRegions} activeRegionId="region_1" onToggleCalculationOverlay={() => {}} />);
    expect(screen.queryByRole("button", { name: /calculation for/ })).toBeNull();
    expect(screen.queryByLabelText(/Calculation provenance/)).toBeNull();
  });

  it("saves a confirmed region as an extraction template and shows an existing template name", async () => {
    const onSaveExtractionTemplate = vi.fn().mockResolvedValue({ regionExtractionTemplate: { id: "template_1", name: "Carbon distribution" } });
    const { rerender } = render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        activeRegionId="region_2"
        onSaveExtractionTemplate={onSaveExtractionTemplate}
      />,
    );

    const unconfirmed = screen.getByRole("article", { name: "Region Runs!A1:D3" });
    expect(within(unconfirmed).queryByRole("button", { name: /as extraction template/ })).toBeNull();

    const confirmedCard = screen.getByRole("article", { name: "Region Runs!F1:H5" });
    fireEvent.click(within(confirmedCard).getByRole("button", { name: "Save Runs!F1:H5 as extraction template" }));
    const input = within(confirmedCard).getByLabelText("Template name");
    expect(within(confirmedCard).getByRole("button", { name: "Save template" }).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Carbon distribution" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onSaveExtractionTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "region_2" }),
      { name: "Carbon distribution" },
    ));
    expect(await within(confirmedCard).findByText("Carbon distribution")).toBeTruthy();
    expect(within(confirmedCard).queryByRole("button", { name: /as extraction template/ })).toBeNull();

    rerender(
      <WorkbookReviewDock
        reviewState={reviewState()}
        reviewRegions={reviewRegions}
        activeRegionId="region_2"
        onSaveExtractionTemplate={onSaveExtractionTemplate}
        extractionTemplates={[{ id: "template_1", name: "Carbon distribution", status: "active", sourceRegionId: "region_2", currentVersion: 2 }]}
      />,
    );
    expect(within(confirmedCard).getByText(/\(v2\)/)).toBeTruthy();
  });
});
