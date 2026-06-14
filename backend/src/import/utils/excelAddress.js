import * as XLSX from "xlsx";

export function encodeCell(rowIndex, colIndex) {
  return XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
}

export function decodeRange(rangeRef) {
  return XLSX.utils.decode_range(rangeRef);
}

export function encodeRange(range) {
  return XLSX.utils.encode_range(range);
}
