export const WORKBOOK_TILE_ROWS = 40;
export const WORKBOOK_TILE_COLS = 12;
export const WORKBOOK_TILE_CACHE_LIMIT = 80;
export const WORKBOOK_SCROLL_DEBOUNCE_MS = 120;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tileBoundsAt(displayBounds, rowTileIndex, colTileIndex) {
  const startRow = displayBounds.startRow + rowTileIndex * WORKBOOK_TILE_ROWS;
  const startCol = displayBounds.startCol + colTileIndex * WORKBOOK_TILE_COLS;
  if (startRow > displayBounds.endRow || startCol > displayBounds.endCol) return null;
  return {
    startRow,
    endRow: Math.min(displayBounds.endRow, startRow + WORKBOOK_TILE_ROWS - 1),
    startCol,
    endCol: Math.min(displayBounds.endCol, startCol + WORKBOOK_TILE_COLS - 1),
  };
}

export function workbookVisibleTileBounds(displayBounds, scrollState = {}, {
  rowHeight = 30,
  columnWidth = 112,
  fallbackWidth = 1100,
  fallbackHeight = 600,
} = {}) {
  if (!displayBounds) return [];
  const rowTotal = displayBounds.endRow - displayBounds.startRow + 1;
  const colTotal = displayBounds.endCol - displayBounds.startCol + 1;
  if (rowTotal <= 0 || colTotal <= 0) return [];

  const rowStartOffset = clamp(Math.floor((scrollState.top || 0) / rowHeight), 0, rowTotal - 1);
  const colStartOffset = clamp(Math.floor((scrollState.left || 0) / columnWidth), 0, colTotal - 1);
  const rowEndOffset = clamp(
    Math.floor(((scrollState.top || 0) + Math.max(1, scrollState.height || fallbackHeight) - 1) / rowHeight),
    rowStartOffset,
    rowTotal - 1,
  );
  const colEndOffset = clamp(
    Math.floor(((scrollState.left || 0) + Math.max(1, scrollState.width || fallbackWidth) - 1) / columnWidth),
    colStartOffset,
    colTotal - 1,
  );
  const firstRowTile = Math.floor(rowStartOffset / WORKBOOK_TILE_ROWS);
  const lastRowTile = Math.floor(rowEndOffset / WORKBOOK_TILE_ROWS);
  const firstColTile = Math.floor(colStartOffset / WORKBOOK_TILE_COLS);
  const lastColTile = Math.floor(colEndOffset / WORKBOOK_TILE_COLS);
  const tiles = [];
  for (let rowTile = firstRowTile; rowTile <= lastRowTile; rowTile += 1) {
    for (let colTile = firstColTile; colTile <= lastColTile; colTile += 1) {
      const bounds = tileBoundsAt(displayBounds, rowTile, colTile);
      if (bounds) tiles.push(bounds);
    }
  }
  return tiles;
}

export function workbookPrefetchTileBounds(displayBounds, visibleTiles, direction = {}) {
  if (!displayBounds || !visibleTiles?.length) return null;
  const vertical = Math.abs(direction.top || 0) >= Math.abs(direction.left || 0);
  let anchor;
  let rowTile;
  let colTile;

  if (vertical && direction.top) {
    anchor = [...visibleTiles].sort((a, b) => (
      direction.top > 0 ? b.endRow - a.endRow : a.startRow - b.startRow
    ))[0];
    rowTile = Math.floor((anchor.startRow - displayBounds.startRow) / WORKBOOK_TILE_ROWS) + Math.sign(direction.top);
    colTile = Math.floor((anchor.startCol - displayBounds.startCol) / WORKBOOK_TILE_COLS);
  } else if (!vertical && direction.left) {
    anchor = [...visibleTiles].sort((a, b) => (
      direction.left > 0 ? b.endCol - a.endCol : a.startCol - b.startCol
    ))[0];
    rowTile = Math.floor((anchor.startRow - displayBounds.startRow) / WORKBOOK_TILE_ROWS);
    colTile = Math.floor((anchor.startCol - displayBounds.startCol) / WORKBOOK_TILE_COLS) + Math.sign(direction.left);
  } else {
    return null;
  }
  if (rowTile < 0 || colTile < 0) return null;
  return tileBoundsAt(displayBounds, rowTile, colTile);
}

export function workbookTileCacheKey(sourceDocumentId, sheetName, bounds) {
  return [
    sourceDocumentId,
    sheetName,
    bounds?.startRow,
    bounds?.startCol,
    bounds?.endRow,
    bounds?.endCol,
  ].join("::");
}

export function getWorkbookTileCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function rememberWorkbookTileCacheEntry(cache, key, entry, limit = WORKBOOK_TILE_CACHE_LIMIT) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > limit) {
    const oldestFulfilled = [...cache.entries()].find(([, candidate]) => candidate?.status === "fulfilled");
    const oldestKey = oldestFulfilled?.[0] || cache.keys().next().value;
    if (!oldestKey || oldestKey === key && cache.size === 1) break;
    cache.delete(oldestKey);
  }
}

export function boundsContainCell(bounds, row, col) {
  return Boolean(bounds)
    && row >= bounds.startRow
    && row <= bounds.endRow
    && col >= bounds.startCol
    && col <= bounds.endCol;
}
