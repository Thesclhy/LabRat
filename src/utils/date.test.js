import { describe, expect, it } from "vitest";
import {
  experimentDateSortValue,
  formatExperimentDateForDisplay,
  normalizeDatasetDates,
  normalizeExperimentDate,
} from "./date.js";

describe("date normalization", () => {
  it("keeps ISO date strings unchanged", () => {
    expect(normalizeExperimentDate("2025-04-28")).toBe("2025-04-28");
  });

  it("normalizes month/day/year strings to ISO dates", () => {
    expect(normalizeExperimentDate("4/15/2025")).toBe("2025-04-15");
  });

  it("normalizes date ranges to ISO-style range strings", () => {
    expect(normalizeExperimentDate("4/10/2025-4/11/2025")).toBe("2025-04-10 to 2025-04-11");
  });

  it("normalizes date ranges where the start date omits the year", () => {
    expect(normalizeExperimentDate("3/10-3/11/2026")).toBe("2026-03-10 to 2026-03-11");
  });

  it("formats experiment dates for display with a stable fallback", () => {
    expect(formatExperimentDateForDisplay("3/10-3/11/2026")).toBe("2026-03-10 to 2026-03-11");
    expect(formatExperimentDateForDisplay(null)).toBe("-");
  });

  it("uses the first date in a range for sorting", () => {
    expect(experimentDateSortValue("2025-04-10 to 2025-04-11")).toBeLessThan(experimentDateSortValue("2025-04-12"));
  });

  it("normalizes experiment dates in datasets without touching unrelated fields", () => {
    const dataset = {
      metadata: { n_experiments: 1 },
      experiments: [{ label: "Exp8", date: "4/10/2025-4/11/2025", comments: "kept" }],
    };
    const normalized = normalizeDatasetDates(dataset);
    expect(normalized.experiments[0]).toMatchObject({
      label: "Exp8",
      date: "2025-04-10 to 2025-04-11",
      comments: "kept",
    });
  });
});
