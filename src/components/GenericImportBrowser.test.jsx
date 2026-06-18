import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenericImportBrowser } from "./GenericImportBrowser.jsx";

function datasetFixture() {
  return {
    genericImports: [{
      importId: "import_1",
      fileName: "runs.xlsx",
      confidence: 0.82,
      experiments: [{
        experimentId: "exp_generic_1",
        name: "Run A",
        sourceBlockId: "block_1",
        sourceRef: "src_exp",
        confidence: 0.88,
        metadata: [{
          metadataId: "meta_temp",
          displayName: "Temperature",
          value: 80,
          rawValue: "80 C",
          unit: "C",
          sourceRef: "src_temp",
          confidence: 0.91,
          warnings: [],
        }],
        warnings: [],
      }],
      measurements: [{
        measurementId: "m_conv",
        experimentId: "exp_generic_1",
        field: "conversion",
        displayName: "Conversion",
        value: 25,
        rawValue: "25",
        unit: "%",
        rowIndex: 2,
        sourceRef: "src_conv",
        confidence: 0.86,
        warnings: [],
      }],
      sources: [
        { sourceRef: "src_exp", fileName: "runs.xlsx", sheet: "Runs", range: "A1:C3" },
        { sourceRef: "src_temp", fileName: "runs.xlsx", sheet: "Runs", range: "B1" },
        { sourceRef: "src_conv", fileName: "runs.xlsx", sheet: "Runs", range: "C2" },
      ],
      warnings: [],
    }],
    genericMappingSets: [{
      mappingSetId: "mapping_set_1",
      mappings: [{
        mappingId: "mapping_conv",
        status: "accepted",
        sourceIds: ["m_conv"],
        rawLabel: "Conversion",
        canonicalField: "conversion",
        semanticRole: "response",
        unit: "%",
      }, {
        mappingId: "mapping_pressure",
        status: "accepted",
        sourceIds: ["missing_pressure"],
        rawLabel: "Pressure",
        canonicalField: "pressure",
        semanticRole: "condition",
        unit: "bar",
      }, {
        mappingId: "mapping_temp_draft",
        status: "accepted_draft",
        sourceIds: ["meta_temp"],
        rawLabel: "Temperature",
        canonicalField: "temperature",
        semanticRole: "condition",
        unit: "C",
      }],
    }],
  };
}

function datasetWithoutAcceptedMappings() {
  const dataset = datasetFixture();
  dataset.genericMappingSets = [{
    mappingSetId: "mapping_set_1",
    mappings: [{
      mappingId: "mapping_conv_draft",
      status: "accepted_draft",
      sourceIds: ["m_conv"],
      rawLabel: "Conversion",
      canonicalField: "conversion",
      semanticRole: "response",
      unit: "%",
    }],
  }];
  return dataset;
}

describe("GenericImportBrowser", () => {
  it("shows imported generic rows with accepted mapping columns", () => {
    render(<GenericImportBrowser dataset={datasetFixture()} sourceName="project" />);

    expect(screen.getByRole("heading", { name: "Imported experiments" })).toBeTruthy();
    expect(screen.getByText("Run A")).toBeTruthy();
    expect(screen.getByText("runs.xlsx")).toBeTruthy();
    expect(screen.getByText("Runs A1:C3")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /conversion/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /pressure/i })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /temperature/i })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Fields" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Materials" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Conditions" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Measurements" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Warnings" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Confidence" })).toBeNull();
    expect(screen.getByText("25 %")).toBeTruthy();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("formats accepted Date mapping cells instead of showing Excel serial numbers", () => {
    const dataset = datasetFixture();
    dataset.genericImports[0].fields = [{
      fieldValueId: "field_date",
      experimentId: "exp_generic_1",
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
    dataset.genericImports[0].sources.push({ sourceRef: "src_date", fileName: "runs.xlsx", sheet: "Runs", range: "B2" });
    dataset.genericMappingSets[0].mappings.push({
      mappingId: "mapping_date",
      status: "accepted",
      sourceIds: ["field_date"],
      rawLabel: "Date",
      canonicalField: "date",
      semanticRole: "metadata",
    });

    render(<GenericImportBrowser dataset={dataset} sourceName="project" />);

    expect(screen.getByRole("columnheader", { name: /date/i })).toBeTruthy();
    expect(screen.getByText("2025-03-17")).toBeTruthy();
    expect(screen.queryByText("45733")).toBeNull();
  });

  it("shows guidance when no accepted mappings are available", () => {
    render(<GenericImportBrowser dataset={datasetWithoutAcceptedMappings()} sourceName="project" />);

    expect(screen.getByText("Accept semantic mappings to turn reviewed fields into Experiment Browser columns.")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /conversion/i })).toBeNull();
  });

  it("offers a mapping editor entry from the imported browser", () => {
    const onOpenMappingReview = vi.fn();
    render(<GenericImportBrowser dataset={datasetFixture()} sourceName="project" onOpenMappingReview={onOpenMappingReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit mappings" }));

    expect(onOpenMappingReview).toHaveBeenCalledTimes(1);
  });

  it("opens source-backed generic detail from a row", () => {
    render(<GenericImportBrowser dataset={datasetFixture()} sourceName="project" />);

    fireEvent.click(screen.getByText("Run A"));

    expect(screen.getByText("Run A - Imported record")).toBeTruthy();
    expect(screen.getAllByText("Measurements").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Metadata").length).toBeGreaterThan(0);
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getAllByText("Conversion").length).toBeGreaterThan(0);
    expect(screen.getByText("src_conv")).toBeTruthy();
    expect(screen.getAllByText("runs.xlsx - Runs - C2").length).toBeGreaterThan(0);
  });

  it("offers import review when no generic rows exist", () => {
    const onOpenImportReview = vi.fn();
    render(<GenericImportBrowser dataset={{ genericImports: [] }} sourceName="project" onOpenImportReview={onOpenImportReview} />);

    fireEvent.click(screen.getByText("Import workbook"));

    expect(screen.getByText("No imported generic data")).toBeTruthy();
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);
  });
});
