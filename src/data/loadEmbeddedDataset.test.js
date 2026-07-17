import { describe, expect, it } from "vitest";
import { emptyDataset } from "./loadEmbeddedDataset.js";

describe("emptyDataset", () => {
  it("returns a stable blank compatibility shape without persisted scientific rows", () => {
    expect(emptyDataset()).toMatchObject({
      experiments: [],
      sources: [],
      files: [],
      warnings: [],
    });
  });

  it("uses neutral metadata and fresh arrays", () => {
    const first = emptyDataset();
    const second = emptyDataset();

    first.experiments.push({ label: "should-not-leak" });

    expect(second.experiments).toEqual([]);
    expect(second.metadata.study).toBe("Blank LabRat project");
    expect(second.metadata.lab).toBe("User workspace");
  });
});
