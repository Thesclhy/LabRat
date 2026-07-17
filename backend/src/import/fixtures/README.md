# Import Fixtures

This folder contains synthetic fixtures for parser/import/source-understanding tests.

- `workbookFixtures.js` builds in-memory synthetic `.xlsx` workbooks during tests.
- `workflowScenarioFixtures.js` describes non-workbook review scenarios such as source-backed chart extracts, missing experiment prompts, and natural-language import corrections.
- `real-workbooks/` is intentionally ignored and must contain only private local workbooks for manual/regression checks. Do not add real `.xlsx` files to Git.

Phase 0 fixture coverage maps to `doc/plan.md`:

- multi-sheet workbook with one valid source range
- ambiguous source range
- high-confidence regular table that should auto-box a source region
- low-confidence messy sheet that requires manual box selection
- accepted source extract that is chart-local only
- reaction-rate supplements for multiple experiments
- missing experiment prompt
- import correction examples
