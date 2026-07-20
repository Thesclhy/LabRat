# Full-Sheet Workbook Loading And Selection Highlights Implementation Plan

Status: implemented 2026-07-20. Tasks were completed through TDD and verified
with the full frontend/backend/build gate plus live two-sheet browser QA.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Workbook Review progressively hydrate the current sheet's full
`usedRange` while checked review regions are the exact source of blue workbook
highlights.

**Architecture:** Keep the backend `/range` contract unchanged and enumerate
the existing 40-by-12 frontend tiles for the full current sheet. Load viewport
tiles first, then run a three-worker background queue into a per-sheet
normalized cell/completion cache. Lift checked region ids into the project
workspace so the Dock, grid styling, and drag gestures share one controlled
selection state distinct from the active editor region.

**Tech Stack:** React 19, JavaScript/JSX, react-data-grid, Vitest, Testing
Library, existing authenticated SourceDocument range API.

## Global Constraints

- Each backend SourceDocument range request must contain at most 500 cells;
  existing 40-by-12 tiles contain at most 480.
- Hydrate only the current sheet; do not concurrently preload unopened sheets.
- The current sheet's metadata `usedRange` is always the grid display domain.
- Ordinary drag replaces checked highlights; Ctrl/Command drag adds or toggles
  a disconnected highlight.
- Checkbox state is the only source of editable blue highlights; an explicitly
  empty selection remains empty.
- Active-region focus is independent from checked revision/highlight state.
- Preserve detected-region and reviewed-analysis red styling.
- Add no dependency, provider call, persistence change, or backend route.
- Do not modify untracked `.codex/`, `.superpowers/`, or
  `postman/cookies.txt`.

---

### Task 1: Full-Sheet Tile Enumeration And Priority

**Files:**
- Modify: `src/data/workbookRangeTiles.js`
- Test: `src/data/workbookRangeTiles.test.js`

**Interfaces:**
- Produces:
  `workbookAllTileBounds(displayBounds) -> Array<ExcelBounds>`.
- Produces:
  `workbookPrioritizedTileBounds(displayBounds, visibleTiles) -> Array<ExcelBounds>`.
- Existing tile dimensions, cache keys, and viewport helpers remain compatible.

- [ ] **Step 1: Write failing pure-function tests**

Add imports and tests that require complete, bounded, deduplicated tile
enumeration and visible-first deterministic ordering:

```js
import {
  getWorkbookTileCacheEntry,
  workbookAllTileBounds,
  workbookPrefetchTileBounds,
  workbookPrioritizedTileBounds,
  workbookVisibleTileBounds,
  rememberWorkbookTileCacheEntry,
} from "./workbookRangeTiles.js";

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
```

- [ ] **Step 2: Run the pure tests and verify RED**

Run:

```bash
npm test -- src/data/workbookRangeTiles.test.js
```

Expected: FAIL because `workbookAllTileBounds` and
`workbookPrioritizedTileBounds` are not exported.

- [ ] **Step 3: Implement deterministic tile enumeration and priority**

Reuse `tileBoundsAt`; do not duplicate A1 conversion:

