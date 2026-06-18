import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyColumnOrder, getColumnOrder, getColumnPrefs, hideColumn, moveKeyRelative, renameColumn, setColumnOrder, setColumnWidth, showColumn } from "./experimentColumnPrefs.js";

const PROJECT = "proj-1";
const COL = "selectivity_solid_pct";

describe("experimentColumnPrefs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("starts with no prefs", () => {
    expect(getColumnPrefs(PROJECT)).toEqual({});
  });

  it("hides and shows a column", () => {
    hideColumn(PROJECT, COL);
    expect(getColumnPrefs(PROJECT)[COL]).toEqual({ hidden: true });
    showColumn(PROJECT, COL);
    expect(getColumnPrefs(PROJECT)[COL]).toBeUndefined();
  });

  it("renames a column and keeps a concurrent hidden flag", () => {
    hideColumn(PROJECT, COL);
    renameColumn(PROJECT, COL, "Sel S%");
    expect(getColumnPrefs(PROJECT)[COL]).toEqual({ hidden: true, label: "Sel S%" });
  });

  it("trims a rename and reverts to default when blank", () => {
    renameColumn(PROJECT, COL, "  Sel S%  ");
    expect(getColumnPrefs(PROJECT)[COL]).toEqual({ label: "Sel S%" });
    renameColumn(PROJECT, COL, "   ");
    expect(getColumnPrefs(PROJECT)[COL]).toBeUndefined();
  });

  it("sets and clears a column width, keeping other prefs", () => {
    renameColumn(PROJECT, COL, "Sel S%");
    setColumnWidth(PROJECT, COL, 120.6);
    expect(getColumnPrefs(PROJECT)[COL]).toEqual({ label: "Sel S%", width: 121 });
    setColumnWidth(PROJECT, COL, 0);
    expect(getColumnPrefs(PROJECT)[COL]).toEqual({ label: "Sel S%" });
    setColumnWidth(PROJECT, COL, null);
    expect(getColumnPrefs(PROJECT)[COL]).toEqual({ label: "Sel S%" });
  });

  it("scopes prefs per project", () => {
    hideColumn(PROJECT, COL);
    expect(getColumnPrefs("proj-2")).toEqual({});
  });

  it("falls back to a local scope when no projectId is given", () => {
    renameColumn(null, COL, "Short");
    expect(getColumnPrefs(null)[COL]).toEqual({ label: "Short" });
  });

  it("persists and scopes column order", () => {
    setColumnOrder(PROJECT, ["b", "a", "c"]);
    expect(getColumnOrder(PROJECT)).toEqual(["b", "a", "c"]);
    expect(getColumnOrder("proj-2")).toEqual([]);
  });

  it("moveKeyRelative places a key before/after a target", () => {
    expect(moveKeyRelative(["a", "b", "c", "d"], "d", "b", true)).toEqual(["a", "d", "b", "c"]);
    expect(moveKeyRelative(["a", "b", "c", "d"], "a", "c", false)).toEqual(["b", "c", "a", "d"]);
    expect(moveKeyRelative(["a", "b"], "a", "a", true)).toEqual(["a", "b"]);
    expect(moveKeyRelative(["a", "b"], "x", "a", true)).toEqual(["a", "b"]);
  });

  it("applyColumnOrder reorders known keys and appends unknown ones in base order", () => {
    const cols = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(applyColumnOrder(cols, ["c", "a"]).map((c) => c.key)).toEqual(["c", "a", "b"]);
    expect(applyColumnOrder(cols, []).map((c) => c.key)).toEqual(["a", "b", "c"]);
  });
});
