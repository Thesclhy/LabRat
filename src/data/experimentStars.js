import { ls } from "../storage/localStorage.js";

const STARS_STORAGE_KEY = "labrat_blank_experiment_stars_v1";
const DEFAULT_SCOPE = "local";

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
  return { starred: true, note: typeof entry.note === "string" ? entry.note : "", updatedAt: entry.updatedAt || null };
}

// Returns the full { [rowKey]: { starred, note, updatedAt } } map for one project.
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
    projectStars[rowKey] = { starred: true, note: "", updatedAt: timestamp };
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
    updatedAt: existing?.updatedAt && note === existing?.note ? existing.updatedAt : timestamp,
  };
  return persistProjectStars(projectId, projectStars);
}