```js
function tileDistance(left, right, displayBounds) {
  const leftRow = Math.floor(
    (left.startRow - displayBounds.startRow) / WORKBOOK_TILE_ROWS,
  );
  const leftCol = Math.floor(
    (left.startCol - displayBounds.startCol) / WORKBOOK_TILE_COLS,
  );
  const rightRow = Math.floor(
    (right.startRow - displayBounds.startRow) / WORKBOOK_TILE_ROWS,
  );
  const rightCol = Math.floor(
    (right.startCol - displayBounds.startCol) / WORKBOOK_TILE_COLS,
  );
  return Math.abs(leftRow - rightRow) + Math.abs(leftCol - rightCol);
}

export function workbookAllTileBounds(displayBounds) {
  if (!displayBounds) return [];
  const rowTileCount = Math.ceil(
    (displayBounds.endRow - displayBounds.startRow + 1)
      / WORKBOOK_TILE_ROWS,
  );
  const colTileCount = Math.ceil(
    (displayBounds.endCol - displayBounds.startCol + 1)
      / WORKBOOK_TILE_COLS,
  );
  const tiles = [];
  for (let rowTile = 0; rowTile < rowTileCount; rowTile += 1) {
    for (let colTile = 0; colTile < colTileCount; colTile += 1) {
      const bounds = tileBoundsAt(displayBounds, rowTile, colTile);
      if (bounds) tiles.push(bounds);
    }
  }
  return tiles;
}

export function workbookPrioritizedTileBounds(displayBounds, visibleTiles = []) {
  const allTiles = workbookAllTileBounds(displayBounds);
  const visibleKeys = new Set(visibleTiles.map((tile) => (
    `${tile.startRow}:${tile.startCol}:${tile.endRow}:${tile.endCol}`
  )));
  const visible = allTiles.filter((tile) => visibleKeys.has(
    `${tile.startRow}:${tile.startCol}:${tile.endRow}:${tile.endCol}`,
  ));
  const anchors = visible.length ? visible : allTiles.slice(0, 1);
  const remaining = allTiles
    .filter((tile) => !visibleKeys.has(
      `${tile.startRow}:${tile.startCol}:${tile.endRow}:${tile.endCol}`,
    ))
    .sort((left, right) => {
      const leftDistance = Math.min(...anchors.map((anchor) => (
        tileDistance(left, anchor, displayBounds)
      )));
      const rightDistance = Math.min(...anchors.map((anchor) => (
        tileDistance(right, anchor, displayBounds)
      )));
      return leftDistance - rightDistance
        || left.startRow - right.startRow
        || left.startCol - right.startCol;
    });
  return [...visible, ...remaining];
}
```

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run:

```bash
npm test -- src/data/workbookRangeTiles.test.js
```

Expected: all tile helper tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/data/workbookRangeTiles.js src/data/workbookRangeTiles.test.js
git commit -m "Add full-sheet workbook tile planning"
```

---

### Task 2: Controlled Checked-Region State

**Files:**
- Modify: `src/components/WorkbookReviewDock.jsx`
- Test: `src/components/WorkbookReviewDock.test.jsx`
- Modify: `src/main.jsx`
- Test: `src/components/ProjectDashboard.test.jsx`

**Interfaces:**
- `WorkbookReviewDock` consumes
  `selectedDraftRegionIds: Array<string>` and
  `onSelectedDraftRegionIdsChange(nextIds)`.
- `WorkbookReviewWorkspace` consumes the same pair.
- `ProjectDashboard` owns `selectedWorkbookReviewDraftRegionIds`.
- `activeDraftRegionId` remains the editor/focus target only.

- [ ] **Step 1: Write failing Dock tests for controlled checkboxes**

Replace implicit local-selection assumptions with a controlled Harness and add
an activation-independence assertion:

```jsx
function SelectionHarness({ onSelectionChange = () => {} }) {
  const [selectedIds, setSelectedIds] = useState(["draft_1"]);
  return (
    <WorkbookReviewDock
      reviewState={reviewState()}
      draftRegions={draftRegions}
      activeDraftRegionId="draft_1"
      selectedDraftRegionIds={selectedIds}
      onSelectedDraftRegionIdsChange={(nextIds) => {
        setSelectedIds(nextIds);
        onSelectionChange(nextIds);
      }}
    />
  );
}

it("uses controlled checked ids and allows an explicitly empty selection", () => {
  const onSelectionChange = vi.fn();
  render(<SelectionHarness onSelectionChange={onSelectionChange} />);

  fireEvent.click(screen.getByRole("checkbox", {
    name: "Include Sheet1!A1:B3 in revision",
  }));

  expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  expect(screen.getByRole("checkbox", {
    name: "Include Sheet1!A1:B3 in revision",
  }).checked).toBe(false);
});

