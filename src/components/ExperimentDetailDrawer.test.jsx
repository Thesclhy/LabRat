import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperimentDetailDrawer } from "./ExperimentDetailDrawer.jsx";

const detail = {
  experiment: { id: "exp_1", canonicalLabel: "Exp 1", aliases: ["Run A"] },
  dataSnapshot: { id: "snapshot_1", acceptedAt: "2026-07-16T10:00:00.000Z" },
  record: {
    fields: [{ fieldKey: "temperature", displayName: "Temperature", value: 250, formattedValue: "250", unit: "degC", confidence: 0.91, warnings: [] }],
    series: [{ seriesKey: "rate", label: "Rate over time", xUnit: "min", yUnit: "mol/g/h", points: [{ x: 0, y: 1 }, { x: 5, y: 2 }], warnings: [] }],
    warnings: [{ code: "review_note", message: "Confirm catalyst label." }],
    sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", range: "A1:D4" }],
  },
};

describe("ExperimentDetailDrawer", () => {
  it("shows lazy scalar, series, warning, and source evidence detail", () => {
    const onOpenSourceRange = vi.fn();
    render(<ExperimentDetailDrawer detail={detail} onClose={vi.fn()} onOpenSourceRange={onOpenSourceRange} />);

    expect(screen.getByRole("heading", { name: "Exp 1" })).toBeTruthy();
    expect(screen.getByText("250 degC")).toBeTruthy();
    expect(screen.getByText("2 points")).toBeTruthy();
    expect(screen.getByText("Confirm catalyst label.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Runs A1:D4" }));
    expect(onOpenSourceRange).toHaveBeenCalledWith(detail.record.sourceRefs[0]);
  });

  it("renders loading and error states without stale content", () => {
    const { rerender } = render(<ExperimentDetailDrawer loading onClose={vi.fn()} />);
    expect(screen.getByText("Loading experiment detail..." )).toBeTruthy();
    rerender(<ExperimentDetailDrawer error="Detail unavailable" onClose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("Detail unavailable");
  });
});
