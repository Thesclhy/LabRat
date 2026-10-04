import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import {
  buildExperimentBrowserWorkbook,
  experimentBrowserExportFileName,
  loadAllExperimentBrowserRows,
} from "./experimentBrowserExport.js";

const columns = [
  { id: "experiment", label: "Experiment", valueType: "string" },
  { id: "field:temperature:degC:number", label: "Temperature (degC)", valueType: "number", unit: "degC" },
  { id: "field:pressure:bar:number", label: "Pressure", valueType: "number", unit: "bar" },
  { id: "linked:rate", label: "Rate", valueType: "string", isLinkedData: true },
  { id: "custom:custom_1", label: "Notes", valueType: "string", isCustom: true },
];

const rows = [
  {
    experimentId: "exp_1",
    label: "Exp 1",
    cells: {
      "field:temperature:degC:number": { value: 250.25, formattedValue: "250.3" },
      "field:pressure:bar:number": { value: 30, formattedValue: "30" },
      "linked:rate": { value: "Run.xlsx · Rates!F2:G72", formattedValue: "Run.xlsx · Rates!F2:G72", isLinkedData: true },
      "custom:custom_1": { value: "repeat", formattedValue: "repeat", isCustom: true },
    },
  },
  {
    experimentId: "exp_2",
    label: "Exp 2",
    cells: {
      "field:temperature:degC:number": { value: "n/a", formattedValue: "n/a" },
      "linked:rate": null,
      "custom:custom_1": { value: "", formattedValue: "", isCustom: true },
    },
  },
];

function sheetOf(workbook) {
  return workbook.Sheets[workbook.SheetNames[0]];
}

describe("experiment browser Excel export", () => {
  it("writes the visible columns in order, with numbers as numbers and units in the header", () => {
    const workbook = buildExperimentBrowserWorkbook({ columns, rows });
    const sheet = sheetOf(workbook);

    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })).toEqual([
      ["Experiment", "Temperature (degC)", "Pressure (bar)", "Rate", "Notes"],
      ["Exp 1", 250.25, 30, "Run.xlsx · Rates!F2:G72", "repeat"],
      ["Exp 2", "n/a", null, null, null],
    ]);
    expect(sheet.B2.t).toBe("n");
    expect(sheet["!autofilter"].ref).toBe("A1:E3");
  });

  it("round-trips through an .xlsx file", () => {
    const bytes = XLSX.write(buildExperimentBrowserWorkbook({ columns, rows }), { type: "array", bookType: "xlsx" });
    const reread = XLSX.read(bytes, { type: "array" });
    expect(reread.SheetNames).toEqual(["Experiments"]);
    expect(sheetOf(reread).C2.v).toBe(30);
  });

  it("loads every page of the current query", async () => {
    const loadProjection = vi.fn()
      .mockResolvedValueOnce({ rows: [rows[0]], nextCursor: "page_2" })
      .mockResolvedValueOnce({ rows: [rows[1]], nextCursor: null });
    const query = { search: "exp", filters: [], sort: [], starredOnly: true };

    const all = await loadAllExperimentBrowserRows(loadProjection, "project_1", query, { pageLimit: 200 });

    expect(all.map((row) => row.experimentId)).toEqual(["exp_1", "exp_2"]);
    expect(loadProjection).toHaveBeenNthCalledWith(1, "project_1", { ...query, cursor: null, limit: 200 }, { signal: undefined });
    expect(loadProjection).toHaveBeenNthCalledWith(2, "project_1", { ...query, cursor: "page_2", limit: 200 }, { signal: undefined });
  });

  it("names the file by date", () => {
    expect(experimentBrowserExportFileName(new Date(2026, 9, 4))).toBe("experiment-browser-2026-10-04.xlsx");
  });
});
