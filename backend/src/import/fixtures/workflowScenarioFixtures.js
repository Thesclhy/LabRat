export const confirmedRegionAnalysisScenario = {
  scenarioId: "scenario_confirmed_region_analysis",
  description: "A confirmed region feeds one reviewed analysis plan.",
  regionUnderstandingRevision: {
    id: "region_understanding_revision_synthetic_chart",
    status: "accepted",
    semanticType: "component_distribution",
    range: { sheetName: "Carbon Balance", range: "P31:BA32" },
  },
  expectedNext: {
    reviewKind: "analysis_plan_review",
    selectionInputType: "confirmed_region",
  },
};

export const missingExperimentPromptScenario = {
  scenarioId: "scenario_missing_experiment_prompt",
  prompt: "draw reaction rate chart for experiment 999",
  expected: {
    kind: "clarification",
    code: "experiment_not_found",
    mustNotUseExperimentAliases: ["Exp33", "Exp34", "Exp35"],
    mustNotCreate: ["chartSpec", "dataSnapshot"],
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
  confirmedRegionAnalysisScenario,
  missingExperimentPromptScenario,
  ...importCorrectionExamples.map((example, index) => ({
    scenarioId: `scenario_import_correction_${index + 1}`,
    ...example,
  })),
];
