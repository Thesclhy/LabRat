import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbookReviewDock } from "./WorkbookReviewDock.jsx";

const draftRegions = [
  {
    clientRegionId: "draft_1",
    draftRegionId: "draft_1",
    sourceDocumentId: "source_doc_1",
    sheetName: "Sheet1",
    range: "A1:B3",
    semanticType: "experiment_table",
    status: "draft",
    warnings: [],
  },
  {
    clientRegionId: "draft_2",
    draftRegionId: "draft_2",
    sourceDocumentId: "source_doc_1",
    sheetName: "Sheet1",
    range: "D1:E5",
    semanticType: "reaction_rate_time_series",
    status: "draft",
    warnings: [{ code: "review_units", message: "Confirm units." }],
  },
];

function reviewState(overrides = {}) {
  return {
    revisionLoading: false,
    confirmLoading: false,
    revisionError: "",
    clarification: null,
    session: {
      id: "session_1",
      status: "needs_user_review",
      messages: [
        { id: "message_1", role: "assistant", content: "I indexed the workbook." },
        { id: "message_2", role: "user", content: "The first box is the experiment table." },
      ],
      currentUnderstanding: {
        id: "understanding_draft_1",
        facts: [{ factId: "fact_1", kind: "region_description" }],
      },
    },
    sourceDocument: { id: "source_doc_1", metadata: { workbookName: "Master.xlsx" } },
    ...overrides,
  };
}

function structuredReviewState(overrides = {}) {
  return reviewState({
    session: {
      ...reviewState().session,
      currentUnderstanding: {
        id: "understanding_draft_1",
        validation: { status: "ready", blockers: [] },
        facts: [{
          factId: "fact_draft_1",
          draftRegionId: "draft_1",
          sheetName: "Sheet1",
          range: "A1:B3",
          semanticType: "experiment_table",
          interpretation: {
            schemaVersion: "labrat.workbookRegionInterpretation.v1",
            experimentAxis: "rows",
            headerRow: 1,
            experimentLabel: null,
            experimentIdColumn: "A",
            fields: [{
              column: "B",
              headerCell: "B1",
              semanticKey: "reaction_temperature",
              displayName: "Temperature",
              role: "condition",
              valueType: "number",
              unit: "degC",
              confidence: 0.9,
              sourceRefs: [{ sourceType: "excel_cell", sheet: "Sheet1", cell: "B1" }],
            }],
            series: [],
            inclusion: {
              startRow: 2,
              endRow: 3,
              skippedRows: [{ rowNumber: 3, reason: "blank_identifier" }],
            },
            confidence: 0.9,
            warnings: [{ code: "review_unit", message: "Confirm the temperature unit." }],
          },
        }],
      },
    },
    ...overrides,
  });
}

