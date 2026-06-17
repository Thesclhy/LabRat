import { ls } from "../storage/localStorage.js";

const COLUMN_PREFS_STORAGE_KEY = "labrat_blank_experiment_column_prefs_v1";
const DEFAULT_SCOPE = "local";

function readStore() {
  const value = ls.get(COLUMN_PREFS_STORAGE_KEY, {});
  return value && typeof value === "object" ? value : {};
}

function writeStore(store) {
  ls.set(COLUMN_PREFS_STORAGE_KEY, store && typeof store === "object" ? store : {});
}

function scopeKey(projectId) {
  return projectId ? String(projectId) : DEFAULT_SCOPE;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  if (entry.hidden) out.hidden = true;
  if (typeof entry.label === "string" && entry.label.trim()) out.label = entry.label;
  if (typeof entry.width === "number" && Number.isFinite(entry.width) && entry.width > 0) out.width = Math.round(entry.width);
  return Object.keys(out).length ? out : null;
}

// Returns { [columnKey]: { hidden?: true, label?: string } } for one project.
export function getColumnPrefs(projectId) {
  const scoped = readStore()[scopeKey(projectId)] || {};
  const out = {};
  Object.keys(scoped).forEach((columnKey) => {
    const entry = normalizeEntry(scoped[columnKey]);
    if (entry) out[columnKey] = entry;
  });
  return out;
}

function persist(projectId, prefs) {
  const store = readStore();
  const scope = scopeKey(projectId);
  if (Object.keys(prefs).length) {
    store[scope] = prefs;
  } else {
    delete store[scope];
  }
  writeStore(store);
  return prefs;
}

function updateEntry(projectId, columnKey, patch) {
  if (!columnKey) return getColumnPrefs(projectId);
  const prefs = getColumnPrefs(projectId);
  const next = normalizeEntry({ ...(prefs[columnKey] || {}), ...patch });
  if (next) {
    prefs[columnKey] = next;
  } else {
    delete prefs[columnKey];
  }
  return persist(projectId, prefs);
}

export function hideColumn(projectId, columnKey) {
  return updateEntry(projectId, columnKey, { hidden: true });
}

export function showColumn(projectId, columnKey) {
  return updateEntry(projectId, columnKey, { hidden: false });
}

// Rename a column; passing an empty/blank label reverts to the default header.
export function renameColumn(projectId, columnKey, label) {
  return updateEntry(projectId, columnKey, { label: typeof label === "string" ? label.trim() : "" });
}

// Set an explicit pixel width; passing a non-positive value clears it (auto-fit).
export function setColumnWidth(projectId, columnKey, width) {
  return updateEntry(projectId, columnKey, { width: typeof width === "number" && width > 0 ? width : undefined });
}
