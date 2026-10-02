# Docling / Lightsail 8GB deployment

Started: 2026-10-01 (America/New_York); continued 2026-10-02.
Status: 8GB instance and Docling application deployed; hosted Q&A follow-up in progress.

The user authorized upgrading the 2GB production instance to the 8GB IPv4
Lightsail plan ($44/month), retaining the original instance for rollback, and
deploying the locally verified Docling page implementation.

## Preparation

- Verified AWS account 477611841179 through the existing local default CLI
  profile. The `labrat` SSO profile is expired; no credentials were printed.
- Current instance: `labrat-prod-1`, `us-east-1a`, Ubuntu 24.04, bundle
  `small_3_0` (2GB / 2 vCPU), static IP `labrat-prod-ip` (100.50.25.194).
- Existing application: `c8a586963e5f`; backend, PostgreSQL and Caddy healthy.
- New plan verified from the account API: `large_3_0`, 8GB / 2 vCPU / 160GB,
  $44/month. Keep the IPv4 address and existing deployment SSH key.
- Pre-upgrade database and files backup: UTC `20261002030236`, under
  `/var/backups/labrat/pre-docling-8gb-20261001`. Gzip and tar integrity passed.
- Snapshot `labrat-pre-docling-8gb-20261001` available; creation succeeded.
  Operation: `4cf90e93-395a-44cf-8919-7c81582780fd`.
- Created `labrat-prod-8gb-20261001` from the snapshot in `us-east-1a`, bundle
  `large_3_0`. AWS reports 8GB / 2 vCPU; OS reports 7,816MiB RAM and 145GiB
  free disk. Its initial temporary public address was 3.94.150.222. The existing
  static IP now points at the new instance. Creation operation:
  `da983eeb-e2f1-4957-8242-1dde3882ae07`.
- Verified new-host SSH keys against AWS access details. Cloud-init completed;
  backend, Caddy and cron are stopped/disabled during validation. Both production
  task counts were zero before clone validation.
- Initial Linux dependency resolution backtracked across many incompatible
  transitive versions. Stopped only its verified provisional pip process;
  retry used the tested Windows versions as constraints (not as a Linux lock).
  Actual Linux resolution is exported to `requirements-linux.lock` and
  `pip check` passes. All 26 frozen model assets verified. Formal deployment
  installation and conversion validation passed. Git attributes preserve the
  manifest's frozen byte hash across Windows/Linux.
- Added parser resource checks, a dedicated systemd service, offline conversion
  smoke, atomic private environment updates, parser rollback and pre-migration
  backups to the release pipeline. CPU-only Linux Torch/vision versions are
  locked. Dedicated systemd service and synthetic conversion passed (8.19s).
- Existing provider/release rollback and new parser switching checks passed on
  Linux in an isolated `/tmp` directory. Four atomic-environment tests passed.
  Initial direct file transfer retained Windows CRLF; normalizing only the
  temporary test scripts corrected that transport failure. The clean GitHub
  checkout uses normalized Git content.
- The real 2GB production host rejects the resource preflight before package
  installation or migrations. Full `codex:verify` passed again: 483 frontend,
  74 Nest, backend Node suite, API check, builds and production-entry smoke.
  Log: ignored `artifacts/docling-pdf-pages/deployment-codex-verify.log`.

## Linux acceptance and infrastructure cutover

- Original paper: all 11 physical pages, 62,631 characters and 29/29 frozen
  anchors; conversion 63.177s, peak process-tree RSS 2,044,252,160 bytes.
  Native/table/rotation/Unicode, scan, mixed, blank and low-quality conversions
  also passed canonical assertions; encrypted/corrupt preflight passed.
  Logs: ignored `linux-formal-runtime.log` and `linux-conversions.log` under
  `artifacts/docling-pdf-pages/`.
- First clone restore stopped because the database owner is `labrat_app`, not
  the OS service user `labrat`. The old backend/cron automatically resumed.
  Verified the actual owner, repeated the paused checkpoint, then restored it
  on the isolated new instance. Original data remained unchanged.
- Final checkpoint: UTC 20261002040214, root-only
  `/var/backups/labrat/final-8gb-cutover-20261002-2` on both instances.
  Compressed DB/files/config hashes and all public table counts match.
- Existing application c8a586963e5f passed local and HTTPS health on the new
  host before traffic moved. Static-IP detach/attach operations succeeded:
  `d5d265a2-7061-41bc-9f18-02cc7ded0732`,
  `64459a54-cb8c-4ee6-9447-f0def871ae7f`. Public HTTPS health passed afterward.
- AWS confirms `labrat-prod-8gb-20261001`, `large_3_0`, 8GB / 2 vCPU, static
  IPv4 100.50.25.194. Only ports 22/80/443 are open. Backend, Caddy, PostgreSQL,
  Docling and cron are active. The old `labrat-prod-1` is stopped and retained
  (stop operation `4edca1a9-fc4f-4e7a-9b21-937317438ea7`).
- Once the new host accepts writes, machine rollback requires a fresh reverse
  data sync. Prefer application/parser rollback on the new host. Old instance
  charges continue while retained; snapshot storage is charged separately.

