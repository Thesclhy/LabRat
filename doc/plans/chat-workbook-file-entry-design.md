# Chat Workbook File Entry Design

Status: approved for implementation planning
Last reviewed: 2026-07-22

## Problem

After a workbook is uploaded through LabRat chat, the assistant currently adds
one button for every detected source region. A workbook with many detected
regions produces a long list such as `Select Sheet!A1:D20`. This duplicates the
region list already owned by Workbook Review and makes multiple uploaded files
hard to distinguish.

The current region buttons also carry only range-level data. Clicking a button
from an older upload does not first reload that upload's exact
WorkbookReviewSession, so the action can be applied while a different workbook
is active.

## Approved Direction

Each successful chat upload creates one file-level button labelled with the
workbook filename. Clicking it loads the exact WorkbookReviewSession associated
with that chat message and opens the existing Workbook Review workspace. The
workspace remains the only place that lists, focuses, revises, confirms,
ignores, or deletes the workbook's regions.

Do not expand region buttons inside chat and do not create a separate modal or
second region-review surface.

## User Experience

For `MasterTable_updated.xlsx`, the assistant message contains:

- a short indexing result, including the detected-region count when available
- one button labelled `MasterTable_updated.xlsx`

For `Calculation Exp31.xlsx`, the assistant creates a separate message with one
button labelled `Calculation Exp31.xlsx`, regardless of how many regions were
detected.

Selecting either button:

1. resolves the exact `workbookReviewSessionId` stored on that message
2. reloads the session through the existing authenticated session-detail API
3. replaces the active Workbook Review state with that session's SourceDocument
   and WorkbookReviewRegions
4. opens the Workbook Review tab
5. focuses the first active region that still needs review, falling back to the
   first active region

The right-side Workbook Review region list then exposes every selection for the
chosen file. Chat does not duplicate those controls.

## Client Message Contract

The upload-result assistant message stores one serializable file link:

```text
workbookReviewLink
  workbookReviewSessionId
  sourceDocumentId
  workbookName
  regionCount
```

The link is project-scoped through the existing project-specific chat-history
key. It contains no workbook cells, region interpretations, provider secrets,
or scientific values.

The implementation removes newly generated `workbookSuggestions` arrays from
chat upload replies. Compatibility migration for old local chat messages is out
of scope while the product remains in development; users can reset old chat
history. Server WorkbookReviewSession and WorkbookReviewRegion persistence are
unchanged.

## Component Boundaries

- `AgentPanel` creates and renders the file-level link after upload.
- The application shell owns opening a link because it owns active project,
  Workbook Review state, and tab selection.
- `WorkbookReviewWorkspace` and `WorkbookReviewDock` remain unchanged in
  responsibility: they display the workbook and its region-level controls.
- Existing upload, session-create, and session-detail APIs are reused. No new
  backend route or database field is required.

## Error Handling

- A missing session id prevents navigation and shows a bounded chat error.
- A deleted, unavailable, or cross-project session reports the server error and
  leaves the current Workbook Review state unchanged.
- A workbook with zero detected regions still gets one filename button so the
  user can open the workbook and create a region manually.
- Repeated filenames remain distinct because navigation uses immutable session
  ids rather than filenames.

## Verification

- One upload renders exactly one filename button and no `Select Sheet!Range`
  buttons.
- A multi-region workbook still exposes all regions after its filename button
  opens Workbook Review.
- Two uploaded files create two independent chat buttons; clicking each one
  fetches and displays its exact session and regions.
- A restored project-scoped chat history retains functional file links.
- Zero-region, missing-session, repeated-filename, and failed-session cases are
  covered.
- Desktop and narrow-screen QA confirm that long filenames wrap without
  overflowing the LabRat panel.
- Run focused AgentPanel/ProjectDashboard tests, the complete frontend suite,
  and `npm run build`.

## Out Of Scope

- Region detection or interpretation changes
- WorkbookReviewRegion API or persistence changes
- DataPlan, DataSnapshot, Experiment Browser, chart, or manuscript behavior
- Inline chat accordions containing all workbook regions
- A new workbook-review modal
