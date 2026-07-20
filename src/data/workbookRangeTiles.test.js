import { describe, expect, it } from "vitest";

import {
  getWorkbookTileCacheEntry,
  rememberWorkbookTileCacheEntry,
  workbookAllTileBounds,
  workbookPrefetchTileBounds,
  workbookPrioritizedTileBounds,
  workbookVisibleTileBounds,
} from "./workbookRangeTiles.js";

const displayBounds = {
  startRow: 0,
  endRow: 119,
  startCol: 0,
  endCol: 23,
};

describe("workbookRangeTiles", () => {
  it("keeps nearby scroll positions on stable 40 by 12 tiles", () => {
    const first = workbookVisibleTileBounds(displayBounds, {
      top: 0,
      left: 0,
      width: 1100,
      height: 600,
    });
    const nearby = workbookVisibleTileBounds(displayBounds, {
      top: 100,
      left: 0,
      width: 1100,
      height: 600,
    });

    expect(first).toEqual([{
      startRow: 0,
      endRow: 39,
      startCol: 0,
      endCol: 11,
    }]);
    expect(nearby).toEqual(first);
    expect(first.every((tile) => (
      (tile.endRow - tile.startRow + 1) * (tile.endCol - tile.startCol + 1) <= 500
    ))).toBe(true);
  });

  it("returns all tiles intersecting a viewport and one directional prefetch tile", () => {
    const visible = workbookVisibleTileBounds(displayBounds, {
      top: 1800,
      left: 1000,
      width: 1100,
      height: 600,
    });

    expect(visible).toEqual([
      { startRow: 40, endRow: 79, startCol: 0, endCol: 11 },
      { startRow: 40, endRow: 79, startCol: 12, endCol: 23 },
    ]);
    expect(workbookPrefetchTileBounds(displayBounds, visible, { top: 1800, left: 0 })).toEqual({
      startRow: 80,
      endRow: 119,
      startCol: 0,
      endCol: 11,
    });
  });

  it("enumerates every bounded tile in the sheet used range", () => {
    const tiles = workbookAllTileBounds(displayBounds);

    expect(tiles).toEqual([
      { startRow: 0, endRow: 39, startCol: 0, endCol: 11 },
      { startRow: 0, endRow: 39, startCol: 12, endCol: 23 },
      { startRow: 40, endRow: 79, startCol: 0, endCol: 11 },
      { startRow: 40, endRow: 79, startCol: 12, endCol: 23 },
      { startRow: 80, endRow: 119, startCol: 0, endCol: 11 },
      { startRow: 80, endRow: 119, startCol: 12, endCol: 23 },
    ]);
    expect(tiles.every((tile) => (
      (tile.endRow - tile.startRow + 1)
      * (tile.endCol - tile.startCol + 1) <= 500
    ))).toBe(true);
  });

  it("puts visible tiles first and orders the rest by distance", () => {
    const visible = [{
      startRow: 40,
      endRow: 79,
      startCol: 12,
      endCol: 23,
    }];

    const ordered = workbookPrioritizedTileBounds(displayBounds, visible);

    expect(ordered[0]).toEqual(visible[0]);
    expect(ordered).toHaveLength(6);
    expect(new Set(ordered.map((tile) => JSON.stringify(tile))).size).toBe(6);
    expect(ordered.slice(1, 3)).toEqual([
      { startRow: 0, endRow: 39, startCol: 12, endCol: 23 },
      { startRow: 40, endRow: 79, startCol: 0, endCol: 11 },
    ]);
  });

  it("bounds the LRU cache while retaining pending requests when fulfilled tiles can be evicted", () => {
    const cache = new Map();
    rememberWorkbookTileCacheEntry(cache, "pending", { status: "pending" }, 2);
    rememberWorkbookTileCacheEntry(cache, "first", { status: "fulfilled", value: 1 }, 2);
    rememberWorkbookTileCacheEntry(cache, "second", { status: "fulfilled", value: 2 }, 2);

    expect([...cache.keys()]).toEqual(["pending", "second"]);
    expect(getWorkbookTileCacheEntry(cache, "pending")).toEqual({ status: "pending" });
    rememberWorkbookTileCacheEntry(cache, "third", { status: "fulfilled", value: 3 }, 2);
    expect([...cache.keys()]).toEqual(["pending", "third"]);
  });
});
