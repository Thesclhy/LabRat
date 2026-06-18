import { ls } from "../storage/localStorage.js";

const COLUMN_PREFS_STORAGE_KEY = "labrat_blank_experiment_column_prefs_v1";
const COLUMN_ORDER_STORAGE_KEY = "labrat_blank_experiment_column_order_v1";
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

// --- Column order (a per-project array of column keys) ---

function readOrderStore() {
  const value = ls.get(COLUMN_ORDER_STORAGE_KEY, {});
  return value && typeof value === "object" ? value : {};
}

export function getColumnOrder(projectId) {
  const value = readOrderStore()[scopeKey(projectId)];
  return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
}

export function setColumnOrder(projectId, keys) {
  const store = readOrderStore();
  const scope = scopeKey(projectId);
  const clean = Array.isArray(keys) ? [...new Set(keys.filter((key) => typeof key === "string"))] : [];
  if (clean.length) {
    store[scope] = clean;
  } else {
    delete store[scope];
  }
  ls.set(COLUMN_ORDER_STORAGE_KEY, store);
  return clean;
}

// Pure helper: move `fromKey` so it sits immediately before/after `toKey`.
export function moveKeyRelative(keys, fromKey, toKey, placeBefore) {
  const list = Array.isArray(keys) ? keys.slice() : [];
  if (fromKey === toKey || !list.includes(fromKey) || !list.includes(toKey)) return list;
  const without = list.filter((key) => key !== fromKey);
  const targetIndex = without.indexOf(toKey);
  const insertAt = placeBefore ? targetIndex : targetIndex + 1;
  return [...without.slice(0, insertAt), fromKey, ...without.slice(insertAt)];
}

// Order a list of { key } columns by a saved key order; unknown keys keep base order.
export function applyColumnOrder(columns, savedOrder) {
  const base = Array.isArray(columns) ? columns : [];
  if (!Array.isArray(savedOrder) || !savedOrder.length) return base;
  const byKey = new Map(base.map((column) => [column.key, column]));
  const ordered = [];
  savedOrder.forEach((key) => {
    if (byKey.has(key)) {
      ordered.push(byKey.get(key));
      byKey.delete(key);
    }
  });
  byKey.forEach((column) => ordered.push(column));
  return ordered;
}
