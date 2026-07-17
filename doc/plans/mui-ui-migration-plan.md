# MUI UI Migration Plan

Status: planning
Created: 2026-06-25
Read when: planning or implementing the full LabRat frontend migration from hand-written CSS controls to Material UI.

## Summary

LabRat should migrate toward a Material UI based design system, but not through a one-shot frontend rewrite.

Target stack:

```text
React 19 + Vite
Material UI
Emotion styling engine
LabRat dense scientific theme
LabRat wrapper components
Legacy CSS only for canvas, Plotly, source-grid, and special interaction surfaces
```

The goal is not to make LabRat look like default Material Design. The goal is to use MUI as the component and theming substrate while preserving LabRat's mature, dense, source-backed research workflow style.

Official docs used for this plan:

- Material UI installation: https://mui.com/material-ui/getting-started/installation/
- Material UI theming: https://mui.com/material-ui/customization/theming/
- Material UI themed components: https://mui.com/material-ui/customization/theme-components/
- MUI X overview: https://mui.com/x/introduction/

## Decision

Adopt MUI as the long-term frontend UI framework, but migrate in controlled slices.

Default dependency set for the first migration slice:

```bash
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material
```

Do not add MUI X in the first slice. Evaluate `@mui/x-data-grid` only after the Project Overview, dialogs, import review, chart review, and Browser table requirements are clearer. MUI X may be useful for dense data tables, but it adds API, bundle, and licensing considerations that should not block the base migration.

## Migration Principles

- Keep LabRat a dense scientific workbench, not a marketing UI.
- Build a LabRat theme before replacing page surfaces.
- Prefer local LabRat wrapper components over direct scattered MUI usage.
- Preserve existing API, project state, chart proposal, ChartSpec, WorkbookReviewSession, SourceDocument, and Manuscript data shapes.
- Do not replace canvas, red-box selection, Plotly rendering, drag/resize, or workbook-grid internals with MUI components in early phases.
- Use MUI for controls, panels, dialogs, menus, tabs, toolbars, chips, tables, and form fields.
- Keep all scientific mutations behind existing review boundaries.

## Target Frontend Shape

Add a small UI layer:

```text
src/ui/theme.js
src/ui/AppTheme.jsx
src/ui/LabButton.jsx
src/ui/LabDialog.jsx
src/ui/LabCard.jsx
src/ui/LabTextField.jsx
src/ui/LabSelect.jsx
src/ui/LabStatusChip.jsx
src/ui/LabToolbar.jsx
```

Use `ThemeProvider` and `CssBaseline` at the React root:

```jsx
<ThemeProvider theme={labRatTheme}>
  <CssBaseline />
  <App />
</ThemeProvider>
```

The theme should define:

- compact density
- 30-32px default button height
- subdued scientific palette
- restrained border radius
- predictable focus-visible ring
- compact typography for dashboards, review panels, modals, and toolbars
- clear warning/error/success/info state colors
- component defaults for `Button`, `IconButton`, `TextField`, `Select`, `Tabs`, `Menu`, `Dialog`, `Chip`, `Paper`, `Table`, `Tooltip`, and `Alert`

## Phase 1: Foundation

Goal: install and configure MUI without broad visual churn.

Implementation:

- Install base MUI dependencies.
- Add `src/ui/theme.js` and `src/ui/AppTheme.jsx`.
- Wrap the app root with `ThemeProvider` and `CssBaseline`.
- Add wrapper components for the controls used most often.
- Keep `src/styles.css` active.
- Do not migrate Manuscript canvas, WorkbookReviewWorkspace grid, Plotly charts, or SourceDocument red-box overlays.

Acceptance:

- App renders with no visual regression outside minor baseline CSS normalization.
- Existing tests pass.
- Build passes with only known Plotly chunk warnings.

Verification:

```bash
npm test
npm run build
```

## Phase 2: App Shell, Project Dashboard, And Overview

Goal: move low-risk navigation and project surfaces to MUI components.

Migrate:

- Topbar / File menu / project context
- Project dashboard table/list
- Project detail panel
- Project Overview cards
- New project modal
- Delete project modal
- Project profile modal

Use:

- `AppBar` only if it can remain compact; otherwise use `Box`/`Stack` with theme tokens.
- `Menu` for File/project actions.
- `Paper` for repeated cards.
- `Button`, `IconButton`, `Tooltip`, `Chip`, `Tabs`, and `Dialog`.

