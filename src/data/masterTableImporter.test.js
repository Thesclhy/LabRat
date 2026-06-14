import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildDatasetFromExcelFiles } from "./masterTableImporter.js";

function workbookFile(name, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function simpleFile(name) {
  return new File(["placeholder"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("buildDatasetFromExcelFiles", () => {
  it("keeps the existing MasterTable.xlsx importer behavior working", async () => {
    const master = workbookFile("MasterTable.xlsx", [
      ["LabRat master table"],
      ["Generated test header row"],
      [
        "Exp56",
        "2025-05-01",
        "Ru/TiO2",
        0.2,
        "HDPE",
        22.1,
        250,
        60,
        16,
        500,
        "flat",
        90,
        5,
        1,
        10,
        96,
        30,
        12,
        0.05,
        0.01,
        0.2,
        0.003,
        0.06,
        120,
        "stable importer test",
      ],
    ]);

    const dataset = await buildDatasetFromExcelFiles([
      master,
      simpleFile("Calculation Exp56.xlsx"),
      simpleFile("Sweep Exp56.xlsx"),
      simpleFile("Exp56_ParrData.xlsx"),
      simpleFile("Calculation Exp99.xlsx"),
    ], {
      XLSX,
      mode: "test",
      generatedAt: "2026-06-08T00:00:00.000Z",
      includeLocalFiles: true,
    });

    expect(dataset.metadata.n_experiments).toBe(1);
    expect(dataset.local_files).toHaveLength(5);
    const [experiment] = dataset.experiments;
    expect(experiment.label).toBe("Exp56");
    expect(experiment.catalyst_type).toBe("Ru/TiO2");
    expect(experiment.temperature_C).toBe(250);
    expect(experiment.conversion_pct).toBe(10);
    expect(experiment.files.calculation).toBe("Calculation Exp56.xlsx");
    expect(experiment.files.sweep).toBe("Sweep Exp56.xlsx");
    expect(experiment.files.parr_data).toBe("Exp56_ParrData.xlsx");
    expect(experiment.calculation).toBe(null);
    expect(experiment.sweep).toBe(null);
    expect(experiment.parr_data).toBe(null);
    expect(experiment.sources[0]).toMatchObject({
      file: "MasterTable.xlsx",
      sheet: "Sheet1",
      row: 3,
      kind: "registry",
    });
  });

  it("still rejects folders without a master table workbook", async () => {
    await expect(buildDatasetFromExcelFiles([simpleFile("Calculation Exp1.xlsx")], { XLSX }))
      .rejects.toThrow(/No MasterTable\.xlsx/);
  });
});
