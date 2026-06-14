const DB_NAME = "labrat_blank_project_store";
const DB_VERSION = 1;
const STORE_NAME = "projects";
const ACTIVE_PROJECT_ID = "active";
export const PROJECT_SCHEMA_VERSION = 1;
export const MANUSCRIPT_PAGE_WIDTH = 1600;
export const MANUSCRIPT_PAGE_HEIGHT = 900;
export const PORTRAIT_MANUSCRIPT_PAGE_WIDTH = 900;
export const PORTRAIT_MANUSCRIPT_PAGE_HEIGHT = 1600;
export const LEGACY_MANUSCRIPT_PAGE_WIDTH = 1100;
export const LEGACY_MANUSCRIPT_PAGE_HEIGHT = 1600;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
  });
}

function withStore(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let actionResult;
    transaction.oncomplete = () => {
      db.close();
      resolve(actionResult);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("IndexedDB transaction failed."));
    };
    actionResult = action(store);
  }));
}

export function buildProjectRecord(state) {
  const pages = normalizePages(state.pages, state.canvasHeight, state.blocks);
  const canvasHeight = canvasHeightForProject(pages, state.canvasHeight, state.blocks, state.pages);
  const dataset = normalizeProjectDataset(state.dataset);
  return {
    id: ACTIVE_PROJECT_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    dataset,
    sourceName: state.sourceName || "embedded LabRat dataset",
    staged: Array.isArray(state.staged) ? state.staged : [],
    blocks: Array.isArray(state.blocks) ? state.blocks : [],
    pages,
    canvasHeight,
    pageOrientationPreference: normalizePageOrientationPreference(state.pageOrientationPreference, pages),
    chartTemplates: Array.isArray(state.chartTemplates) ? state.chartTemplates : [],
    references: Array.isArray(state.references) ? state.references : [],
  };
}

export function normalizeProjectDataset(dataset) {
  const base = dataset && typeof dataset === "object" ? dataset : { experiments: [] };
  const dated = normalizeDatasetDates(base) || base;
  return {
    ...dated,
    experiments: Array.isArray(dated.experiments) ? dated.experiments : [],
    sources: Array.isArray(dated.sources) ? dated.sources : [],
    files: Array.isArray(dated.files) ? dated.files : [],
    genericImports: Array.isArray(dated.genericImports) ? dated.genericImports : [],
    genericMappingSets: Array.isArray(dated.genericMappingSets) ? dated.genericMappingSets : [],
    genericChartProposals: Array.isArray(dated.genericChartProposals) ? dated.genericChartProposals : [],
    warnings: Array.isArray(dated.warnings) ? dated.warnings : [],
  };
}

export function normalizePages(pages, canvasHeight, blocks = []) {
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  if (!hasBlocks && isBlankLegacyAutoPage(pages)) return [];
  const blockBottom = (Array.isArray(blocks) ? blocks : []).reduce((max, block) => {
    const y = Number(block?.y) || 0;
    const h = Number(block?.h) || 0;
    return Math.max(max, y + h);
  }, 0);
  if (Array.isArray(pages) && pages.length) {
    return pages.map((page, index) => normalizePage(page, index)).sort((a, b) => (a.y || 0) - (b.y || 0));
  }
  if (!hasBlocks) return [];
  const requiredHeight = Math.max(Number(canvasHeight) || 0, blockBottom);
  const requiredCount = Math.ceil(requiredHeight / LEGACY_MANUSCRIPT_PAGE_HEIGHT);
  return Array.from({ length: requiredCount }, (_, index) => ({
    id: `page-${index + 1}`,
    y: index * LEGACY_MANUSCRIPT_PAGE_HEIGHT,
    width: LEGACY_MANUSCRIPT_PAGE_WIDTH,
    height: LEGACY_MANUSCRIPT_PAGE_HEIGHT,
    orientation: "portrait",
  }));
}

function normalizePage(page, index) {
  const width = Number(page?.width) || LEGACY_MANUSCRIPT_PAGE_WIDTH;
  const height = Number(page?.height) || LEGACY_MANUSCRIPT_PAGE_HEIGHT;
  return {
    id: page?.id || `page-${index + 1}`,
    y: Math.max(0, Number(page?.y) || index * height),
    width,
    height,
    orientation: page?.orientation || (width >= height ? "landscape" : "portrait"),
  };
}

function normalizePageOrientationPreference(value, pages = []) {
  if (value === "landscape" || value === "portrait") return value;
  const firstPage = Array.isArray(pages) ? pages[0] : null;
  if (!firstPage) return null;
  if (firstPage.orientation === "landscape" || firstPage.orientation === "portrait") return firstPage.orientation;
  return (Number(firstPage.width) || 0) >= (Number(firstPage.height) || 0) ? "landscape" : "portrait";
}

function isBlankLegacyAutoPage(pages) {
  if (!Array.isArray(pages) || pages.length !== 1) return false;
  const page = pages[0] || {};
  const width = Number(page.width) || LEGACY_MANUSCRIPT_PAGE_WIDTH;
  const height = Number(page.height) || LEGACY_MANUSCRIPT_PAGE_HEIGHT;
  const y = Number(page.y) || 0;
  return y === 0 && width === LEGACY_MANUSCRIPT_PAGE_WIDTH && height === LEGACY_MANUSCRIPT_PAGE_HEIGHT;
}

function canvasHeightForProject(pages, canvasHeight, blocks = [], originalPages = null) {
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  const hasPageRecords = Array.isArray(originalPages) && originalPages.length > 0;
  if (!hasBlocks && isBlankLegacyAutoPage(originalPages)) return 0;
  if (!hasBlocks && !hasPageRecords) return 0;
  const pageBottom = (Array.isArray(pages) ? pages : []).reduce((max, page) => {
    const y = Number(page?.y) || 0;
    const h = Number(page?.height) || 0;
    return Math.max(max, y + h);
  }, 0);
  if (pageBottom > 0) return pageBottom;
  const blockBottom = (Array.isArray(blocks) ? blocks : []).reduce((max, block) => {
    const y = Number(block?.y) || 0;
    const h = Number(block?.h) || 0;
    return Math.max(max, y + h);
  }, 0);
  return Math.max(0, Number(canvasHeight) || 0, blockBottom);
}

export function normalizeProjectRecord(value, fallbackDataset) {
  const project = value?.project && !value.dataset ? value.project : value;
  if (!project || typeof project !== "object") {
    throw new Error("Project file is not a LabRat project.");
  }
  const dataset = project.dataset;
  if (!dataset || !Array.isArray(dataset.experiments)) {
    throw new Error("Project file is missing a valid dataset.");
  }
  return buildProjectRecord({
    dataset: dataset || fallbackDataset,
    sourceName: project.sourceName,
    staged: project.staged,
    blocks: project.blocks,
    pages: project.pages,
    canvasHeight: project.canvasHeight,
    pageOrientationPreference: project.pageOrientationPreference,
    chartTemplates: project.chartTemplates,
    references: project.references,
  });
}

export function loadActiveProject() {
  return withStore("readonly", (store) => {
    const request = store.get(ACTIVE_PROJECT_ID);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read project."));
    });
  });
}

export function saveActiveProject(project) {
  return withStore("readwrite", (store) => {
    const request = store.put({ ...project, id: ACTIVE_PROJECT_ID, savedAt: new Date().toISOString() });
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not save project."));
    });
  });
}
import { normalizeDatasetDates } from "../utils/date.js";

