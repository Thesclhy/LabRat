export function cellSource(cell, context = {}) {
  return {
    fileId: context.fileId || null,
    fileName: context.fileName || null,
    sheet: context.sheetName || null,
    cell: cell?.address || null,
    range: cell?.address || null,
    blockId: context.blockId || null,
    rawValue: cell?.rawValue ?? null,
  };
}

export function rangeSource(range, context = {}, rawValue = null) {
  return {
    fileId: context.fileId || null,
    fileName: context.fileName || null,
    sheet: context.sheetName || null,
    cell: null,
    range,
    blockId: context.blockId || null,
    rawValue,
  };
}

export function keyValueSource(keyCell, valueCell, context = {}) {
  const sameCell = keyCell?.address === valueCell?.address;
  return {
    fileId: context.fileId || null,
    fileName: context.fileName || null,
    sheet: context.sheetName || null,
    keyCell: keyCell?.address || null,
    valueCell: valueCell?.address || null,
    cell: sameCell ? keyCell?.address || null : null,
    range: context.range || (sameCell ? keyCell?.address || null : null),
    blockId: context.blockId || null,
    rawValue: valueCell?.rawValue ?? null,
  };
}
