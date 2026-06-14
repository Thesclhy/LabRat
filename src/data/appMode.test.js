import { describe, expect, it } from "vitest";
import { blankTemplateLinks, isBlankDataModeValue, normalizeDataMode } from "./appMode.js";

describe("app mode helpers", () => {
  it("defaults unknown data modes to demo", () => {
    expect(normalizeDataMode(undefined)).toBe("demo");
    expect(normalizeDataMode("demo")).toBe("demo");
    expect(normalizeDataMode("research")).toBe("demo");
  });

  it("recognizes blank data mode explicitly", () => {
    expect(normalizeDataMode("blank")).toBe("blank");
    expect(isBlankDataModeValue("blank")).toBe(true);
    expect(isBlankDataModeValue("demo")).toBe(false);
  });

  it("builds example-only template links under the Vite base path", () => {
    expect(blankTemplateLinks("/LabRat/")).toEqual([
      {
        label: "Standard table template",
        href: "/LabRat/templates/generic-import-template.xlsx",
        note: "Example only - not imported automatically",
      },
      {
        label: "Repeated block table template",
        href: "/LabRat/templates/block-import-template.xlsx",
        note: "Example only - not imported automatically",
      },
    ]);
  });
});
