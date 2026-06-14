import { describe, expect, it } from "vitest";
import { applyGenericImportPatch } from "./genericImportPatch.js";

describe("applyGenericImportPatch", () => {
  it("appends generic imports without changing HDPE experiments", () => {
    const dataset = {
      experiments: [{ label: "Exp1", conversion_pct: 25 }],
      sources: [{ kind: "master_table" }],
    };
    const next = applyGenericImportPatch(dataset, {
      genericImports: [{ importId: "import_1", measurements: [{ measurementId: "m1" }] }],
    });

    expect(next.experiments).toBe(dataset.experiments);
    expect(next.sources).toBe(dataset.sources);
    expect(next.genericImports).toEqual([{ importId: "import_1", measurements: [{ measurementId: "m1" }] }]);
  });

  it("preserves existing generic imports and skips duplicate import ids", () => {
    const dataset = {
      experiments: [],
      genericImports: [{ importId: "import_1" }],
    };
    const next = applyGenericImportPatch(dataset, {
      genericImports: [{ importId: "import_1" }, { importId: "import_2" }],
    });

    expect(next.genericImports).toEqual([{ importId: "import_1" }, { importId: "import_2" }]);
  });

  it("normalizes missing dataset arrays safely", () => {
    const next = applyGenericImportPatch(null, { genericImports: [] });

    expect(next).toEqual({ experiments: [], genericImports: [] });
  });
});