it("activates a card without changing checked regions", () => {
  const onSelectionChange = vi.fn();
  const onActiveDraftRegionChange = vi.fn();
  render(
    <WorkbookReviewDock
      reviewState={reviewState()}
      draftRegions={draftRegions}
      activeDraftRegionId="draft_1"
      selectedDraftRegionIds={["draft_1"]}
      onSelectedDraftRegionIdsChange={onSelectionChange}
      onActiveDraftRegionChange={onActiveDraftRegionChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", {
    name: "Activate Sheet1!D1:E5",
  }));

  expect(onActiveDraftRegionChange).toHaveBeenCalledWith("draft_2");
  expect(onSelectionChange).not.toHaveBeenCalled();
});
```

Update every existing Dock test to pass `selectedDraftRegionIds={["draft_1"]}`;
the multi-box revision test must use a controlled Harness so clicking the
second checkbox rerenders with both ids.

- [ ] **Step 2: Write failing workspace tests for exact blue highlights**

Add a controlled workspace test with two draft regions:

```jsx
it("renders blue cells only for checked draft region ids", async () => {
  const { rerender } = render(
    <WorkbookReviewWorkspace
      projectId="project_1"
      reviewState={reviewState}
      draftRegions={draftRegions}
      activeDraftRegionId="draft_1"
      selectedDraftRegionIds={["draft_1"]}
      onDraftRegionsChange={() => {}}
      onSelectedDraftRegionIdsChange={() => {}}
    />,
  );

  await screen.findByText("Label");
  expect(screen.getByLabelText("Cell A1").closest(".rdg-cell"))
    .toHaveClass("is-draft");
  expect(screen.getByLabelText("Cell D1").closest(".rdg-cell"))
    .not.toHaveClass("is-draft");

  rerender(
    <WorkbookReviewWorkspace
      projectId="project_1"
      reviewState={reviewState}
      draftRegions={draftRegions}
      activeDraftRegionId="draft_1"
      selectedDraftRegionIds={["draft_2"]}
      onDraftRegionsChange={() => {}}
      onSelectedDraftRegionIdsChange={() => {}}
    />,
  );

  expect(screen.getByLabelText("Cell A1").closest(".rdg-cell"))
    .not.toHaveClass("is-draft");
  expect(screen.getByLabelText("Cell D1").closest(".rdg-cell"))
    .toHaveClass("is-draft");
});
```

Add gesture assertions:

```jsx
expect(onSelectedDraftRegionIdsChange).toHaveBeenLastCalledWith([
  "new_or_reused_region_id",
]);
```

for ordinary drag, and:

```jsx
expect(onSelectedDraftRegionIdsChange).toHaveBeenLastCalledWith([
  "draft_active",
  addedRegionId,
]);
```

for Ctrl/Command drag.

- [ ] **Step 3: Run controlled-selection tests and verify RED**

Run:

```bash
npm test -- src/components/WorkbookReviewDock.test.jsx src/components/ProjectDashboard.test.jsx
```

Expected: FAIL because selection is still local to the Dock and every editable
draft is blue.

- [ ] **Step 4: Make WorkbookReviewDock controlled**

Replace local `selectedRegionIds` state and active-id reset with:

```jsx
export function WorkbookReviewDock({
  reviewState = {},
  draftRegions = [],
  activeDraftRegionId = "",
  selectedDraftRegionIds = [],
  onSelectedDraftRegionIdsChange,
  onActiveDraftRegionChange,
  onSubmitRevision,
  onConfirmUnderstanding,
  onReviewExtractedExperiments,
}) {
  const availableIds = useMemo(
    () => new Set(regions.map(regionId).filter(Boolean)),
    [regions],
  );
  const validSelectedIds = useMemo(
    () => selectedDraftRegionIds.filter((id) => availableIds.has(id)),
    [availableIds, selectedDraftRegionIds],
  );

  const activateRegion = (region) => {
    const id = regionId(region);
    if (id) onActiveDraftRegionChange?.(id);
  };

  const toggleRegion = (region) => {
    const id = regionId(region);
    if (!id) return;
    onSelectedDraftRegionIdsChange?.(
      validSelectedIds.includes(id)
        ? validSelectedIds.filter((selectedId) => selectedId !== id)
        : [...validSelectedIds, id],
    );
  };
}
```

Do not reintroduce an active-region fallback when `selectedDraftRegionIds` is
empty.

- [ ] **Step 5: Lift selection into ProjectDashboard and wire the grid**

Add state beside the existing draft/active state:

```jsx
const [
  selectedWorkbookReviewDraftRegionIds,
  setSelectedWorkbookReviewDraftRegionIds,
] = useState([]);
```

Reset it in `resetReviewState`; initialize it to the active region id in
`handleWorkbookReviewReadyFromAgent`; filter invalid ids after revision
reconciliation. Pass it to both components:

```jsx
<WorkbookReviewWorkspace
  selectedDraftRegionIds={selectedWorkbookReviewDraftRegionIds}
  onSelectedDraftRegionIdsChange={
    setSelectedWorkbookReviewDraftRegionIds
  }
  activeDraftRegionId={activeWorkbookReviewDraftRegionId}
  onDraftRegionsChange={setWorkbookReviewDraftRegions}
  onActiveDraftRegionChange={setActiveWorkbookReviewDraftRegionId}
