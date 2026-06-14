import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BLANK_ONBOARDING_STEPS, BlankOnboarding } from "./BlankOnboarding.jsx";

const templateLinks = [
  {
    label: "Standard table template",
    href: "/templates/generic-import-template.xlsx",
    note: "Example only - not imported automatically",
  },
  {
    label: "Repeated block table template",
    href: "/templates/block-import-template.xlsx",
    note: "Example only - not imported automatically",
  },
];

describe("BlankOnboarding", () => {
  it("shows the blank-mode workflow without active example data", () => {
    render(<BlankOnboarding onImportWorkbook={() => {}} templateLinks={templateLinks} />);

    BLANK_ONBOARDING_STEPS.forEach((step) => {
      expect(screen.getByText(step)).toBeTruthy();
    });
    expect(screen.getByText("Example templates only")).toBeTruthy();
    expect(screen.getAllByText("Example only - not imported automatically")).toHaveLength(2);
  });

  it("uses Import Excel workbook as the primary action", () => {
    const onImportWorkbook = vi.fn();
    render(<BlankOnboarding onImportWorkbook={onImportWorkbook} templateLinks={templateLinks} />);

    fireEvent.click(screen.getByRole("button", { name: "Import Excel workbook" }));

    expect(onImportWorkbook).toHaveBeenCalledTimes(1);
  });

  it("links to downloadable template resources", () => {
    render(<BlankOnboarding onImportWorkbook={() => {}} templateLinks={templateLinks} />);

    expect(screen.getByText("Standard table template").closest("a")?.getAttribute("href")).toBe("/templates/generic-import-template.xlsx");
    expect(screen.getByText("Repeated block table template").closest("a")?.getAttribute("href")).toBe("/templates/block-import-template.xlsx");
  });
});
