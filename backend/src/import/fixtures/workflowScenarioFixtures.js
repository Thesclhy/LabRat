export const chartLocalAcceptedSourceExtractScenario = {
  scenarioId: "scenario_chart_local_source_extract",
  description: "Accepted source extract feeds a source-backed chart proposal.",
  sourceExtractProposal: {
    id: "source_extract_proposal_synthetic_chart_local",
    status: "accepted",
    extractType: "component_distribution",
    purpose: "chart_source",
    preview: {
      range: { sheetName: "Carbon Balance", range: "P31:BA32" },
      rows: [
        { rowId: "component_1", values: { carbon_number: 1, percentage: 5 }, sourceRefs: [{ sourceType: "excel_cell", sheet: "Carbon Balance", cell: "Q32" }] },
        { rowId: "component_2", values: { carbon_number: 2, percentage: 12.5 }, sourceRefs: [{ sourceType: "excel_cell", sheet: "Carbon Balance", cell: "R32" }] },
      ],
    },
  },
  expectedNext: {
    reviewKind: "data_plan_review",
    dataPlanInputType: "accepted_source_extract",
  },
};

export const missingExperimentPromptScenario = {
  scenarioId: "scenario_missing_experiment_prompt",
  prompt: "draw reaction rate chart for experiment 999",
  expected: {
    kind: "clarification",
    code: "experiment_not_found",
    mustNotUseExperimentAliases: ["Exp33", "Exp34", "Exp35"],
    mustNotCreate: ["chartProposalSet", "chartSpec", "dataSnapshot"],
  },
};

export const importCorrectionExamples = [
  {
    message: "Sheet1 P31:BA32 is carbon number distribution for Exp33",
    expectedPatchType: "region_semantic_type",
    expectedTarget: { sheetName: "Sheet1", range: "P31:BA32" },
  },
  {
    message: "third row is the header",
    expectedPatchType: "header_row",
    expectedOperation: { rowNumber: 3 },
  },
  {
    message: "calculation33 belongs to Exp33",
    expectedPatchType: "experiment_binding",
    expectedOperation: { workbookHint: "calculation33", experimentAlias: "Exp33" },
  },
  {
    message: "ignore the LDPE TEMPLATE sheet",
    expectedPatchType: "ignore_region",
    expectedTarget: { sheetName: "LDPE TEMPLATE" },
  },
];

export const syntheticWorkflowScenarios = [
  chartLocalAcceptedSourceExtractScenario,
  missingExperimentPromptScenario,
  ...importCorrectionExamples.map((example, index) => ({
    scenarioId: `scenario_import_correction_${index + 1}`,
    ...example,
  })),
];
