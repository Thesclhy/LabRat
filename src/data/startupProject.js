import { buildProjectRecord, normalizeProjectRecord } from "../storage/projectStorage.js";
import { BLANK_PROJECT_SOURCE_NAME } from "./appMode.js";
import { emptyDataset, loadEmbeddedDataset } from "./loadEmbeddedDataset.js";

export async function resolveStartupProject({
  existingProject = null,
  blankMode = false,
  legacyDataset,
  sourceName,
  staged,
  blocks,
  pages,
  canvasHeight,
  pageOrientationPreference,
  chartTemplates,
  references,
  loadEmbedded = loadEmbeddedDataset,
} = {}) {
  if (existingProject) {
    return normalizeProjectRecord(existingProject, emptyDataset());
  }

  if (blankMode) {
    return buildProjectRecord({
      dataset: emptyDataset(),
      sourceName: BLANK_PROJECT_SOURCE_NAME,
      staged: [],
      blocks: [],
      pages: [],
      canvasHeight: 0,
      pageOrientationPreference: null,
      chartTemplates: [],
      references: [],
    });
  }

  const embeddedDataset = await loadEmbedded();
  const fallbackDataset = Array.isArray(legacyDataset?.experiments) && legacyDataset.experiments.length
    ? legacyDataset
    : embeddedDataset;
  return buildProjectRecord({
    dataset: fallbackDataset,
    sourceName,
    staged,
    blocks,
    pages,
    canvasHeight,
    pageOrientationPreference,
    chartTemplates,
    references,
  });
}
