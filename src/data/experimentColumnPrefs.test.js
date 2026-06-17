import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getColumnPrefs, hideColumn, renameColumn, setColumnWidth, showColumn } from "./experimentColumnPrefs.js";

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
});
