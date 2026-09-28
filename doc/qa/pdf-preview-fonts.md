# PDF preview standard-font repair

Date: 2026-09-28. Status: deployed and verified; user retest pending.

The user saw almost all letters missing from the Q05-protocol.pdf page 1
preview and suspected OCR. The original synthetic fixture is intact (SHA-256
`55f91e9ad7a478a7abc868c941ecd26965b85aef85747c907785ad9d51a8c156`).
The production preview worker reproduced the missing letters. The same failure
appeared locally as a distorted substitute font.

The preview forced PDF.js system-font substitution while Node disables font
faces. Use the existing packaged standard-font glyphs for `renderPdfPage`.
No dependency, API, database, locator, text extraction or OCR configuration
changes are included. The parsing version remains unchanged because this repair
only affects transient page images, not persisted evidence. Page images are
rendered on demand with private/no-store responses; reopening an existing PDF
after deployment uses the corrected renderer without re-upload or Retry.

Verification:

- Preflight passed. A new test reads actual preview pixels with the bundled local
  English OCR engine. Before the repair it failed on Helvetica-Bold, including a
  numeric misread (45 became 43). After repair it passes for Helvetica,
  Helvetica-Bold, Times-Roman and Courier.
- All 16 focused document/parser/preview tests passed, including English/Chinese
  scans, rotation, low contrast, hidden text, original-page locators and retries.
  NestJS production build passed. Hosted full regression passed before deployment.
- Original Q05 page 1 and corrected local/server-runtime images were visually
  inspected. Both corrected images show the complete heading, 30 C instruction
  and remaining paragraphs. The server-runtime experiment changed no deployed code.
- Read-only, file-hash/project-scoped inspection found all three stored pages
  readable: page 1 text; pages 2/3 OCR, confidence 94. The document is `partial`
  because page 2 has an uncertainty warning. An isolated parse of the same
  synthetic bytes on production identifies Exp17 confidence 89, below the
  numeric-token threshold 90. Both 80 C and 30 minutes and the Chinese scan are
  correctly extracted. This warning does not mean an entire page failed.
- Diagnostics made no provider call or production research write. Existing
  reference versions/passages were not retried or reprocessed in storage.

Local evidence: `.tmp/pdf-preview-before.log`, `.tmp/pdf-preview-tests.log`,
`.tmp/pdf-preview-build.log`, `.tmp/pdf-diagnostics/` (original production
preview, corrected runtime preview and bounded synthetic parsing metadata).

Retest: refresh LabRat, open Q05-protocol.pdf, inspect page 1 and select passages
on pages 2/3. The page 2 confidence warning should remain. User manual acceptance
and fixed-answer/cross-device checks remain pending. Future changes to OCR input
rendering must use a new parsing version and preserve historical evidence; the
current parsing pipeline is intentionally outside this preview-only repair.

## Release result

- Application `8a6e382c4e4c21ebc98d493a418137858fe221e3` deployed from main to
  `/opt/labrat/releases/20260928193932-8a6e382c4e4c`.
- [Workflow 36473285885](https://github.com/Thesclhy/LabRat/actions/runs/36473285885)
  passed full frontend/backend/PostgreSQL tests, both builds, smoke and deployment.
- Fresh backup `/var/backups/labrat/pdf-preview-fonts-20260928`, set
  `20260928193446`, passed database/archive integrity checks.
- Live service, local/public health, exact assets and authorization rejection
  passed; existing migration 037 is unchanged. Provider remains Anthropic.
  Receipt: [pdf-preview-live.json](pdf-preview-live.json).
- The deployed worker rendered the original Q05 bytes; page 1 was visually
  inspected and is now complete. Pages 2/3 are byte-identical to their previous
  PNG previews. Read-only stored metadata and freshly parsed passages, locators,
  confidence and warnings exactly match the before-release baseline.
  Receipt: [pdf-preview-regression-live.json](pdf-preview-regression-live.json).
- No re-upload, stored retry, provider call or production research write occurred.
  Documentation follows in a `[skip ci]` commit. User manual retest is pending.
