# Reference library navigation regression

Date: 2026-09-28. Status: repaired, deployed and verified; user retest pending.

The user began manual chat-panel testing and reported the Reference library
remaining above Overview after navigating away. Reproduced on the deployed
application's production build with synthetic data: after opening References and
switching to Overview, one library region remained when zero was expected.

Root cause: ReferenceLibrary and AgentPanel were siblings with the same React
key, both derived only from actor/project. React could retain orphaned content
during reconciliation. Give each component a distinct key prefix while preserving
actor/project isolation. No API, schema, permissions or scientific behavior changes.

Expected behavior:

- References in the top navigation and Library in Ask open the same workspace.
- Switching to Overview, Browser, Manuscript or Home unmounts the library.
- Closing Ask only closes the assistant; an active References workspace stays.
- Reopening Ask preserves the current draft. Repeated navigation creates neither
  duplicate libraries nor duplicate assistants.
- On narrow screens, Library closes the assistant to expose the workspace;
  leaving References removes its content normally.

Verification: preflight, 83 focused frontend tests, production build and the
real Chromium/HTTP/PostgreSQL scenario in
`backend/scripts/unified-ask-browser-check.mjs` passed. The new before-fix assertion
failed with `1 !== 0` for a library left on Overview. The fixed run passes repeated
navigation, assistant close/reopen, draft preservation, mobile navigation and
existing upload/mention/citation/version/archive/cross-device scenarios. No page
errors, provider calls or production research writes occurred. The provider and
region confirmation in the browser fixture are substitutes, not scientific QA.

Local logs: `.tmp/reference-navigation-before.log`,
`.tmp/reference-navigation-unit.log`, `.tmp/reference-navigation-build.log`,
`.tmp/reference-navigation-after.log`. Screenshots in `.tmp/unified-ask-browser/`
include `reference-library-closed-desktop.png` and `reference-library-closed-mobile.png`.

The first test attempt used the previous database port; the test-owned server
was on loopback port 5432. The first UI locator was ambiguous because Overview has
two Open Experiment Browser buttons; using its heading fixes the assertion target.
These harness corrections preceded the successful before/after reproduction.

Manual acceptance remains in progress; the Q01 fixed-answer question and the
remaining reference/Excel/cross-device checklist have not been reported as passed.

Fresh pre-release backup: `/var/backups/labrat/reference-navigation-20260928`,
set `20260928184608`; database gzip and uploaded-file archive integrity passed.
No migration is added. The test-owned browser/server processes and test database
were shut down after verification; no other database clients were connected.

## Deployment result

- Application commit `d6d1459aaf2a4dac07df62df3938bbdc305e76f7` is on main.
- [Workflow 36467608805](https://github.com/Thesclhy/LabRat/actions/runs/36467608805)
  passed frontend/backend/PostgreSQL tests, builds and the deployment.
- Active release: `/opt/labrat/releases/20260928185114-d6d1459aaf2a`.
- Backend active; local/public health, exact HTML/JS/CSS hashes and unauthenticated
  API rejection passed. Existing migration 037 checksum and task schema verified.
- Provider remains Anthropic / claude-sonnet-4-5. No production research records
  or model calls were made by verification.
- Safe receipt: [reference-library-navigation-live.json](reference-library-navigation-live.json),
  completed at `2026-09-28T18:51:43.509Z`.

Refresh the existing browser page to load the new bundle and clear the already
orphaned DOM. Retest References -> Overview, Library from Ask -> Overview, and
closing/reopening Ask while References is selected. User retest is pending.
Documentation is committed separately with `[skip ci]`.