## Application release and hosted Q&A follow-up

- Application `1ffa0861fc52735fbcaa6cd25a6dcbc56663d4e1` deployed through
  [workflow 36963511637](https://github.com/Thesclhy/LabRat/actions/runs/36963511637).
  All hosted tests/builds/deployment passed. Active release is
  `/opt/labrat/releases/20261002041636-1ffa0861fc52`; migration 038 is applied.
  Parser runtime `6ff2252f65c4385df9018e1cbfbdcbc091502609a6a79234dc8c3c11e33b6b3c`
  is active. Private environment/key permissions and `pip check` pass.
- Root/login/project-list routes and actual frontend asset
  `index-BkgbdccU.js` pass HTTPS checks and match the verified local build.
- Hosted fresh upload in a separate QA project saves 11 pages / 62,631
  characters / 29 anchors in 75.674s. Original page 9 renders as PNG; anonymous
  page access returns 401. Full evidence bodies intentionally require the
  authorized source endpoint; they are absent from question summaries.
- The original catalyst question still exhausted the shared budget on the
  deployed Anthropic / `claude-sonnet-4-5` provider: five generation requests,
  48,565 input / 499 output tokens, three read windows on pages 1/5/3 and three
  discovery queries. Exact provider counting is correct; a further request
  cannot fit under 60,000. Local M4 had used DeepSeek, so its success did not
  establish this provider's full hosted behavior. Initial result is retained.
- Added deterministic reading closure after half the allowance is spent and
  actual evidence exists in the current conversation. The next provider
  request disables tools, preserves the full read history/schema, and asks for
  a concise evidence-grounded answer. Exact counting, output reservation and
  the 60,000 hard cap remain. Both wire formats and discovery-only retry behavior
  have focused tests. Full `codex:verify` passed (483 frontend / 424 Node plus
  nine existing skips / 74 Nest); latest source-name prompt guidance also
  passes focused tests.
- An isolated actual-provider replay of the saved reading state produced an
  answer within 49,313 total tokens. Semantic review caught an unsupported
  expansion of `b-ZnO` as beta-ZnO; the paper defines it as bifunctional ZnO on
  page 2. Added general abbreviation guidance, without a runtime prose filter.
  Repeats also exposed suggestions from search-only snippets and a figure-axis
  value presented as a measured result. Final-generation discovery results now
  carry a marker instead of snippet text; every saved read and discovery trace
  remains intact. Added source-option/figure guidance and both-provider regression
  coverage. The final real-Claude replay answers in 43,873 total tokens;
  review against the three actual windows finds supported catalyst identities
  and comparisons, without the earlier abbreviation/axis overclaims. Initial
  replays and failures are retained; a fresh hosted question remains required.

- Q&A closure application `de920ccb318677fba984c8096bc6b603b3bf06a0`
  deployed through [workflow 36967969761](https://github.com/Thesclhy/LabRat/actions/runs/36967969761).
  Hosted tests, PostgreSQL integration, builds and deployment all passed; active
  release `/opt/labrat/releases/20261002051606-de920ccb3186` is healthy.
- Its fresh question `agent_run_12aca308ffe44567b749cea6` completed in 25.625s,
  with 48,096 actual aggregate tokens, two read windows, three source links and
  readingClosed=true. Every full source body matches the canonical page window;
  version pins/highlights, all 11 pages/29 anchors, page 9 and 401 still pass.
  Semantic review caught `b-ZnO` rewritten as `β-ZnO`. The saved canonical text
  is correct. Keep this initial answer and do not rewrite its history.
- The next scoped follow-up rebuilds final-generation context from the original
  user/system context and full actual read results. Intermediate assistant drafts
  and discovery results are omitted from that request; saved reads and trace stay
  intact. This targets draft contamination and also reduces input size. Source
  character/option guidance applies to format repair as well. Focused tests and
  full regression pass. Final real-Claude replay uses 43,901 aggregate tokens;
  review against actual windows confirms supported names/caveats and distinguishes
  this study from literature comparisons without the earlier axis overclaim.
  Publish this follow-up and check a new hosted question before closing deployment.
- Acceptance harness fixes are retained: source responses correctly add block
  rectangles/precision to the saved locator, so compare canonical locator fields
  before checking text. Resume must recover the saved request ID before writing
  state. Neither initial harness failure created another provider request. An
  initial service probe used port 8080; the configured 8787 probe passed.

## Remaining gates

- Done: create and isolate the new instance; verify identity and 8GB resources.
- Done: verify the pinned Python runtime and real offline conversions on Linux.
- Done: final paused checkpoint, exact restore and unchanged-release acceptance;
  existing static IP switched to the 8GB host.
- Done: publish Docling through the main workflow and verify actual parser,
  migration, frontend, fresh upload and original page access.
- Publish the scoped Q&A closure follow-up and verify a fresh original question
  with actual source bodies and semantic review. Keep the failed history.
- Retain the original instance and checkpoints; report overlap/storage charges.

Browser automation remains unavailable because its local sandbox cannot start.
An approved read-only command outside that sandbox recovered CLI access. AWS
operations use the official CLI and existing account credentials.