/>

<WorkbookReviewDock
  selectedDraftRegionIds={selectedWorkbookReviewDraftRegionIds}
  onSelectedDraftRegionIdsChange={
    setSelectedWorkbookReviewDraftRegionIds
  }
  activeDraftRegionId={activeWorkbookReviewDraftRegionId}
  onActiveDraftRegionChange={handleWorkbookReviewRegionActivate}
  onSubmitRevision={submitWorkbookReviewRevision}
  onConfirmUnderstanding={confirmWorkbookReviewUnderstanding}
/>
```

Inside `WorkbookReviewWorkspace`, derive editable blue regions from the exact
ids:

```js
const selectedDraftRegionIdSet = useMemo(
  () => new Set(selectedDraftRegionIds),
  [selectedDraftRegionIds],
);
const highlightedEditableDrafts = useMemo(
  () => draftRegionsForSheet.filter((region) => (
    region.status !== "reviewed_input"
      && selectedDraftRegionIdSet.has(
        region.draftRegionId || region.clientRegionId,
      )
  )),
  [draftRegionsForSheet, selectedDraftRegionIdSet],
);
```

Use `highlightedEditableDrafts` instead of all `editableDrafts` in the
`is-draft` cell-class check.

Update draft gesture handlers:

```js
onSelectedDraftRegionIdsChange?.([nextRegionId]);
```

after ordinary cell/range selection;

```js
onSelectedDraftRegionIdsChange?.([
  ...selectedDraftRegionIds.filter((id) => id !== nextRegionId),
  nextRegionId,
]);
```

after Ctrl/Command addition; and remove the matching id after an exact
Ctrl/Command toggle.

- [ ] **Step 6: Run controlled-selection tests and verify GREEN**

Run:

```bash
npm test -- src/components/WorkbookReviewDock.test.jsx src/components/ProjectDashboard.test.jsx
```

Expected: Dock and workspace tests PASS, including explicit empty selection,
ordinary replacement, Ctrl/Command addition/toggle, and activation
independence.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/components/WorkbookReviewDock.jsx \
  src/components/WorkbookReviewDock.test.jsx \
  src/main.jsx src/components/ProjectDashboard.test.jsx
git commit -m "Link workbook checkboxes to blue selections"
```

---

### Task 3: Progressive Full-Sheet Hydration And Retained Cells

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/styles.css`
- Test: `src/components/ProjectDashboard.test.jsx`

**Interfaces:**
- Consumes `workbookPrioritizedTileBounds` from Task 1.
- `WorkbookReviewWorkspace` keeps:
  `sheetCellCacheRef: Map<sheetKey, { cells, completed, failed }>`.
- A scheduler generation is scoped to document id, sheet name, and used range.
- Background concurrency is exactly `3`.

- [ ] **Step 1: Write failing full-hydration and request-bound tests**

Add these complete helpers inside the `WorkbookReviewWorkspace` describe
block:

```js
function columnIndex(label) {
  return [...label].reduce(
    (value, char) => value * 26 + char.charCodeAt(0) - 64,
    0,
  ) - 1;
}

function markerForRange(sheetName, range) {
  const [, startCol, startRow] = range.match(
    /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/,
  );
  return {
    row: Number(startRow) - 1,
    col: columnIndex(startCol),
    address: `${startCol}${startRow}`,
    rawValue: `${sheetName} ${range}`,
    formattedValue: `${sheetName} ${range}`,
  };
}

