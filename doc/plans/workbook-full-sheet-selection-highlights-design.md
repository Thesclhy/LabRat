# Full-Sheet Workbook Loading And Selection Highlights

Status: approved
Date: 2026-07-20

## Problem

Workbook Review currently lays out the selected range as a grid but only loads
the visible 40-row by 12-column tiles and one directional neighbor. Moving to
an unloaded part of the sheet therefore pauses for another range request.

The review dock also owns its checkbox state locally while the workbook grid
renders every editable draft region in blue. As a result, the checked regions
and the visible blue highlights can disagree.

## Goals

- Load the complete `usedRange` of the current sheet progressively after its
  first visible tiles are available.
- Keep every backend range request at or below the existing 500-cell evidence
  limit.
- Retain loaded cells for the current browser session so returning to a
  previously visited location or sheet does not reload those cells.
- Make the dock checkbox selection the only source of blue workbook
  highlights.
- Preserve Excel-like range-selection behavior:
  - an ordinary drag replaces the checked/highlighted selection;
  - a Ctrl/Command drag adds a disconnected selection;
  - repeating a Ctrl/Command drag on the same range toggles that selection;
  - manually checking or unchecking a region immediately adds or removes its
    blue highlight;
  - no checked regions means no blue highlights.

## Non-Goals

- Removing or increasing the backend 500-cell range limit.
- Loading every sheet concurrently when a workbook opens.
- Downloading and reparsing the original workbook in the browser.
- Changing SourceDocument persistence or accepted WorkbookUnderstanding data.
- Solving the separate very-large-grid DOM virtualization limitation.

## Loading Design

The current sheet's metadata `usedRange` remains the grid's display domain.
Focusing a region scrolls that range into view; it does not replace the display
domain with the region's smaller range.

The frontend partitions the sheet domain into the existing 40-by-12 tiles.
Every tile therefore contains at most 480 cells. Loading has two priorities:

1. Request every tile intersecting the current viewport immediately.
2. After the visible tiles settle, fill the remaining current-sheet tiles in
   distance-from-viewport order with a maximum of three concurrent requests.

Switching workbooks or sheets cancels that scheduler generation and starts a
new queue for the selected sheet. In-flight responses remain keyed by document,
sheet, and range, so late responses cannot populate the wrong grid.

Fulfilled tile cells are merged into a session-scoped per-sheet cell cache.
Each sheet cache also retains completed and failed tile-key sets, so a
successfully read empty tile is not mistaken for a missing tile. The existing
bounded raw-response/request cache may discard old response objects, but the
normalized cells and tile completion state retain already loaded sheet
content. Returning to a visited sheet uses that state and only schedules
missing or explicitly retried tiles.

The toolbar shows unobtrusive progress for background hydration. Visible-tile
loading retains the current local skeleton treatment. A failed background tile
does not clear successful tiles; the sheet reports the incomplete state and
offers a retry that schedules only failed or missing tiles.

No provider or model call is added. Loading and scheduling are deterministic.

## Selection Design

The project workspace owns two separate states:

- `activeDraftRegionId`: the region shown in the structured interpretation
  editor and used as the navigation target.
- `selectedDraftRegionIds`: the regions checked for revision and rendered as
  blue highlights.

`WorkbookReviewDock` becomes controlled by `selectedDraftRegionIds` and emits
selection changes. Its checkboxes render that exact state. Activating a region
changes `activeDraftRegionId` and focuses it without silently changing other
checkboxes.

`WorkbookReviewWorkspace` receives the same selected ids and derives blue
editable regions from them. Detected source regions and reviewed analysis
inputs retain their existing red styling and do not become blue merely because
they exist.

Grid gestures update both the draft-region collection and the selected ids:

- ordinary drag: create or replace the active draft region and set the selected
  ids to only that region;
- Ctrl/Command drag on a new range: add the region and add its id to the
  selected ids;
- Ctrl/Command drag on the exact same range: remove/toggle that draft selection
  and its selected id.

When revisions reconcile client ids with server regions, invalid selected ids
are removed. A newly opened review initially selects its active region, but an
explicitly empty checkbox selection remains empty.

## Accessibility And Interaction

- Checkbox labels continue to include exact `Sheet!Range` references.
- Loading progress uses a status region without blocking grid interaction.
- The active review card remains visually distinct from checked blue ranges.
- Sheet tabs remain the loading boundary; switching tabs does not trigger
  concurrent reads for unopened sheets.
- Ctrl on Windows/Linux and Command on macOS share the additive behavior.

## Verification

Automated tests must prove:

- a sheet larger than 500 cells is fully hydrated without scrolling;
- visible tiles are requested before background-only tiles;
- no request contains more than 500 cells;
- requests are deduplicated and previously loaded cells survive navigation;
- switching sheets isolates queue generations and reuses retained cells;
- failed tiles can retry without clearing successful tiles;
- checkbox changes and blue cell classes stay synchronized;
- ordinary drag clears prior checked highlights;
- Ctrl/Command drag preserves existing highlights and adds or toggles the
  target range;
- activating a region does not silently rewrite the checkbox selection.

Manual browser QA must inspect a multi-sheet workbook larger than 500 cells,
confirm progressive completion, move immediately between distant cells after
completion, return to a visited sheet, and verify ordinary drag, Ctrl/Command
drag, checkbox toggles, focus, and retry behavior without console errors.

## Residual Risk

`react-data-grid` still renders the complete selected row and column domain with
virtualization disabled. This design removes repeated data fetch pauses but
does not make arbitrarily large Excel used ranges safe to render. A separate
virtualization milestone is required for workbooks whose used range is large
enough to exhaust browser DOM or memory limits.
