// Pure sorting helpers for the imported experiment browser. Sorting is a display
// layer over the rows from buildGenericBrowserRows; it never mutates data.

export function cellSortValue(row, column) {
  if (!row || !column) return "";
  if (column.kind === "label") return row.label || "";
  if (column.kind === "source") return row.sourceFile || "";
  return row.acceptedMappingValues?.[column.key]?.value || "";
}

export function leadingNumber(value) {
  if (typeof value !== "string") return NaN;
  const match = value.trim().match(/^[-+]?\d*\.?\d+/);
  return match ? parseFloat(match[0]) : NaN;
}

// Ascending comparison: numbers numerically, otherwise natural (case-insensitive)
// text. Blanks are handled by sortRows so they always sink to the bottom.
export function compareAscending(a, b) {
  const na = leadingNumber(a);
  const nb = leadingNumber(b);
  const aNum = !Number.isNaN(na);
  const bNum = !Number.isNaN(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function isBlankValue(value) {
  return value === "" || value === "-";
}

// Stable sort of rows by a column. dir = "asc" | "desc"; blanks always last.
export function sortRows(rows, column, dir) {
  const decorated = (Array.isArray(rows) ? rows : []).map((row) => ({ row, value: cellSortValue(row, column) }));
  const blanks = decorated.filter((item) => isBlankValue(item.value));
  const nonBlanks = decorated.filter((item) => !isBlankValue(item.value));
  const factor = dir === "desc" ? -1 : 1;
  nonBlanks.sort((a, b) => factor * compareAscending(a.value, b.value));
  return [...nonBlanks, ...blanks].map((item) => item.row);
}