Do not:

- introduce a router
- change workspace state semantics
- change project open/delete/profile APIs

Acceptance:

- Project dashboard still opens projects from the row `Open` button.
- Project switcher/File menu remains compact.
- Overview cards remain dense and workflow oriented.
- `Compare Series`, `Charts`, `Workbook Review`, and Manuscript entrypoints remain distinct.

Verification:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
npm test
npm run build
```

Manual QA:

- login
- project creation/open/delete
- topbar File menu
- project overview at desktop/tablet/narrow widths

## Phase 3: Common Dialogs, Forms, And Status Surfaces

Goal: standardize modal and form behavior before migrating complex workflow panels.

Migrate:

- generic confirmation dialogs
- error/loading/empty surfaces
- profile forms
- refresh/upload forms
- status chips and badges
- common toolbar/action rows

Use:

- `Dialog`
- `DialogTitle`
- `DialogContent`
- `DialogActions`
- `Alert`
- `CircularProgress`
- `LinearProgress`
- `TextField`
- `Select`
- `FormControl`
- `Checkbox`
- `Switch`
- `Chip`

Acceptance:

- All dialogs have consistent spacing, close affordances, focus behavior, and action hierarchy.
- Error/loading/empty states are visually distinct.
- No modal overflows on narrow screens.

Verification:

```bash
npm test
npm run build
```

Manual QA:

- open/close dialogs with mouse and keyboard
- verify focus does not get trapped incorrectly
- verify action buttons stay visible in short viewport heights

## Phase 4: Workbook Review And Import Review Surfaces

Goal: modernize review workflow chrome while preserving workbook/source evidence interactions.

Migrate:

- WorkbookReviewSession shell
- upload/review status panels
- Ask LabRat composer shell
- review action bars
- warning/confidence/provenance badges
- region/draft metadata panels
- import/review modal chrome

Do not migrate:

- workbook grid internals
- red-box overlay geometry
- source cell rendering
- drag/right-click selection logic
- bounded range read behavior

Use:

- `Tabs` for review modes
- `Paper` for region/workflow panels
- `Alert` for warnings
- `Chip` for status/confidence
- `ButtonGroup` or compact `Stack` for action rows
- `TextField` for correction input

Acceptance:

- Workbook grid still scrolls correctly.
- Red boxes still render and remain selectable/editable.
- Chat correction plus red-box review loop remains intact.
- No UI implies upload automatically creates DatasetCommit, ChartSpec, or Manuscript content.

Verification:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
npm test
npm run build
```

Manual QA:

- upload workbook
- inspect SourceDocument range
- select or edit red boxes
- submit natural-language correction
- confirm refreshed draft preview remains review-only

## Phase 5: Chart Review, Analysis Views, And Approved Charts

Goal: migrate chart workflow UI without changing proposal or ChartSpec semantics.

Migrate:

- ChartReviewModal shell
- one-chart prompt surface
- chart proposal rows/cards
- accepted/pending/rejected filters
- AnalysisView / Compare Series cards
- approved chart management rows
- chart spec metadata panels

Use:

- `Tabs` or segmented MUI controls for modes
- `Paper`/`List` for proposal rows
- `Chip` for proposal status/origin
- `Alert` for stale or invalid evidence
- compact `Button` actions for Accept, Reject, Delete, Create ChartSpec, Insert

Do not:

- change chart proposal schema
- create ChartSpecs before explicit review action
- insert Manuscript content from raw prompt or unaccepted proposal

Acceptance:

- Chart proposals remain reviewable.
- Accepted/pending management remains clear.
- Compare Series remains an AnalysisView-backed workflow.
- Source-backed and analysis-view-backed origins are visible when available.

Verification:

```bash
npm test -- src/components/BackendScanPanel.test.jsx src/components/ProjectDashboard.test.jsx
npm test
npm run build
```

Manual QA:

- draft chart proposal
- accept/reject/delete proposal
- create ChartSpec
- compare series
- source-backed chart draft where available

## Phase 6: Browser And Tables

Goal: improve dense data browsing without prematurely committing to MUI X.

First pass:

- Keep existing table model.
- Wrap filters, tabs, search, status, and empty states in MUI.
- Use `Table` only where it does not degrade density or performance.
- Keep current browser-row derivation behavior.

Second pass decision:

