const EMPTY_DATASET = {
  metadata: {
    generated_at: null,
    lab: "User workspace",
    study: "Blank LabRat project",
    calc_version: "blank",
    n_experiments: 0,
    schema_version: 1,
  },
  experiments: [],
  sources: [],
  files: [],
  genericImports: [],
  genericMappingSets: [],
  genericChartProposals: [],
  warnings: [],
};

export function emptyDataset() {
  return JSON.parse(JSON.stringify(EMPTY_DATASET));
}

export async function loadEmbeddedDataset() {
  return emptyDataset();
}