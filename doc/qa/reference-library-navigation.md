# Reference library navigation regression

Date: 2026-09-28. Status: repaired and verified locally; deployment in progress.

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
