import { describe, expect, it } from "vitest";
import { cellSortValue, compareAscending, leadingNumber, sortRows } from "./experimentSort.js";

describe("experimentSort", () => {
  it("extracts the right value per column kind", () => {
    const row = { label: "Exp1", sourceFile: "master.xlsx", acceptedMappingValues: { conv: { value: "92.8" } } };
    expect(cellSortValue(row, { kind: "label" })).toBe("Exp1");
    expect(cellSortValue(row, { kind: "source" })).toBe("master.xlsx");
    expect(cellSortValue(row, { kind: "mapping", key: "conv" })).toBe("92.8");
    expect(cellSortValue(row, { kind: "mapping", key: "missing" })).toBe("");
  });

  it("parses a leading number, ignoring trailing units", () => {
    expect(leadingNumber("0.2 g")).toBe(0.2);
    expect(leadingNumber("45733")).toBe(45733);
    expect(leadingNumber("3 hrs")).toBe(3);
    expect(leadingNumber("Ru/TiO2")).toBeNaN();
  });

  it("compares numbers numerically and text naturally", () => {
    expect(compareAscending("92.8", "100")).toBeLessThan(0);
    expect(compareAscending("0.9", "0.10")).toBeGreaterThan(0); // 0.9 > 0.10 numerically
    expect(compareAscending("apple", "banana")).toBeLessThan(0);
    expect(compareAscending("5 g", "Ru")).toBeLessThan(0); // numbers before text
  });

  it("sorts ascending and descending by a mapping column", () => {
    const rows = [
      { rowId: "a", acceptedMappingValues: { c: { value: "8" } } },
      { rowId: "b", acceptedMappingValues: { c: { value: "7.2" } } },
      { rowId: "c", acceptedMappingValues: { c: { value: "5.4" } } },
    ];
    const col = { kind: "mapping", key: "c" };
    expect(sortRows(rows, col, "asc").map((r) => r.rowId)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, col, "desc").map((r) => r.rowId)).toEqual(["a", "b", "c"]);
  });

  it("sorts experiment labels naturally (Exp2 before Exp10)", () => {
    const rows = [{ label: "Exp10" }, { label: "Exp2" }, { label: "Exp1" }].map((r, i) => ({ ...r, rowId: i }));
    expect(sortRows(rows, { kind: "label" }, "asc").map((r) => r.label)).toEqual(["Exp1", "Exp2", "Exp10"]);
  });

  it("always sinks blanks to the bottom regardless of direction", () => {
    const col = { kind: "mapping", key: "c" };
    const rows = [
      { rowId: "x", acceptedMappingValues: { c: { value: "5" } } },
      { rowId: "blank", acceptedMappingValues: { c: { value: "" } } },
      { rowId: "dash", acceptedMappingValues: { c: { value: "-" } } },
      { rowId: "y", acceptedMappingValues: { c: { value: "9" } } },
    ];
    expect(sortRows(rows, col, "asc").map((r) => r.rowId)).toEqual(["x", "y", "blank", "dash"]);
    expect(sortRows(rows, col, "desc").map((r) => r.rowId)).toEqual(["y", "x", "blank", "dash"]);
  });
});
