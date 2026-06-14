import { describe, expect, it } from "vitest";
import { buildProjectRecord, normalizeProjectDataset, normalizeProjectRecord } from "./projectStorage.js";

function hdpeExperiment() {
  return {
    label: "Exp1",
    date: "2026-06-08",
    conversion_pct: 25,
    selectivity_liquid_pct: 70,
  };
}

function genericImport() {
  return {
    importId: "import_1",
    schemaVersion: "labrat.genericImport.v1",
    experiments: [{ experimentId: "generic_exp_1" }],
    measurements: [{ measurementId: "measurement_1" }],
    sources: [{ sourceRef: "src_1" }],
  };
}

function mappingSet() {
  return {
    mappingSetId: "mapping_set_1",
    schemaVersion: "labrat.semanticMappingSet.v1",
    mappings: [{ mappingId: "mapping_1" }],
  };
}

function chartProposalSet() {
  return {
    proposalSetId: "chart_set_1",
    schemaVersion: "labrat.chartProposalSet.v1",
    proposals: [{ proposalId: "chart_1" }],
  };
}

describe("project generic import dataset shape", () => {
  it("normalizes genericImports as a dataset sibling without changing HDPE experiments", () => {
    const dataset = normalizeProjectDataset({
      experiments: [hdpeExperiment()],
      genericImports: [genericImport()],
      genericMappingSets: [mappingSet()],
      genericChartProposals: [chartProposalSet()],
    });

    expect(dataset.experiments).toEqual([hdpeExperiment()]);
    expect(dataset.genericImports).toEqual([genericImport()]);
    expect(dataset.genericMappingSets).toEqual([mappingSet()]);
    expect(dataset.genericChartProposals).toEqual([chartProposalSet()]);
    expect(dataset.sources).toEqual([]);
    expect(dataset.files).toEqual([]);
    expect(dataset.warnings).toEqual([]);
    expect(dataset.experiments[0].conversion_pct).toBe(25);
  });

  it("buildProjectRecord preserves generic imports for save/export records", () => {
    const record = buildProjectRecord({
      dataset: {
        experiments: [hdpeExperiment()],
        genericImports: [genericImport()],
        genericMappingSets: [mappingSet()],
        genericChartProposals: [chartProposalSet()],
      },
      blocks: [],
      pages: [],
    });

    expect(record.dataset.experiments).toHaveLength(1);
    expect(record.dataset.genericImports).toEqual([genericImport()]);
    expect(record.dataset.genericMappingSets).toEqual([mappingSet()]);
    expect(record.dataset.genericChartProposals).toEqual([chartProposalSet()]);
    expect(record.dataset.experiments[0].selectivity_liquid_pct).toBe(70);
  });

  it("normalizeProjectRecord preserves generic imports from imported project files", () => {
    const record = normalizeProjectRecord({
      dataset: {
        experiments: [hdpeExperiment()],
        genericImports: [genericImport()],
        genericMappingSets: [mappingSet()],
        genericChartProposals: [chartProposalSet()],
      },
      blocks: [],
      pages: [],
    });

    expect(record.dataset.experiments).toEqual([hdpeExperiment()]);
    expect(record.dataset.genericImports).toEqual([genericImport()]);
    expect(record.dataset.genericMappingSets).toEqual([mappingSet()]);
    expect(record.dataset.genericChartProposals).toEqual([chartProposalSet()]);
  });

  it("adds an empty genericImports array for legacy datasets", () => {
    const dataset = normalizeProjectDataset({ experiments: [hdpeExperiment()] });

    expect(dataset.genericImports).toEqual([]);
    expect(dataset.genericMappingSets).toEqual([]);
    expect(dataset.genericChartProposals).toEqual([]);
    expect(dataset.sources).toEqual([]);
    expect(dataset.files).toEqual([]);
    expect(dataset.warnings).toEqual([]);
    expect(dataset.experiments).toHaveLength(1);
  });

  it("normalizes wrapped exported project files with generic imports", () => {
    const record = normalizeProjectRecord({
      project: {
        dataset: {
          experiments: [hdpeExperiment()],
          genericImports: [genericImport()],
          genericMappingSets: [mappingSet()],
          genericChartProposals: [chartProposalSet()],
        },
        sourceName: "exported project",
      },
    });

    expect(record.sourceName).toBe("exported project");
    expect(record.dataset.genericImports).toEqual([genericImport()]);
    expect(record.dataset.genericMappingSets).toEqual([mappingSet()]);
    expect(record.dataset.genericChartProposals).toEqual([chartProposalSet()]);
    expect(record.dataset.experiments[0].label).toBe("Exp1");
  });

  it("treats malformed generic proposal siblings as legacy-compatible empty arrays", () => {
    const record = normalizeProjectRecord({
      dataset: {
        experiments: [hdpeExperiment()],
        genericImports: { importId: "not_an_array" },
        genericMappingSets: { mappingSetId: "not_an_array" },
        genericChartProposals: { proposalSetId: "not_an_array" },
      },
    });

    expect(record.dataset.genericImports).toEqual([]);
    expect(record.dataset.genericMappingSets).toEqual([]);
    expect(record.dataset.genericChartProposals).toEqual([]);
    expect(record.dataset.experiments).toHaveLength(1);
  });
});