function workbookRangeRequests(fetchMock, sheetName = "") {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
    .map(([, init]) => JSON.parse(init.body || "{}"))
    .filter((body) => !sheetName || body.sheetName === sheetName);
}

function workbookRangeCellCount(range) {
  const [, startCol, startRow, endCol, endRow] = range.match(
    /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/,
  );
  return (Number(endRow) - Number(startRow) + 1)
    * (columnIndex(endCol) - columnIndex(startCol) + 1);
}

function makeHydrationFetch({
  sheets = [
    { name: "Sheet1", usedRange: "A1:X81", rowCount: 81, columnCount: 24 },
  ],
  failOnceKey = "",
  emptyKeys = [],
  deferred = new Map(),
} = {}) {
  const attempts = new Map();
  const fetchMock = vi.fn(async (url, init = {}) => {
    if (url === "/api/projects/project_1/source-documents") {
      return jsonResponse({
        sourceDocuments: [{
          id: "source_doc_1",
          metadata: { workbookName: "Large.xlsx", sheets },
        }],
      });
    }
    if (url === "/api/source-documents/source_doc_1/range") {
      const body = JSON.parse(init.body || "{}");
      const key = `${body.sheetName}!${body.range}`;
      attempts.set(key, (attempts.get(key) || 0) + 1);
      if (key === failOnceKey && attempts.get(key) === 1) {
        throw new Error(`Failed ${key}`);
      }
      if (deferred.has(key)) return deferred.get(key);
      return jsonResponse({
        sheetName: body.sheetName,
        range: body.range,
        rows: emptyKeys.includes(key)
          ? []
          : [[markerForRange(body.sheetName, body.range)]],
        cells: [],
      });
    }
    return jsonResponse({});
  });
  return { fetchMock, attempts };
}

function largeReviewState(sheets) {
  return {
    ...reviewState,
    sourceDocument: {
      id: "source_doc_1",
      metadata: { workbookName: "Large.xlsx", sheets },
    },
  };
}
```

Create the full-hydration test, render without scrolling, and wait for
completion:

```jsx
it("hydrates the complete current sheet without scrolling", async () => {
  const sheets = [{
    name: "Sheet1",
    usedRange: "A1:X81",
    rowCount: 81,
    columnCount: 24,
  }];
  const { fetchMock } = makeHydrationFetch({ sheets });
  global.fetch = fetchMock;
  render(
    <WorkbookReviewWorkspace
      projectId="project_1"
      reviewState={largeReviewState(sheets)}
      draftRegions={[]}
      selectedDraftRegionIds={[]}
      onDraftRegionsChange={() => {}}
      onSelectedDraftRegionIdsChange={() => {}}
    />,
  );

  expect(await screen.findByText("Sheet1 A1:L40")).toBeTruthy();
  await screen.findByText("Sheet loaded: 6/6 ranges");

  const requests = workbookRangeRequests(fetchMock).map((body) => body.range);
  expect(requests).toEqual(expect.arrayContaining([
    "A1:L40",
    "M1:X40",
    "A41:L80",
    "M41:X80",
    "A81:L81",
    "M81:X81",
  ]));
  expect(requests[0]).toBe("A1:L40");
  expect(new Set(requests).size).toBe(requests.length);
  expect(requests.every((range) => (
    workbookRangeCellCount(range) <= 500
  ))).toBe(true);
});
```

The mock should return the requested range string as a visible cell value so
the first assertion proves the visible tile arrives before background
completion.

- [ ] **Step 2: Write failing cache, sheet-isolation, and retry tests**

Add the three complete focused tests below. Restore `global.fetch` in the
describe block's existing cleanup pattern.

```jsx
it("retains completed and empty tiles when switching sheets", async () => {
  const sheets = [
    { name: "Sheet1", usedRange: "A1:X81", rowCount: 81, columnCount: 24 },
    { name: "Sheet2", usedRange: "A1:F81", rowCount: 81, columnCount: 6 },
  ];
  const { fetchMock } = makeHydrationFetch({
    sheets,
    emptyKeys: ["Sheet1!M41:X80"],
  });
  global.fetch = fetchMock;
  render(
    <WorkbookReviewWorkspace
      projectId="project_1"
      reviewState={largeReviewState(sheets)}
      draftRegions={[]}
      selectedDraftRegionIds={[]}
      onDraftRegionsChange={() => {}}
      onSelectedDraftRegionIdsChange={() => {}}
    />,
  );

  await screen.findByText("Sheet loaded: 6/6 ranges");
  const sheet1RequestCount = workbookRangeRequests(
    fetchMock,
    "Sheet1",
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "Sheet2" }));
  await screen.findByText("Sheet loaded: 3/3 ranges");
  fireEvent.click(screen.getByRole("button", { name: "Sheet1" }));
  await screen.findByText("Sheet loaded: 6/6 ranges");

  expect(workbookRangeRequests(fetchMock, "Sheet1"))
    .toHaveLength(sheet1RequestCount);
});

