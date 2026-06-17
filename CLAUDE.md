# CLAUDE.md

Guidance for Claude Code working in this repository.

## Role boundary: frontend only

I work on the **frontend only** and must **never modify backend files**. Treat the
backend as a read-only contract: I may read it to understand API shapes, but I do
not edit, create, delete, or move files inside it.

### Off-limits (backend — do not modify)

- `backend/` — the entire Node API server, including:
  - `backend/src/**` — server, routes, import/chart/SaaS services, AI calls
  - `backend/migrations/**` — SQL migrations
  - `backend/package.json`, `backend/package-lock.json`, `backend/README.md`
- `docker-compose.yml` — orchestrates Postgres + backend + frontend (infra, not frontend)
- `backend/migrations/*.sql` and any database schema

If a task seems to require a backend change, stop and flag it instead of editing —
propose the change and let a human apply it on the backend side.

### Editable (frontend)

- `src/**` — all React/Vite application code:
  - `src/main.jsx` — root `App` component, state, routing, API wiring
  - `src/components/**` — UI and workflow components
  - `src/data/**` — frontend API clients (`serverApi.js`, `backend*Api.js`) and state helpers
  - `src/charts/**` — Plotly rendering
  - `src/storage/**` — localStorage / IndexedDB fallback
  - `src/utils/**`, `src/export/**` — helpers, PPTX export
  - `src/styles.css`, `src/test/**`
- `index.html` — Vite HTML entry
- `public/**` — static assets (logo, templates)
- `vite.config.js`, `vitest.config.js` — frontend build/test config
- `package.json`, `package-lock.json` (root) — frontend dependencies and scripts

> Note: `src/data/serverApi.js` and `src/data/backend*Api.js` are **frontend clients**
> that call the backend over HTTP. Editing these is fine — they live in `src/`. Only
> the `backend/` server implementation is off-limits.

## Commands

All commands run from the repo root.

```bash
npm install        # install frontend dependencies
npm run dev        # start Vite dev server (blank mode, host 0.0.0.0)
npm run build      # production build — minimum verification after changes
npm run preview    # preview the production build
npm test           # frontend tests (Vitest)
```

- Run `npm run build` as the minimum check after any code change.
- For import / data / chart work, also run `npm test`.
- The backend's own commands (`npm --prefix backend test`, etc.) exist but are **not
  my responsibility** — do not run backend builds/migrations as part of frontend work
  unless explicitly asked.

## Stack notes

- React 19 + Vite 6, JSX only (no TypeScript).
- No router and no external state library — state lives in the root `App` in `src/main.jsx`.
- Plotly via `plotly.js-dist-min`; Excel via `xlsx`; PPTX via `pptxgenjs`.
- The frontend talks to the backend through `fetch` clients in `src/data/`
  (session-cookie auth, `credentials: "include"`). Keep request/response shapes in
  sync with the backend contract rather than changing the backend to match.

## Further reading

`AGENTS.md` and the `doc/` folder (`ARCHITECTURE.md`, `backend-api-contract.md`,
`ai-boundaries.md`, etc.) document the full system and API contract.
