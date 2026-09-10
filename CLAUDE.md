# CLAUDE.md

Guidance for Claude Code working in this repository.

## Scope: full stack

I may edit both the frontend and the backend. The two sides share one API
contract, so a change that alters a request or response shape updates the
client in `src/data/`, the server in `backend/src/`, and the contract doc in
`doc/contracts/` in the same change.

### Frontend

- `src/**` — all React/Vite application code:
  - `src/main.jsx` — root `App` component, state, routing, API wiring
  - `src/components/**` — UI and workflow components
  - `src/data/**` — frontend API clients (`serverApi.js`, `*Api.js`) and state helpers
  - `src/hooks/**` — shared React hooks
  - `src/charts/**` — Plotly rendering
  - `src/storage/**` — localStorage / IndexedDB fallback
  - `src/utils/**`, `src/export/**` — helpers, PPTX export
  - `src/styles.css`, `src/test/**`
- `index.html`, `public/**`, `vite.config.js`, `vitest.config.js`
- `package.json`, `package-lock.json` (root) — frontend dependencies and scripts

### Backend

- `backend/src/server.js` — Node HTTP server entry
- `backend/src/saas/**` — routes, stores (in-memory and Postgres), auth,
  workbook review, analysis threads, executors, chart templates
- `backend/src/import/**` — workbook scanning and parsers
- `backend/src/ai/**` — provider gateway and structured-output validation
- `backend/migrations/**` — SQL migrations, numbered and append-only
- `backend/package.json`, `backend/package-lock.json`

Backend rules that must hold:

- New persisted shapes get a new migration; never edit an applied migration.
- Keep in-memory store and Postgres store behaviour in parity, with tests for both.
- Model access stays server-side. The frontend never calls a provider directly.
- Review boundaries in `doc/arch/ai-boundaries.md` are not to be bypassed:
  upload publishes nothing, execution creates no ChartSpec, acceptance is explicit.

### Infrastructure

- `docker-compose.yml` orchestrates Postgres, backend, and frontend. Edit it only
  when a task clearly needs it, and say so in the summary.

## Commands

All commands run from the repo root.

```bash
npm install                  # frontend dependencies
npm --prefix backend install # backend dependencies
npm run dev                  # Vite dev server (blank mode, host 0.0.0.0)
npm run build                # frontend production build
npm test                     # frontend tests (Vitest)
npm --prefix backend test    # backend tests (node --test, in-memory store)
npm --prefix backend run test:postgres  # Postgres route tests (needs a database)
npm --prefix backend run migrate        # apply migrations
npm run codex:verify         # frontend tests + backend tests + build
npm run dev:docker           # full stack via Docker Compose
```

Minimum verification:

- Frontend-only change: `npm run build`, plus `npm test` for import / data / chart work.
- Backend change: `npm --prefix backend test`, plus `test:postgres` when a store or
  migration changed and a database is available.
- Change touching both sides or a contract: `npm run codex:verify`.

## Stack notes

- Frontend: React 19 + Vite 6, JSX only (no TypeScript). No router and no
  external state library — state lives in the root `App` in `src/main.jsx`.
  Plotly via `plotly.js-dist-min`; Excel via `xlsx`; PPTX via `pptxgenjs`.
- Backend: plain Node HTTP server, no framework. Postgres via `pg`, JSON Schema
  validation via `ajv`, workbook parsing via `xlsx`. Tests use `node --test`.
- The frontend talks to the backend through `fetch` clients in `src/data/`
  (session-cookie auth, `credentials: "include"`).

## Further reading

`AGENTS.md`, `doc/START_HERE.md`, and the `doc/` folder (`arch/architecture.md`,
`contracts/saas-api-contract-v0.md`, `arch/ai-boundaries.md`, etc.) document the
full system, review boundaries, and API contract. Read `doc/START_HERE.md` first
for any non-trivial task.
