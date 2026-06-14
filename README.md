# LabRat Blank

LabRat Blank is the new-user LabRat workspace. The long-term product goal is a reproducibility-first research command center: LabRat turns scattered lab files into a versioned, browsable, source-backed dataset, then carries that data into charts, manuscript figures, and PPTX output.

The current blank app starts with an empty project and already guides users from raw Excel workbooks through import review, generic normalization, semantic mapping proposals, chart proposals, manuscript layout, and PPTX export.

This folder is intentionally separate from `D:\project\labrat`, which remains the research/demo project. This blank copy does not include `public/labratData.json`, does not preload HDPE research data, and does not import example templates automatically.

## Quick Start

```bash
npm install
npm run dev
```

`npm run dev` starts blank mode by default in this copy. Vite will print the local URL, usually `http://localhost:5173`.

Build the blank-mode production bundle with:

```bash
npm run build
```

The explicit aliases also remain available:

```bash
npm run dev:blank
npm run build:blank
```

Run the backend import service separately when testing backend scan/normalize/mapping/chart-proposal flows:

```bash
npm --prefix backend run dev
```

## Blank Project Behavior

- Starts from an empty dataset when no saved blank project exists.
- Does not fetch `public/labratData.json`.
- Does not create sample experiments, measurements, generic imports, mapping sets, or chart proposals.
- Uses blank-specific browser storage so it does not read saved projects from the demo/research app on the same origin.
- Keeps the legacy HDPE `MasterTable.xlsx` folder import as a secondary compatibility option.

## Current Workflow

The intended product path is:

```text
raw files
  -> import proposals
  -> human review
  -> dataset commits
  -> Experiment Browser
  -> methodology versions and recompute proposals
  -> chart specs
  -> manuscript canvas
  -> PPTX export
```

The current app already supports backend workbook scan, approved normalization, semantic mapping proposals, chart proposal review, local project persistence, manuscript layout, and PPTX export. Dataset commits, methodology versions, recompute proposals, cloud storage, and audit logs are target architecture concepts documented for future implementation.

The next major UX goal is making backend-uploaded generic data first-class in Experiment Browser while preserving provenance.

## Example Templates

Example-only workbook templates are available under `public/templates/` and from the blank onboarding UI:

- `public/templates/generic-import-template.xlsx`
- `public/templates/block-import-template.xlsx`

These templates contain placeholder example rows only. They are formatting references, not active project data, and they are never imported automatically.

## Development Checks

```bash
npm test
npm --prefix backend test
npm run build
```

The backend scan, normalize, semantic mapping, and chart proposal endpoints are kept in this source copy so user-uploaded workbooks can use the existing review workflow.

## Documentation Map

- `AGENTS.md`: working instructions for AI coding agents.
- `doc/ARCHITECTURE.md`: product and technical architecture, including proposal/commit/methodology/provenance concepts.
- `doc/ROADMAP.md`: staged plan from generic Experiment Browser support to methodology versioning, cloud, and MCP integration.
- `doc/plan.md`: short current execution plan.
- `doc/backend-api-contract.md`: backend endpoint contracts.
- `doc/canonical-data-dictionary.md`: shared data terminology.
- `doc/ai-boundaries.md`: AI safety and review rules.
- `doc/implementation-milestones.md`: compact implementation checklist.
- `doc/import-examples.md`: parser examples and expected behavior.
- `doc/PROGRESS.md`: durable project progress log.
