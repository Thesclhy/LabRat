import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartReviewPanel } from "./BackendScanPanel.jsx";

vi.mock("../charts/Plot.jsx", () => ({
  Plot: () => <div data-testid="plot" />,
}));

describe("ChartReviewPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits every chart prompt to the reviewed analysis entrypoint", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewPanel
        allowAnalysisPrompt
        chartInterpretState={{ loading: false, error: "" }}
        onInterpretChart={onInterpretChart}
      />,
    );

    fireEvent.change(screen.getByLabelText("Describe the chart"), {
      target: { value: "Plot Sheet1!A1:Y63 for Exp31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan" }));

    expect(onInterpretChart).toHaveBeenCalledWith("Plot Sheet1!A1:Y63 for Exp31");
  });

  it("shows planning progress and backend errors", () => {
    render(
      <ChartReviewPanel
        allowAnalysisPrompt
        chartInterpretState={{ loading: true, error: "Planning failed" }}
      />,
    );

    expect(screen.getByText("Selecting evidence and drafting a reviewable plan...")).toBeTruthy();
    expect(screen.getByText("Planning failed")).toBeTruthy();
  });

  it("shows only published analysis ChartSpecs in approved mode", () => {
    render(<ChartReviewPanel viewMode="edit" chartSpecs={[]} />);

    expect(screen.getByText("No approved ChartSpecs yet.")).toBeTruthy();
  });
});