it("does not show late responses from the previous sheet", async () => {
  const sheets = [
    { name: "Sheet1", usedRange: "A1:X81", rowCount: 81, columnCount: 24 },
    { name: "Sheet2", usedRange: "A1:F2", rowCount: 2, columnCount: 6 },
  ];
  let releaseSheet1;
  const heldSheet1 = new Promise((resolve) => {
    releaseSheet1 = () => resolve(jsonResponse({
      sheetName: "Sheet1",
      range: "A1:L40",
      rows: [[markerForRange("Sheet1", "A1:L40")]],
      cells: [],
    }));
  });
  const { fetchMock } = makeHydrationFetch({
    sheets,
    deferred: new Map([["Sheet1!A1:L40", heldSheet1]]),
  });
  global.fetch = fetchMock;
  render(
    <WorkbookReviewWorkspace
      projectId="project_1"
      reviewState={largeReviewState(sheets)}
      draftRegions={[]}
      selectedDraftRegionIds={[]}
      onDraftRegionsChange={() => {}}
      onSelectedDraftRegionIdsChange={() => {}}
    />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Sheet2" }));
  expect(await screen.findByText("Sheet2 A1:F2")).toBeTruthy();
  releaseSheet1();
  await act(async () => heldSheet1);

  expect(screen.queryByText("Sheet1 A1:L40")).toBeNull();
  expect(screen.getByLabelText("Sheet range").value).toBe("A1:F2");
});

it("retries only failed workbook ranges and keeps successful cells", async () => {
  const sheets = [{
    name: "Sheet1",
    usedRange: "A1:X81",
    rowCount: 81,
    columnCount: 24,
  }];
  const { fetchMock, attempts } = makeHydrationFetch({
    sheets,
    failOnceKey: "Sheet1!M41:X80",
  });
  global.fetch = fetchMock;
  render(
    <WorkbookReviewWorkspace
      projectId="project_1"
      reviewState={largeReviewState(sheets)}
      draftRegions={[]}
      selectedDraftRegionIds={[]}
      onDraftRegionsChange={() => {}}
      onSelectedDraftRegionIdsChange={() => {}}
    />,
  );

  expect(await screen.findByText("Sheet1 A1:L40")).toBeTruthy();
  await screen.findByText("Sheet incomplete: 5/6 ranges");
  expect(screen.getByText("Sheet1 A1:L40")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {
    name: "Retry failed ranges",
  }));
  await screen.findByText("Sheet loaded: 6/6 ranges");

  expect(attempts.get("Sheet1!M41:X80")).toBe(2);
  expect(screen.getByText("Sheet1 A1:L40")).toBeTruthy();
});
```

- [ ] **Step 3: Write a failing focus test that preserves usedRange**

Change the existing active-red-box focus regression:

```jsx
expect(screen.getByLabelText("Sheet range").value).toBe("A1:X81");
fireEvent.click(screen.getByRole("button", {
  name: "Activate Sheet1!M41:N42",
}));
expect(screen.getByLabelText("Sheet range").value).toBe("A1:X81");
expect(grid.scrollTop).toBeGreaterThan(0);
expect(grid.scrollLeft).toBeGreaterThan(0);
```

The exact scroll values should derive from the 30-pixel row height and
112-pixel column width; the test need only prove positive movement and an
unchanged sheet range.

- [ ] **Step 4: Run hydration tests and verify RED**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx -t "hydrates|retains completed|late responses|retries only|preserves usedRange"
```

