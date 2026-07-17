import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataPlanReviewPanel } from "./DataPlanReviewPanel.jsx";

function reviewFixture({
  blockers = [{ code: "identity_decision_required", sourceAlias: "Exp1", message: "Choose an identity decision." }],
  decision = null,
  identityCandidates = null,
} = {}) {
  return {
    dataPlan: {
      id: "data_plan_preview_1",
      dependencyHash: "sha256_dependency",
    },
    snapshotPreview: {
      previewHash: "sha256_preview",
      experimentRecords: [{ label: "Exp1", fields: [], series: [] }],
    },
    identityCandidates: identityCandidates || [{
      sourceAlias: "Exp1",
      normalizedAlias: "exp1",
      occurrenceCount: 1,
      matches: [{ id: "experiment_identity_existing", label: "Experiment One" }],
      decision,
    }],
    reviewSummary: {
      experimentRecordCount: 1,
      includedRowCount: 3,
      skippedRowCount: 1,
      fields: [{
        fieldKey: "yield",
        displayName: "Yield",
        role: "outcome",
        valueType: "number",
        unit: "percent",
        coverage: 1,
        sourceRefs: [{ sourceDocumentId: "source_doc_1", sheet: "Runs", cell: "C2" }],
      }],
      sourceRanges: [{
        evidenceKey: "wu_1:fact_1",
        sourceDocumentId: "source_doc_1",
        sheetName: "Runs",
        range: "A1:C4",
      }],
      warnings: [{ code: "non_scalar_region_field", message: "A varying region field was not emitted as scalar." }],
      blockers,
    },
  };
}

function unmatchedIdentityCandidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    sourceAlias: `Exp${index + 1}`,
    normalizedAlias: `exp${index + 1}`,
    occurrenceCount: 1,
    matches: [],
    decision: null,
  }));
}

