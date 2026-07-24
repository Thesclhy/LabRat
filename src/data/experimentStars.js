import { ls } from "../storage/localStorage.js";

const STARS_STORAGE_KEY = "labrat_blank_experiment_stars_v1";
const DEFAULT_SCOPE = "local";

// Selectable highlight colors. `star` tints the star glyph; `tint` tints the row.
export const STAR_COLORS = [
  { id: "amber", label: "Amber", star: "#e8a73a", tint: "#fdf1d4" },
  { id: "red", label: "Red", star: "#e2574c", tint: "#fbe3e1" },
  { id: "green", label: "Green", star: "#4f9d69", tint: "#e3f1e7" },
  { id: "blue", label: "Blue", star: "#4a8fd4", tint: "#e2edf9" },
  { id: "purple", label: "Purple", star: "#8a6fd1", tint: "#ece7f8" },
  { id: "pink", label: "Pink", star: "#d46aa0", tint: "#fae4ef" },
];
export const DEFAULT_STAR_COLOR = "amber";
const STAR_COLOR_IDS = new Set(STAR_COLORS.map((color) => color.id));

export function getStarColor(id) {
  return STAR_COLORS.find((color) => color.id === id) || STAR_COLORS[0];
}

function readStore() {
  const value = ls.get(STARS_STORAGE_KEY, {});
  return value && typeof value === "object" ? value : {};
}

function writeStore(store) {
  ls.set(STARS_STORAGE_KEY, store && typeof store === "object" ? store : {});
}

function scopeKey(projectId) {
  return projectId ? String(projectId) : DEFAULT_SCOPE;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!entry.starred) return null;
  const color = STAR_COLOR_IDS.has(entry.color) ? entry.color : DEFAULT_STAR_COLOR;
  return { starred: true, note: typeof entry.note === "string" ? entry.note : "", color, updatedAt: entry.updatedAt || null };
}

// Returns the full { [rowKey]: { starred, note, color, updatedAt } } map for one project.
export function getProjectStars(projectId) {
  const scoped = readStore()[scopeKey(projectId)] || {};
  const out = {};
  Object.keys(scoped).forEach((rowKey) => {
    const entry = normalizeEntry(scoped[rowKey]);
    if (entry) out[rowKey] = entry;
  });
  return out;
}

export function isStarred(projectId, rowKey) {
  if (!rowKey) return false;
  return !!getProjectStars(projectId)[rowKey]?.starred;
}

export function getNote(projectId, rowKey) {
  if (!rowKey) return "";
  return getProjectStars(projectId)[rowKey]?.note || "";
}

export function getStarColorId(projectId, rowKey) {
  if (!rowKey) return DEFAULT_STAR_COLOR;
  return getProjectStars(projectId)[rowKey]?.color || DEFAULT_STAR_COLOR;
}

function persistProjectStars(projectId, projectStars) {
  const store = readStore();
  const scope = scopeKey(projectId);
  if (Object.keys(projectStars).length) {
    store[scope] = projectStars;
  } else {
    delete store[scope];
  }
  writeStore(store);
  return projectStars;
}

// Toggle star on/off. Unstarring also clears the note. Returns the updated project map.
export function toggleStar(projectId, rowKey, timestamp = Date.now()) {
  if (!rowKey) return getProjectStars(projectId);
  const projectStars = getProjectStars(projectId);
  if (projectStars[rowKey]?.starred) {
    delete projectStars[rowKey];
  } else {
    projectStars[rowKey] = { starred: true, note: "", color: DEFAULT_STAR_COLOR, updatedAt: timestamp };
  }
  return persistProjectStars(projectId, projectStars);
}

// Set (or clear) the note for a row. Saving a note implicitly stars the row.
export function setNote(projectId, rowKey, note, timestamp = Date.now()) {
  if (!rowKey) return getProjectStars(projectId);
  const projectStars = getProjectStars(projectId);
  const existing = projectStars[rowKey];
  projectStars[rowKey] = {
    starred: true,
    note: typeof note === "string" ? note : "",
    color: existing?.color || DEFAULT_STAR_COLOR,
    updatedAt: existing?.updatedAt && note === existing?.note ? existing.updatedAt : timestamp,
  };
  return persistProjectStars(projectId, projectStars);
}

// Set the highlight color for a row. Choosing a color implicitly stars the row.
export function setStarColor(projectId, rowKey, color, timestamp = Date.now()) {
  if (!rowKey) return getProjectStars(projectId);
  const projectStars = getProjectStars(projectId);
  const existing = projectStars[rowKey];
  projectStars[rowKey] = {
    starred: true,
    note: existing?.note || "",
    color: STAR_COLOR_IDS.has(color) ? color : DEFAULT_STAR_COLOR,
    updatedAt: existing?.updatedAt || timestamp,
  };
  return persistProjectStars(projectId, projectStars);
}