- Evaluate `@mui/x-data-grid` for imported data and source/document tables.
- Add it only if the app needs virtualization, column pinning, built-in filtering, or large-table ergonomics that justify the dependency.

Acceptance:

- Browser still separates curated/imported/source-backed rows correctly.
- Supplemental observation rows are not coerced into fake experiments.
- Date formatting and mapped-field display remain correct.
- Narrow viewports do not horizontally overflow except intentional table scroll.

Verification:

```bash
npm test -- src/components/GenericImportBrowser.test.jsx
npm test
npm run build
```

## Phase 7: Manuscript Shell Only

Goal: migrate Manuscript workspace controls while leaving canvas internals stable.

Can migrate:

- top toolbar
- sidebar/approved charts panel
- inspector controls
- menus
- simple dialogs
- property forms

Do not migrate early:

- `SelectionFrame`
- draggable/resizable block DOM
- chart layer selection
- Plotly rendering container
- text edit layer
- keyboard movement/delete behavior

Acceptance:

- block selection works
- drag works
- resize works
- keyboard movement works
- delete works
- text edit works
- chart layer selection works
- chart insertion and save still work

Verification:

```bash
npm test -- src/components/ManuscriptCanvas.history.test.jsx
npm test
npm run build
```

Manual QA is required for this phase.

## CSS Retirement Strategy

Do not delete `src/styles.css` in Phase 1.

Retire CSS in categories:

```text
MUI-owned controls
  -> move into theme overrides or LabRat wrappers

workflow layouts
  -> migrate case by case to Box/Stack/Grid/Paper

canvas/source-grid/chart internals
  -> keep custom CSS

dead legacy selectors
  -> delete only after rg confirms no usage
```

Use clear comments during migration:

```css
/* MUI bridge: remove after ProjectOverview migration */
/* Canvas-only: keep custom */
/* Legacy pending removal */
```

## Test And QA Matrix

Every implementation slice:

```bash
npm test
npm run build
git diff --check
```

Run backend tests only if API helpers, backend contracts, or persisted data behavior change:

```bash
npm --prefix backend test
```

Manual QA for major UI phases:

- login
- project creation/open/delete
- File menu and topbar
- upload workbook review
- workbook grid scroll
- red-box creation/editing
- Ask LabRat correction composer
- chart proposal review
- compare series
- approved chart management
- Browser imported/curated/source-backed data
- Manuscript insert/select/drag/resize/edit/save
- desktop/tablet/narrow viewport

## Rollout Plan

Recommended sequence:

1. MUI dependencies, theme, wrappers, root provider.
2. Topbar, Project Dashboard, Project Overview.
3. Common dialogs, forms, status surfaces.
4. Workbook Review and Import Review chrome.
5. Chart Review, Compare Series, approved charts management.
6. Browser filters/tables.
7. Manuscript toolbar/sidebar/inspector only.
8. CSS retirement and bundle-size review.

Each step should be a separate PR or Codex milestone with focused tests and `doc/PROGRESS.md` updated.

## Risks

- MUI defaults may make the app too spacious or visually generic.
- Theme overrides can become a second unstructured CSS system if wrapper components are skipped.
- Dialog/focus behavior can regress keyboard workflows.
- MUI components may interfere with canvas pointer/focus behavior if used inside the canvas core.
- Bundle size may increase, especially if MUI icons or MUI X are imported carelessly.
- Large `src/main.jsx` makes broad UI migration harder; extract small components only when it reduces migration risk.

## Non-Goals

- Do not introduce a router as part of the MUI migration.
- Do not convert to TypeScript as part of the first UI migration slice.
- Do not change backend APIs, project state shape, workbook understanding shape, ChartSpec shape, or Manuscript block schema.
- Do not replace Plotly.
- Do not replace `react-data-grid` workbook/source preview until there is a separate grid-specific decision.
- Do not make Manuscript canvas internals MUI-driven in the initial migration.

## Acceptance For Full Migration

The migration is complete when:

- core app surfaces use MUI theme and LabRat wrapper components
- `src/styles.css` is reduced to custom canvas/source-grid/chart/layout rules
- controls have consistent dense sizing and focus states
- dialogs/forms/tabs/menus/buttons/chips are consistent
- all current frontend tests pass
- build passes
- manual QA confirms workbook review, chart review, Browser, and Manuscript interaction paths still work
- the app still feels like a mature scientific workflow tool, not a generic Material Design template