describe("DataPlanReviewPanel", () => {
  it("shows experiment counts, field units, warnings, source ranges, and identity decisions", () => {
    render(<DataPlanReviewPanel review={reviewFixture()} />);

    expect(screen.getByRole("heading", { name: "Experiment data preview" })).toBeTruthy();
    expect(screen.getByText("1 experiment record")).toBeTruthy();
    expect(screen.getByText("3 included rows")).toBeTruthy();
    expect(screen.getByText("1 skipped row")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Yield" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "percent" })).toBeTruthy();
    expect(screen.getByText("A varying region field was not emitted as scalar.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Runs A1:C4" })).toBeTruthy();
    expect(screen.getByLabelText("Identity decision for Exp1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish to Browser" }).disabled).toBe(true);
  });

  it("submits explicit create and reuse identity decisions", () => {
    const onApplyIdentityDecisions = vi.fn();
    render(<DataPlanReviewPanel review={reviewFixture()} onApplyIdentityDecisions={onApplyIdentityDecisions} />);

    fireEvent.change(screen.getByLabelText("Identity decision for Exp1"), { target: { value: "create" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply identity decisions" }));
    expect(onApplyIdentityDecisions).toHaveBeenLastCalledWith([{ sourceAlias: "Exp1", action: "create" }]);

    fireEvent.change(screen.getByLabelText("Identity decision for Exp1"), { target: { value: "reuse" } });
    expect(screen.getByRole("button", { name: "Apply identity decisions" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Existing identity for Exp1"), {
      target: { value: "experiment_identity_existing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply identity decisions" }));
    expect(onApplyIdentityDecisions).toHaveBeenLastCalledWith([{
      sourceAlias: "Exp1",
      action: "reuse",
      experimentIdentityId: "experiment_identity_existing",
    }]);
  });

  it("sets every unmatched experiment to create with one bulk action", () => {
    const onApplyIdentityDecisions = vi.fn();
    render(
      <DataPlanReviewPanel
        review={reviewFixture({
          blockers: unmatchedIdentityCandidates(60).map((candidate) => ({
            code: "identity_decision_required",
            sourceAlias: candidate.sourceAlias,
            message: "Choose an identity decision.",
          })),
          identityCandidates: unmatchedIdentityCandidates(60),
        })}
        onApplyIdentityDecisions={onApplyIdentityDecisions}
      />,
    );

    expect(screen.getByText("60 unresolved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create 60 unmatched" }));
    expect(screen.getByText("60 new")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply identity decisions" }));

    expect(onApplyIdentityDecisions).toHaveBeenCalledTimes(1);
    expect(onApplyIdentityDecisions.mock.calls[0][0]).toHaveLength(60);
    expect(onApplyIdentityDecisions.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { sourceAlias: "Exp1", action: "create" },
      { sourceAlias: "Exp60", action: "create" },
    ]));
  });

  it("bulk accepts only unique exact matches and leaves ambiguous candidates unresolved", () => {
    const identityCandidates = [{
      sourceAlias: "Exp1",
      normalizedAlias: "exp1",
      occurrenceCount: 1,
      matches: [{ id: "identity_1", label: "Exp1" }],
      decision: null,
    }, {
      sourceAlias: "Exp2",
      normalizedAlias: "exp2",
      occurrenceCount: 1,
      matches: [
        { id: "identity_2a", label: "Exp2 A" },
        { id: "identity_2b", label: "Exp2 B" },
      ],
      decision: null,
    }, {
      sourceAlias: "Exp3",
      normalizedAlias: "exp3",
      occurrenceCount: 1,
      matches: [],
      decision: null,
    }];
    render(<DataPlanReviewPanel review={reviewFixture({ identityCandidates })} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept 1 exact match" }));

    expect(screen.getByLabelText("Identity decision for Exp1").value).toBe("reuse");
    expect(screen.getByLabelText("Existing identity for Exp1").value).toBe("identity_1");
    expect(screen.getByLabelText("Identity decision for Exp2").value).toBe("");
    expect(screen.getByLabelText("Identity decision for Exp3").value).toBe("");
    expect(screen.getByText("1 reused")).toBeTruthy();
    expect(screen.getByText("1 conflict")).toBeTruthy();
    expect(screen.getByText("1 unresolved")).toBeTruthy();
  });

  it("applies selected bulk actions, filters the list, and undoes the batch", () => {
    render(<DataPlanReviewPanel review={reviewFixture({ identityCandidates: unmatchedIdentityCandidates(3) })} />);

    fireEvent.click(screen.getByLabelText("Select Exp1"));
    fireEvent.click(screen.getByLabelText("Select Exp2"));
    fireEvent.click(screen.getByRole("button", { name: "Create selected unmatched" }));

    expect(screen.getByText("2 new")).toBeTruthy();
    expect(screen.getByText("1 unresolved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New 2" }));
    expect(screen.getByLabelText("Identity decision for Exp1").value).toBe("create");
    expect(screen.getByLabelText("Identity decision for Exp2").value).toBe("create");
    expect(screen.queryByLabelText("Identity decision for Exp3")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo batch" }));
    expect(screen.getByText("3 unresolved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New 0" })).toBeTruthy();
  });

  it("enables publish only for a blocker-free review with a publish handler", () => {
    const onPublish = vi.fn();
    const { rerender } = render(
      <DataPlanReviewPanel
        review={reviewFixture({ blockers: [], decision: { action: "create" } })}
        onPublish={onPublish}
      />,
    );

    const publish = screen.getByRole("button", { name: "Publish to Browser" });
    expect(publish.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Identity decision for Exp1"), { target: { value: "reuse" } });
    fireEvent.change(screen.getByLabelText("Existing identity for Exp1"), {
      target: { value: "experiment_identity_existing" },
    });
    expect(publish.disabled).toBe(true);

    rerender(
      <DataPlanReviewPanel
        review={reviewFixture({
          blockers: [],
          decision: { action: "reuse", experimentIdentityId: "experiment_identity_existing" },
        })}
        onPublish={onPublish}
      />,
    );
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    expect(onPublish).toHaveBeenCalledWith({
      dataPlan: expect.objectContaining({ id: "data_plan_preview_1" }),
      identityDecisions: [{ sourceAlias: "Exp1", action: "reuse", experimentIdentityId: "experiment_identity_existing" }],
      expectedPreviewHash: "sha256_preview",
      expectedDependencyHash: "sha256_dependency",
    });
  });

  it("does not publish a blocker-free preview with unresolved identity decisions", () => {
    render(<DataPlanReviewPanel review={reviewFixture({ blockers: [] })} onPublish={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Publish to Browser" }).disabled).toBe(true);
  });

  it("shows publish progress, prevents double submit, and transitions to success", async () => {
    let resolvePublish;
    const onPublish = vi.fn(() => new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    render(
      <DataPlanReviewPanel
        review={reviewFixture({ blockers: [], decision: { action: "create" } })}
        onPublish={onPublish}
      />,
    );

    const publish = screen.getByRole("button", { name: "Publish to Browser" });
    fireEvent.click(publish);
    fireEvent.click(publish);

    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Publishing..." }).disabled).toBe(true);
    await act(async () => {
      resolvePublish({
        dataSnapshot: { id: "data_snapshot_1", experimentRecordCount: 1 },
        experimentProjectionSummary: { publishedExperimentCount: 1, experimentIds: ["experiment_1"] },
      });
    });

    expect((await screen.findByRole("status")).textContent).toContain("Published 1 experiment");
    expect(screen.getByRole("button", { name: "Published" }).disabled).toBe(true);
    expect(onPublish).toHaveBeenCalledWith({
      dataPlan: expect.objectContaining({ id: "data_plan_preview_1" }),
      identityDecisions: [{ sourceAlias: "Exp1", action: "create" }],
      expectedPreviewHash: "sha256_preview",
      expectedDependencyHash: "sha256_dependency",
    });
  });

  it("hands a stale server review back to the parent without losing the panel", async () => {
    const currentReview = reviewFixture({ blockers: [], decision: { action: "create" } });
    currentReview.dataPlan.id = "data_plan_preview_refreshed";
    currentReview.snapshotPreview.previewHash = "sha256_refreshed";
    const onPreviewStale = vi.fn();
    const onPublish = vi.fn().mockRejectedValue(Object.assign(new Error("Source evidence changed."), {
      code: "preview_stale",
      details: { currentReview },
    }));
    render(
      <DataPlanReviewPanel
        review={reviewFixture({ blockers: [], decision: { action: "create" } })}
        onPublish={onPublish}
        onPreviewStale={onPreviewStale}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish to Browser" }));

    await waitFor(() => expect(onPreviewStale).toHaveBeenCalledWith(currentReview));
    expect(screen.getByRole("alert").textContent).toContain("Source evidence changed.");
    expect(screen.getByRole("heading", { name: "Experiment data preview" })).toBeTruthy();
  });
});