describe("WorkbookReviewDock", () => {
  it("keeps the conversation and all red boxes visible while changing the active box", () => {
    const onActiveDraftRegionChange = vi.fn();
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
        onActiveDraftRegionChange={onActiveDraftRegionChange}
      />,
    );

    const dock = screen.getByLabelText("Workbook review dock");
    expect(within(dock).getByText("I indexed the workbook.")).toBeTruthy();
    expect(within(dock).getByText("The first box is the experiment table.")).toBeTruthy();
    expect(within(dock).getByText("A1:B3").className).toContain("is-active");
    expect(within(dock).getByText("D1:E5")).toBeTruthy();

    fireEvent.click(within(dock).getByRole("button", { name: "Activate Sheet1!D1:E5" }));

    expect(onActiveDraftRegionChange).toHaveBeenCalledWith("draft_2");
  });

  it("submits the active box by default and supports an explicit multi-box revision", async () => {
    const onSubmitRevision = vi.fn(async () => ({}));
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
        onSubmitRevision={onSubmitRevision}
      />,
    );

    const dock = screen.getByLabelText("Workbook review dock");
    const textarea = within(dock).getByPlaceholderText("Describe what should change about the selected red box...");
    fireEvent.change(textarea, { target: { value: "Use both boxes for this interpretation." } });
    fireEvent.click(within(dock).getByRole("checkbox", { name: "Include Sheet1!D1:E5 in revision" }));
    fireEvent.click(within(dock).getByRole("button", { name: "Submit revision" }));

    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledWith(expect.objectContaining({
      message: "Use both boxes for this interpretation.",
      previousUnderstandingId: "understanding_draft_1",
      revisionMode: "merge",
      activeDraftRegionId: "draft_1",
    })));
    expect(onSubmitRevision.mock.calls[0][0].redBoxUpdates).toHaveLength(2);
    expect(onSubmitRevision.mock.calls[0][0].redBoxUpdates).toEqual([
      expect.objectContaining({ description: "Use both boxes for this interpretation.", semanticType: "" }),
      expect.objectContaining({ description: "Use both boxes for this interpretation.", semanticType: "" }),
    ]);
  });

  it("keeps submission progress and errors local to the dock", async () => {
    let rejectRevision;
    const onSubmitRevision = vi.fn(() => new Promise((resolve, reject) => {
      rejectRevision = reject;
    }));
    render(
      <WorkbookReviewDock
        reviewState={reviewState()}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
        onSubmitRevision={onSubmitRevision}
      />,
    );

    const dock = screen.getByLabelText("Workbook review dock");
    fireEvent.change(within(dock).getByPlaceholderText("Describe what should change about the selected red box..."), {
      target: { value: "This is a condition table." },
    });
    fireEvent.click(within(dock).getByRole("button", { name: "Submit revision" }));
    expect(within(dock).getByRole("button", { name: "Submitting revision" }).disabled).toBe(true);

    rejectRevision(new Error("Revision failed."));

    expect(await within(dock).findByText("Revision failed.")).toBeTruthy();
    expect(within(dock).getByPlaceholderText("Describe what should change about the selected red box...").value).toBe("This is a condition table.");
  });

  it("transitions to extracted-experiment review after confirmation without closing", async () => {
    const onReviewExtractedExperiments = vi.fn();

    function Harness() {
      const [state, setState] = useState(reviewState());
      return (
        <WorkbookReviewDock
          reviewState={state}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_1"
          onConfirmUnderstanding={async (input) => {
            expect(input).toMatchObject({ workbookUnderstandingId: "understanding_draft_1" });
            const acceptedSession = { ...state.session, status: "accepted" };
            setState({ ...state, session: acceptedSession });
            return { workbookReviewSession: acceptedSession };
          }}
          onReviewExtractedExperiments={onReviewExtractedExperiments}
        />
      );
    }

    render(<Harness />);
    const dock = screen.getByLabelText("Workbook review dock");
    fireEvent.click(within(dock).getByRole("button", { name: "Confirm understanding" }));

    const nextButton = await within(dock).findByRole("button", { name: "Review extracted experiments" });
    fireEvent.click(nextButton);

    expect(onReviewExtractedExperiments).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Workbook review dock")).toBeTruthy();
  });

  it("shows structured experiments, fields, units, included and skipped rows, warnings, and source range", () => {
    render(
      <WorkbookReviewDock
        reviewState={structuredReviewState()}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
      />,
    );

    const interpretation = screen.getByRole("region", { name: "Structured interpretation" });
    expect(within(interpretation).getByText("Sheet1!A1:B3")).toBeTruthy();
    expect(within(interpretation).getByText("Experiments")).toBeTruthy();
    expect(within(interpretation).getByLabelText("Experiment axis").value).toBe("rows");
    expect(within(interpretation).getByLabelText("Experiment identity column").value).toBe("A");
    expect(within(interpretation).getByText("Fields and units")).toBeTruthy();
    expect(within(interpretation).getByDisplayValue("reaction_temperature")).toBeTruthy();
    expect(within(interpretation).getByDisplayValue("degC")).toBeTruthy();
    expect(within(interpretation).getByText("Included rows")).toBeTruthy();
    expect(within(interpretation).getByDisplayValue("3: blank_identifier")).toBeTruthy();
    expect(within(interpretation).getByText("Confirm the temperature unit.")).toBeTruthy();
    expect(within(interpretation).getByText("B1")).toBeTruthy();
  });

  it("submits structured fallback controls as a typed interpretation patch", async () => {
    const onSubmitRevision = vi.fn(async () => ({}));
    render(
      <WorkbookReviewDock
        reviewState={structuredReviewState()}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
        onSubmitRevision={onSubmitRevision}
      />,
    );

    const interpretation = screen.getByRole("region", { name: "Structured interpretation" });
    fireEvent.change(within(interpretation).getByLabelText("Experiment axis"), { target: { value: "region" } });
    fireEvent.change(within(interpretation).getByLabelText("Experiment label"), { target: { value: "Exp33" } });
    fireEvent.change(within(interpretation).getByLabelText("Role for Temperature"), { target: { value: "outcome" } });
    fireEvent.change(within(interpretation).getByLabelText("Unit for Temperature"), { target: { value: "K" } });
    fireEvent.change(within(interpretation).getByLabelText("Skipped rows"), { target: { value: "3: user_excluded" } });
    fireEvent.click(within(interpretation).getByRole("button", { name: "Apply structured interpretation" }));

    await waitFor(() => expect(onSubmitRevision).toHaveBeenCalledTimes(1));
    expect(onSubmitRevision.mock.calls[0][0]).toEqual(expect.objectContaining({
      message: "Updated structured interpretation for Sheet1!A1:B3.",
      revisionMode: "replace_current",
      activeDraftRegionId: "draft_1",
      redBoxUpdates: [expect.objectContaining({ draftRegionId: "draft_1", range: "A1:B3" })],
      interpretationPatches: [expect.objectContaining({
        draftRegionId: "draft_1",
        experimentAxis: "region",
        experimentLabel: "Exp33",
        experimentIdColumn: null,
        fields: [expect.objectContaining({
          column: "B",
          role: "outcome",
          unit: "K",
        })],
        inclusion: expect.objectContaining({
          skippedRows: [{ rowNumber: 3, reason: "user_excluded" }],
        }),
      })],
    }));
  });

  it("disables confirmation and shows blockers until experiment identity is resolved", () => {
    const state = structuredReviewState();
    state.session.currentUnderstanding.validation = {
      status: "blocked",
      blockers: [{
        code: "experiment_identity_column_required",
        draftRegionId: "draft_1",
        message: "Choose the experiment identity column.",
      }],
    };
    render(
      <WorkbookReviewDock
        reviewState={state}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
        onConfirmUnderstanding={vi.fn()}
      />,
    );

    expect(screen.getByText("Choose the experiment identity column.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm understanding" }).disabled).toBe(true);
  });

  it("renders an accepted structured interpretation as read-only", () => {
    const state = structuredReviewState();
    state.session.status = "accepted";
    render(
      <WorkbookReviewDock
        reviewState={state}
        draftRegions={draftRegions}
        activeDraftRegionId="draft_1"
        onSubmitRevision={vi.fn()}
        onReviewExtractedExperiments={vi.fn()}
      />,
    );

    const interpretation = screen.getByRole("region", { name: "Structured interpretation" });
    expect(within(interpretation).getByRole("group", { name: "Experiments" }).disabled).toBe(true);
    expect(within(interpretation).queryByRole("button", { name: "Apply structured interpretation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review extracted experiments" })).toBeTruthy();
  });
});