Expected: FAIL because the current implementation loads only visible and one
prefetch tile, evicts raw tile state, and narrows `activeRange` on focus.

- [ ] **Step 5: Add per-sheet normalized cells and completion state**

Add helpers near `WorkbookReviewWorkspace`:

```js
const WORKBOOK_BACKGROUND_CONCURRENCY = 3;

function workbookSheetCacheKey(sourceDocumentId, sheetName) {
  return `${sourceDocumentId}::${sheetName}`;
}

function getOrCreateWorkbookSheetCache(cache, key) {
  if (!cache.has(key)) {
    cache.set(key, {
      cells: new Map(),
      completed: new Set(),
      failed: new Map(),
    });
  }
  return cache.get(key);
}
```

Add `sheetCellCacheRef`, `hydrationGenerationRef`, and a revision state.
On tile success:

```js
const sheetCache = getOrCreateWorkbookSheetCache(
  sheetCellCacheRef.current,
  workbookSheetCacheKey(sourceDocument.id, activeSheetName),
);
excelCellsFromRangeResult(result).forEach((cell, key) => {
  sheetCache.cells.set(key, cell);
});
sheetCache.completed.add(cacheKey);
sheetCache.failed.delete(cacheKey);
setSheetCacheRevision((value) => value + 1);
```

On failure, store the error under the tile key without clearing fulfilled cells.
Use the active sheet cache, not raw LRU entries, to build `cellsByCoord`,
completed counts, and failed counts.

- [ ] **Step 6: Add the three-worker current-sheet scheduler**

Import `workbookPrioritizedTileBounds`. Replace directional-only prefetch with
a generation-scoped effect:

```js
useEffect(() => {
  if (!sourceDocument?.id || !activeSheetName || !displayBounds) {
    return undefined;
  }
  const generation = hydrationGenerationRef.current + 1;
  hydrationGenerationRef.current = generation;
  let cancelled = false;
  const queue = workbookPrioritizedTileBounds(
    displayBounds,
    visibleTileBounds,
  );
  let cursor = 0;
  let running = 0;

  const pump = () => {
    if (cancelled || hydrationGenerationRef.current !== generation) return;
    while (running < WORKBOOK_BACKGROUND_CONCURRENCY
      && cursor < queue.length) {
      const bounds = queue[cursor];
      cursor += 1;
      if (workbookTileIsCompletedOrPending(bounds)) continue;
      running += 1;
      loadWorkbookTile(bounds)
        .catch(() => null)
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  Promise.all(visibleTileBounds.map((bounds) => (
    loadWorkbookTile(bounds).catch(() => null)
  ))).finally(pump);

  return () => {
    cancelled = true;
  };
}, [
  sourceDocument?.id,
  activeSheetName,
  sheetUsedRange,
  loadWorkbookTile,
]);
```

Keep the visible-tile effect so a newly scrolled viewport jumps ahead of the
background queue. Both paths must reuse pending requests and completed tile
keys. Do not put cache revision or scroll offsets in the background scheduler
dependencies.

- [ ] **Step 7: Keep usedRange mounted and scroll focus into view**

Replace mutable display `activeRange` with the selected sheet's canonical
range:

```js
const sheetUsedRange = activeSheet?.usedRange
  || formatExcelA1Range(excelRangeBoundsFromSheet(activeSheet));
const displayBounds = parseExcelA1Range(sheetUsedRange)
  || excelRangeBoundsFromSheet(activeSheet);
```

Render it as a read-only toolbar field:

```jsx
<input aria-label="Sheet range" value={sheetUsedRange} readOnly />
```

When `focusSelection` matches the active document and sheet, calculate the
target offsets and call `syncWorkbookScrollState`:

```js
scrollElement.scrollTop = Math.max(
  0,
  (focusBounds.startRow - displayBounds.startRow)
    * WORKBOOK_EXCEL_ROW_HEIGHT,
);
scrollElement.scrollLeft = Math.max(
  0,
  (focusBounds.startCol - displayBounds.startCol)
    * WORKBOOK_EXCEL_CELL_WIDTH,
);
syncWorkbookScrollState(scrollElement);
```

