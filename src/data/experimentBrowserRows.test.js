import { describe, expect, it } from "vitest";
import { buildGenericBrowserRows, getGenericExperimentDetail } from "./experimentBrowserRows.js";

function datasetFixture() {
  return {
    experiments: [{ label: "Exp1", conversion_pct: 20 }],
    genericImports: [{
      importId: "import_1",
      fileName: "runs.xlsx",
      confidence: 0.7,
      experiments: [{
        experimentId: "generic_exp_1",
        name: "Run A",
        sourceBlockId: "block_1",
        sourceRef: "src_exp",
        confidence: 0.86,
        metadata: [{
          metadataId: "meta_temp",
          field: "temperature",
          displayName: "Temperature",
          value: 80,
          rawValue: "80 C",
          unit: "C",
          sourceRef: "src_temp",
          confidence: 0.9,
          warnings: [],
        }],
        warnings: [],
      }],
      measurements: [
        {
          measurementId: "m_time",
          experimentId: "generic_exp_1",
          field: "time",
          displayName: "Time",
          value: 10,
          rawValue: "10",
          unit: "min",
          rowIndex: 2,
          sourceRef: "src_time",
          confidence: 0.9,
          warnings: [],
        },
        {
          measurementId: "m_conv",
          experimentId: "generic_exp_1",
          field: "conversion",
          displayName: "Conversion",
          value: 25,
          rawValue: "25",
          unit: "%",
          rowIndex: 2,
          sourceRef: "src_conv",
          confidence: 0.86,
          warnings: [{ code: "unit_review", message: "Check unit." }],
        },
      ],
      sources: [
        { sourceRef: "src_exp", fileName: "runs.xlsx", sheet: "Runs", range: "A1:C3" },
        { sourceRef: "src_temp", fileName: "runs.xlsx", sheet: "Runs", cell: "B1", range: "B1" },
        { sourceRef: "src_time", fileName: "runs.xlsx", sheet: "Runs", cell: "A2", range: "A2" },
        { sourceRef: "src_conv", fileName: "runs.xlsx", sheet: "Runs", cell: "C2", range: "C2" },
      ],
      warnings: [],
    }],
    genericMappingSets: [{
      mappingSetId: "mapping_set_1",
      mappings: [
        {
          mappingId: "mapping_time",
          status: "accepted",
          targetKind: "measurement",
          sourceIds: ["m_time"],
          rawLabel: "Time",
          canonicalField: "time",
          semanticRole: "time",
          unit: "min",
        },
        {
          mappingId: "mapping_conv",
          status: "accepted_draft",
          targetKind: "measurement",
          sourceIds: ["m_conv"],
          rawLabel: "Conversion",
          canonicalField: "conversion",
          semanticRole: "response",
          unit: "%",
        },
        {
          mappingId: "mapping_pressure",
          status: "accepted",
          targetKind: "metadata",
          sourceIds: ["missing_pressure"],
          rawLabel: "Pressure",
          canonicalField: "pressure",
          semanticRole: "condition",
          unit: "bar",
        },
        {
          mappingId: "mapping_rejected",
          status: "rejected",
          targetKind: "metadata",
          sourceIds: ["meta_temp"],
          rawLabel: "Temperature",
          canonicalField: "temperature",
          semanticRole: "condition",
          unit: "C",
        },
      ],
    }],
  };
}

describe("experiment browser generic rows", () => {
  it("derives source-backed generic rows without touching HDPE experiments", () => {
    const dataset = datasetFixture();
    const rows = buildGenericBrowserRows(dataset);

    expect(dataset.experiments[0].conversion_pct).toBe(20);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowId: "generic:import_1:generic_exp_1",
      kind: "generic",
      label: "Run A",
      sourceFile: "runs.xlsx",
      sourceRange: "Runs A1:C3",
      importId: "import_1",
      experimentId: "generic_exp_1",
      sourceBlockId: "block_1",
      measurementCount: 2,
      metadataCount: 1,
      warningCount: 1,
      confidence: 0.86,
      mappingStatus: "1 mapped",
    });
    expect(rows[0].sourceRefs).toEqual(["src_exp", "src_temp", "src_time", "src_conv"]);
    expect(rows[0].mappedFields.map((field) => field.key)).toEqual(["time"]);
    expect(rows[0].acceptedMappingColumns.map((column) => column.key)).toEqual(["time", "pressure"]);
    expect(rows[0].acceptedMappingValues.time.value).toBe("10 min");
    expect(rows[0].acceptedMappingValues.pressure.value).toBe("");
    expect(rows[0].acceptedMappingValues.pressure.count).toBe(0);
  });

  it("returns generic detail with resolved sources and mapping overlays", () => {
    const dataset = datasetFixture();
    const [row] = buildGenericBrowserRows(dataset);
    const detail = getGenericExperimentDetail(dataset, row);

    expect(detail.experiment.name).toBe("Run A");
    expect(detail.measurements).toHaveLength(2);
    expect(detail.metadata).toHaveLength(1);
    expect(detail.sources.map((source) => source.sourceRef)).toEqual(["src_exp", "src_temp", "src_time", "src_conv"]);
    expect(detail.warnings[0].code).toBe("unit_review");
    expect(detail.mappedFields.map((field) => field.key)).toEqual(["time"]);
  });

  it("formats accepted date mappings from Excel serial values", () => {
    const dataset = datasetFixture();
    dataset.genericImports[0].fields = [{
      fieldValueId: "field_date",
      experimentId: "generic_exp_1",
      field: "date",
      displayName: "Date",
      value: 45733,
      rawValue: "45733",
      formattedValue: "3/17/2025",
      role: "metadata",
      sourceRef: "src_date",
      confidence: 0.9,
      warnings: [],
    }];
    dataset.genericImports[0].sources.push({ sourceRef: "src_date", fileName: "runs.xlsx", sheet: "Runs", cell: "B2", range: "B2" });
    dataset.genericMappingSets[0].mappings.push({
      mappingId: "mapping_date",
      status: "accepted",
      targetKind: "metadata",
      sourceIds: ["field_date"],
      rawLabel: "Date",
      canonicalField: "date",
      semanticRole: "metadata",
    });

    const [row] = buildGenericBrowserRows(dataset);

    expect(row.acceptedMappingValues.date.value).toBe("2025-03-17");
  });

  it("does not derive browser rows from supplemental imports", () => {
    const dataset = datasetFixture();
    dataset.genericImports.push({
      importId: "import_supplement",
      fileName: "Reaction_Rate_Exp30.xlsx",
      relationship: {
        relationship: "supplement",
        targetExperimentIds: ["generic_exp_1"],
      },
      experiments: [{ experimentId: "generic_exp_rate", label: "Reaction Rate Detail" }],
      fields: [{ fieldValueId: "rate_1", experimentId: "generic_exp_rate", displayName: "Reaction Rate", role: "measurement" }],
      sources: [],
      warnings: [],
    });

    const rows = buildGenericBrowserRows(dataset);

    expect(rows).toHaveLength(1);
    expect(rows[0].importId).toBe("import_1");
  });
});
