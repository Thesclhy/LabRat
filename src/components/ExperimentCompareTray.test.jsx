import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperimentCompareTray } from "./ExperimentCompareTray.jsx";

const summaries = [
  { experimentId: "exp_1", label: "Exp 1" },
  { experimentId: "exp_2", label: "Exp 2" },
];

const details = [{
  experiment: { id: "exp_1", canonicalLabel: "Exp 1" },
  record: {
    fields: [{ fieldKey: "temperature", displayName: "Temperature", valueType: "number", value: 250, formattedValue: "250", unit: "degC" }],
    series: [{ seriesKey: "rate", label: "Rate", xUnit: "min", yUnit: "mol/g/h", points: [{ x: 0, y: 1 }, { x: 5, y: 2 }] }],
    sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", range: "A1:C3" }],
  },
}, {
  experiment: { id: "exp_2", canonicalLabel: "Exp 2" },
  record: {
    fields: [{ fieldKey: "temperature", displayName: "Temperature", valueType: "number", value: 523, formattedValue: "523", unit: "K" }],
    series: [],
    sourceRefs: [{ sourceDocumentId: "source_1", sheet: "Runs", range: "A4:C4" }],
  },
}];

describe("ExperimentCompareTray", () => {
  it("keeps unique selections visible and supports remove, clear, and open", () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const onOpen = vi.fn();
    render(
      <ExperimentCompareTray
        selectedExperimentIds={["exp_1", "exp_1", "exp_2"]}
        summaries={summaries}
        onRemove={onRemove}
        onClear={onClear}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Exp 1 from comparison" }));
    expect(onRemove).toHaveBeenCalledWith("exp_1");
    fireEvent.click(screen.getByRole("button", { name: "Clear comparison" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Compare selected experiments" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows incompatible units as separate scalar columns and series inventory without conversion", () => {
    render(
      <ExperimentCompareTray
        selectedExperimentIds={["exp_1", "exp_2"]}
        summaries={summaries}
        details={details}
        expanded
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Temperature (degC)" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Temperature (K)" })).toBeTruthy();
    expect(screen.getByText("250 degC")).toBeTruthy();
    expect(screen.getByText("523 K")).toBeTruthy();
    expect(screen.getByText("2 points")).toBeTruthy();
    expect(screen.getByText("Runs A1:C3")).toBeTruthy();
  });
});