Document/sheet changes happen first; a follow-up effect performs the scroll
after the matching sheet is mounted. Do not call `setActiveRange` with the
focused region.

- [ ] **Step 8: Add progress and retry UI**

Render non-blocking status from `completed`, failed, total, and pending counts:

```jsx
<div className="workbook-sheet-load-status" role="status">
  <span>
    {failedCount
      ? `Sheet incomplete: ${completedCount}/${totalTileCount} ranges`
      : `Sheet loaded: ${completedCount}/${totalTileCount} ranges`}
  </span>
  {!!failedCount && (
    <button type="button" onClick={retryFailedWorkbookTiles}>
      Retry failed ranges
    </button>
  )}
</div>
```

Before completion, use `Loading sheet: X/Y ranges`. Keep visible-cell skeletons
and do not place a blocking overlay above the grid. Add compact toolbar/status
CSS with stable height and no page overflow.

- [ ] **Step 9: Run hydration tests and verify GREEN**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
```

Expected: all WorkbookReviewWorkspace and ProjectDashboard tests PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/main.jsx src/styles.css \
  src/components/ProjectDashboard.test.jsx
git commit -m "Hydrate complete workbook sheets in the background"
```

---

### Task 4: Integration Verification, Browser QA, And Durable Docs

**Files:**
- Modify: `doc/PROGRESS.md`
- Modify: `doc/current-milestone.md`
- Modify: `doc/qa/manual-qa-agent-first-workflow.md`

**Interfaces:**
- No new code interface.
- Verification must preserve the SourceDocument range contract and current
  WorkbookUnderstanding workflow.

- [ ] **Step 1: Run focused frontend verification**

Run:

```bash
npm test -- src/data/workbookRangeTiles.test.js \
  src/components/WorkbookReviewDock.test.jsx \
  src/components/ProjectDashboard.test.jsx
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run full repository verification**

Run:

```bash
npm run codex:verify
```

Expected: frontend, backend, and production build PASS. The optional Postgres
test may skip without `LABRAT_TEST_DATABASE_URL`; the existing Plotly chunk
warning is allowed.

- [ ] **Step 3: Run static checks**

Run:

```bash
git diff --check
rg -n "workbookPrefetchTileBounds|selectedRegionIds" \
  src/main.jsx src/components/WorkbookReviewDock.jsx
```

Expected: no new whitespace errors; no retired directional-only prefetch import
or Dock-local `selectedRegionIds` state remains.

- [ ] **Step 4: Perform browser QA**

Use the running frontend at `http://127.0.0.1:5173/LabRat/` and backend at
`http://127.0.0.1:8787`. Use a project-owned multi-sheet synthetic workbook
whose current sheet contains more than 500 cells.

Verify:

1. The first visible cells render before background completion.
2. Progress reaches every tile in the current sheet without scrolling.
3. Jumping to distant cells after completion shows data immediately.
4. Switching to another sheet loads it independently; returning causes no
   loading regression.
5. Ordinary drag removes prior checks/blue highlights and selects the new
   range.
6. Ctrl/Command drag keeps old checks/blue highlights and adds or toggles the
   new range.
7. Manual checkbox changes immediately update only the matching blue region.
8. Activating a review card focuses it without changing checkbox state.
9. No page overflow, overlapping controls, console errors, or failed requests
   remain.

- [ ] **Step 5: Update QA and progress docs**

Add checklist items/results to
`doc/qa/manual-qa-agent-first-workflow.md`. Update `doc/PROGRESS.md` with the
request, implementation, focused/full verification counts, browser evidence,
and residual virtualization risk. Set `doc/current-milestone.md` to complete
with the exact commands/results.

- [ ] **Step 6: Re-read active docs and commit**

Re-read:

```bash
Get-Content doc/plan.md -TotalCount 120
Get-Content doc/current-milestone.md -TotalCount 160
Get-Content doc/contracts/saas-api-contract-v0.md -TotalCount 130
```

Confirm the 500-cell backend range rule is unchanged, then run:

```bash
git add doc/PROGRESS.md doc/current-milestone.md \
  doc/qa/manual-qa-agent-first-workflow.md
git commit -m "Document full-sheet workbook review verification"
```
