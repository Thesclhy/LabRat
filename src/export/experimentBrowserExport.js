import * as XLSX from "xlsx";

const SHEET_NAME = "Experiments";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function headerLabel(column) {
  const label = String(column?.label || column?.id || "").trim();
  const unit = String(column?.unit || "").trim();
  // Column labels often already carry the unit, e.g. "Temperature (degC)".
  return unit && !label.toLowerCase().includes(unit.toLowerCase()) ? `${label} (${unit})` : label;
}

/**
 * The value one grid cell exports as. Numeric columns become real numbers
 * (their unit moves to the header); everything else exports the text the
 * grid shows, without the unit suffix. Empty cells stay empty.
 */
export function exportCellValue(row, column) {
  if (column.id === "experiment") return String(row?.label ?? "");
  const cell = row?.cells?.[column.id];
  if (!cell || cell.value == null || cell.value === "") return null;
  if (column.valueType === "number" && !column.isLinkedData) {
    const number = Number(cell.value);
    if (Number.isFinite(number)) return number;
  }
  return String(cell.formattedValue ?? cell.value);
}

/** Builds a one-sheet workbook of the given rows in the given column order. */
export function buildExperimentBrowserWorkbook({ columns, rows }) {
  const visible = asArray(columns);
  const aoa = [
    visible.map(headerLabel),
    ...asArray(rows).map((row) => visible.map((column) => exportCellValue(row, column))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = visible.map((column) => ({ wch: column.id === "experiment" ? 28 : 18 }));
  if (visible.length) sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: visible.length - 1 } }) };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return workbook;
}

/**
 * Loads every page of the current Experiment Browser query, so the export
 * matches what the grid would show after loading all rows.
 */
export async function loadAllExperimentBrowserRows(loadProjection, projectId, query, { pageLimit = 200, signal } = {}) {
  const rows = [];
  let cursor = null;
  do {
    const response = await loadProjection(projectId, { ...query, cursor, limit: pageLimit }, { signal });
    rows.push(...asArray(response?.rows));
    cursor = response?.nextCursor || null;
  } while (cursor);
  return rows;
}

export function experimentBrowserExportFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `experiment-browser-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`;
}

export function downloadExperimentBrowserWorkbook(workbook, fileName = experimentBrowserExportFileName()) {
  XLSX.writeFile(workbook, fileName, { compression: true });
}
