# Invitation Onboarding And Lab Management

Status: implemented and locally verified; main publication/deployment authorized
Last reviewed: 2026-09-12

Implement the approved invitation-only flow on `codex/backend-v1-architecture`:
platform admin invites an owner; owner registers and creates one Lab; Lab
managers invite members; members receive no projects until explicitly granted.

- One-use, seven-day cryptographic invitation codes; hashed storage, once-only
  disclosure, bounded lists, revocation and issuer revalidation.
- Registration atomically creates user, Lab/membership, session, redemption and
  audit. Existing users redeem without changing credentials.
- Project presets: view (read/export), edit (+propose), approve (+approve).
  Atomic direct-grant replacement uses expectedGrantId. Inherited and
  selected-experiment grants are not silently replaced.
- Membership removal/rejoining clears only that Lab's prior direct grants and
  group memberships, never research records or other Labs.
- Public entry limits: preview 30/IP/minute; register/redeem together 10/IP/minute;
  bounded single-process storage, 8 KiB body limit, production loopback proxy trust.
- React login/registration, platform invitations, Lab members/invitations/access,
  capability-driven actions, immutable read-only canvas and stale-request isolation.
- Excluded: experiment/group management UI, billing, email/SMS, ownership transfer,
  main merge, remote deployment. Password recovery uses existing admin support.

## Milestones

- [x] Invitation persistence, transactions and security/HTTP APIs.
- [x] Atomic project member access and safe membership removal/rejoin.
- [x] OpenAPI, generated client, registration and management UI.
- [x] Capability-driven workspace and request lifecycle protection.
- [x] Unit/PostgreSQL/browser verification, full gate and final documentation.

## Verification — 2026-09-11

- `npm run codex:verify` passed: frontend 324/324, Nest v1 56/56, legacy
  backend 269 passed / 5 expected conditional skips, generated-type freshness,
  TypeScript build, production entry smoke and Vite production build.
- `npm --prefix backend run test:postgres` passed against isolated PostgreSQL:
  legacy 2/2, Nest v1 9/9. Migration coverage includes fresh schema, existing
  migration 027 database upgraded to 028, and repeated startup/migration.
- Invitation HTTP coverage includes concurrent redemption, username conflicts,
  an injected final audit-write failure with complete transaction rollback,
  issuer validation, revocation/expiry, permission conflicts, inherited access,
  cross-lab isolation and membership removal/rejoin cleanup.
- Unit/HTTP tests cover request body limits, shared authentication quotas,
  forwarded-header spoofing, forbidden identity/role inputs, read/edit/approve
  controls, immutable readonly canvas and discarded stale responses.
- Real Chromium acceptance used separate platform, owner and employee sessions
  with the actual Nest API and disposable PostgreSQL schema. It verified signup,
  automatic login/refresh, no-lab platform management, project creation,
  invitation disclosure, employee waiting state, the three project presets,
  readonly API denial, editable manuscript persistence, next-request revocation,
  signed-in rejoining without prior grants and no browser-persisted secrets.
  Approval controls are additionally exercised in component and backend suites;
  browser acceptance does not make live AI calls or publish new scientific data.
- Screenshots of management, waiting, readonly and editing states were reviewed.
  The UI-only mocked smoke is supplementary, not database acceptance.

## Reproduce browser acceptance

`backend/scripts/invitation-browser-check.mjs` orchestrates
`scripts/qa/invitation-browser-live.py`. Build the backend first, then run
`node backend/scripts/invitation-browser-check.mjs` with:

- `LABRAT_TEST_DATABASE_URL`: dedicated disposable PostgreSQL on 127.0.0.1,
  never a production database or a production SSH tunnel.
- `LABRAT_QA_PYTHON`: Python executable with Playwright available.
- `LABRAT_QA_CHROMIUM`: installed Chromium executable.
- Optional `LABRAT_QA_OUTPUT`: local screenshot output directory.

Ports 8799 and 5189 must be free. The runner seeds synthetic identities in a
unique test schema, disables AI credentials/execution, and removes its schema
and HTTP servers on exit. It does not provision PostgreSQL or install project
dependencies. `scripts/qa/invitation-ui-smoke.py` is the separate mocked smoke.

Docker Desktop could not start on this machine, so verification used an isolated
PostgreSQL 16.14 cluster under `.tmp`, bound only to 127.0.0.1. No existing
database, Docker volume or production service was reset or modified.
All test servers are stopped. The temporary PostgreSQL cluster stalled during
shutdown; its verified test-only processes were terminated and files retained.
Use a fresh disposable cluster for another acceptance run.

## Handoff

Usage and endpoint details are in `doc/contracts/invitation-onboarding-v1.md`.
The implementation was completed on `codex/backend-v1-architecture`. On
2026-09-12 the user requested promotion to `main` and explicitly confirmed
the automatic Lightsail production deployment. Full local verification passed
again; an ordinary fast-forward push preserves all remote main history.
The production result must be read from the workflow and health check, not
inferred from a successful Git push. Existing conditional test skips and the
Vite large-chunk warning are unchanged.
