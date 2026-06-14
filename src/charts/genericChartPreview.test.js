import { describe, expect, it } from "vitest";
import { makeGenericChartPreview } from "./genericChartPreview.js";

function genericImports() {
  return [{
    importId: "import_1",
    experiments: [
      { experimentId: "exp_1", name: "Exp1" },
      { experimentId: "exp_2", name: "Exp1" },
    ],
    measurements: [
      { measurementId: "time_1", experimentId: "exp_1", rowIndex: 2, value: 0, rawValue: "0" },
      { measurementId: "conv_1", experimentId: "exp_1", rowIndex: 2, value: 0, rawValue: "0" },
      { measurementId: "time_2", experimentId: "exp_2", rowIndex: 3, value: 10, rawValue: "10" },
      { measurementId: "conv_2", experimentId: "exp_2", rowIndex: 3, value: 25, rawValue: "25" },
    ],
  }];
}

describe("makeGenericChartPreview", () => {
  it("builds read-only scatter traces from paired proposal measurements", () => {
    const preview = makeGenericChartPreview({
      chartType: "scatter",
      title: "Conversion vs Time",
      x: { label: "Time", unit: "min", measurementIds: ["time_1", "time_2"] },
      y: { label: "Conversion", unit: "%", measurementIds: ["conv_1", "conv_2"] },
    }, genericImports());

    expect(preview.traces).toHaveLength(1);
    expect(preview.traces[0].x).toEqual([0, 10]);
    expect(preview.traces[0].y).toEqual([0, 25]);
    expect(preview.layout.title.text).toBe("Conversion vs Time");
    expect(preview.layout.xaxis.title).toBe("Time (min)");
  });
});
