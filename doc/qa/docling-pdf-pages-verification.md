# Docling PDF pages v1 verification

Status: M0–M4 / A01–A15 passed locally; later production release tracked separately.
Started: 2026-10-01. Original Goal scope: local only. The later user-authorized
8GB upgrade and production publication are in
[deployment evidence](docling-lightsail-deployment.md).

## Baseline and fixed inputs

- Worktree: `C:/Users/liuha/.codex/worktrees/frontend-routing-phase1/LabRat-blank`.
  HEAD `8946d90` contains freshly fetched origin/main `933c5fc`.
  Preflight passed; unrelated primary-checkout work remains untouched.
- Host: Windows, Intel i9-12900H, 31.7 GiB RAM. CPU inference, four threads,
  one parser worker. Docker Desktop engine was unavailable; official Python
  docling-serve is installed in an isolated environment on D:.
- Original paper SHA-256 and 29 frozen anchors are in
  [goldens](docling-pdf-pages-goldens.json). Before Docling conversion, pypdf
  independently confirmed 11 unencrypted physical pages; all were rendered.
  Page 2/3/9 full-size previews and all-page contact sheets were inspected.
- [Fixture generator](../../scripts/qa/create-docling-fixtures.py) creates native
  columns/table/rotation/long text, scan, mixed text/image, blank, low-quality,
  encrypted and corrupt inputs under ignored artifacts. Initial visual QA caught
  an incorrect Chinese font on the long page; corrected before parser testing.
  The encrypted fixture is deliberately randomized by encryption; each run's
  manifest freezes its exact bytes before conversion.
- Full papers, raster images, raw parser results and test credentials stay in
  ignored artifacts. The verification report records summaries, not source files.

## Initial failures and fixes

1. Original PDF text inspection hit the Windows GBK console's inability to print
   ligatures. Setting Python output to UTF-8 allowed inspection; source unchanged.
2. pip's unconstrained dependency resolver backtracked repeatedly. An isolated uv
   installation resolved dependencies, but `pip check` alone did not prove runtime
   compatibility.
3. First service startup with docling-serve 1.21.0, docling 2.132.0 and jobkit 1.20.0
   failed: missing `FailedDocsItem`. Preserved startup/install logs. The service's
   [official v1.21.0 lock](https://github.com/docling-project/docling-serve/blob/v1.21.0/uv.lock)
   identifies docling/slim 2.96.1, core 2.78.0, models 3.13.2, parse 6.2.0,
   jobkit 1.20.1, RapidOCR 3.8.1, transformers 5.9.0 and CPU torch 2.12.0.
   Reinstalled those versions; dependency integrity check passes. Real startup
   and conversion still need verification.
4. One fixture-generation command was not executed because automatic approval
   review temporarily exhausted its account quota. Subsequent authorized execution
   succeeded; no approval bypass or product permission change was used.
5. Fixed-version service successfully started offline. The first real paper task
   finished in 50.719 s with 1,964,519,424 sampled peak resident bytes (launcher
   and child processes combined). Task status was `success`, but conversion was
   `partial_success`: pages 7–11 failed in the default `docling_parse` backend
   with `std::bad_alloc` / early termination. All eleven page metadata entries
   still existed while text provenance covered only pages 1–6. This is a real
   failed completeness check, not an accepted result. Host had about 8 GiB RAM
   available afterward; the log alone does not establish the exact allocation
   cause. A separate run uses the official `pypdfium2` backend.
6. The native fixture exposed ReportLab's invalid five-hex-digit ToUnicode
   mapping for U+1F52C: visually a microscope but text extraction yielded U+1F52.
   The generator now writes the required UTF-16BE surrogate pair; the original
   failed PDF and parser result are retained. The new real conversion preserves
   `中文🔬ZnO −12.5 °C`, with upstream Python code-point spans.

## M0 results and implementation decisions

The fixed Docling 1.21.0 service / 2.96.1 parser with standard pipeline,
Heron layout, accurate TableFormer, RapidOCR ONNX Chinese/English and PDFium
backend runs with predownloaded models and offline Hugging Face settings.
The model manifest is 27 files / 627,850,088 bytes, SHA-256
`5f5ef1ca1d36e078cd625351adda15b811a9efd5e5b5c131681c3b4328c509a7`.
The manifest includes downloaded alternatives; inference uses the ONNX Chinese
PP-OCRv4 detector/recognizer and v2 classifier. Newer docling-serve 1.36.0 exists,
but is not substituted for this measured pinned configuration.

| Real input | Conversion | Seconds | Observed result |
| --- | --- | ---: | --- |
| 11-page paper, PDFium | success | 44.781 | 11 populated pages, 29/29 frozen anchors; 358,702 response bytes |
| Native Unicode fixed | success | 7.422 | 3 pages, one 3×3 table, preserved scientific symbols and emoji |
| Scan | success | 10.516 | Chinese/English anchors and table extracted by actual OCR |
| Mixed native/image | success | 5.344 | Header once, image region text present |
| Blank | success | 3.266 | One page, no text; independent source inspection needed to classify empty |
| Deliberately low quality | success | 4.312 | Only `LT`; must surface limited recognition, never call this reliable |
| Encrypted | failure | 0.187 | No pages and empty error list; LabRat preflight must give a useful error |
| Corrupt | failure | 0.172 | No pages and empty error list; non-retryable invalid-file classification |

Paper process-tree peak sampled RSS was 2,539,720,704 bytes (about 2.37 GiB).
This is a single local measurement, not a production latency/memory guarantee.
All eleven original-page layouts and extracted paragraph order were compared;
figure label order remains a layout-derived approximation, not chart data extraction.
Scan superscripts may become baseline characters; retain original image and OCR
warnings. No scientific values are generated or accepted by this path.

Additional source inspection established three normalization requirements:

- Use `orig` for formula/list source text when `text` omits formulas or markers;
  preserve formula regions with a limitation warning, without reconstructing math.
- Split cross-page items by actual provenance spans and convert Python offsets to
  JavaScript UTF-16. Never assign the entire merged paragraph to both pages.
- PDFium native text coordinates are unrotated on rotated pages. Use independently
  read page geometry for the transform. Upstream cross-page merges can also use
  the first page's height for later boxes on unequal-sized pages; conservatively
  downgrade those locations to page precision rather than inventing highlights.

License evidence: installed Docling family distributions report MIT; Heron model
card declares Apache-2.0, Docling/TableFormer model card CDLA-Permissive-2.0,
RapidOCR code Apache-2.0. Preserve the exact used model/dependency notices during
M2 packaging; main-repository MIT is not a blanket license for every dependency.
For counting, use Anthropic's official count-tokens endpoint for its actual wire
request; the other provider must have a calibrated multilingual estimate/tokenizer
and separate cache-usage treatment. Verification and calibration remain M3/A12.

## M1 canonical storage verification

Migration 038 is additive and replayable. The real PostgreSQL test creates an
old checkpoint before upgrading and proves its body and passage read remain
unchanged. It then stores a >13k-character page, reads consecutive 4k UTF-16
windows, and verifies exact reconstruction including an emoji at a boundary.
The same test checks immutable successful pages, failed-page repair, version
pinning, transaction rollback at the whole-document text limit, private runtime
fields, View reads, selected-member denial and cross-project isolation.

Initial failures: a test fixture used `storage_path` instead of `storage_key`
(fixed in the test); session deletion still allowed a late parsing commit
(fixed by checking and share-locking the active session in the processing
transaction). The final database run passes. Five page unit tests and full
`npm run codex:verify` pass: 479 frontend, 407 Node backend with nine existing
skips, 74 Nest, generated types, builds and production-entry smoke.
This proves M1, not Docling-to-database or final browser/provider acceptance.

## M2 real service and recovery verification

`verify-docling-pages.mjs` passes against the actual M0 results and original
files. It independently inspects each PDF and reconstructs every page from
bounded UTF-16 windows. The original paper retains all 29 anchors; the native
fixture preserves column order, all nine frozen table cells, rotated text and
the 10,373-character long page. Cross-page text is assigned once. The first
rotated provenance box remains usable; the later unequal-height page's ambiguous
box is explicitly downgraded. Formula source text and reference numbers survive.
Blank is empty; low quality retains its two recognized characters with a warning.
Encrypted/corrupt input is classified by independent preflight before submission.

Actual HTTP upload/Docling/PostgreSQL suite passed in 49.74 s (warm service).
It checks native, scan, mixed, blank, low-quality, encrypted and corrupt inputs,
then the original paper: eleven stored pages, 62,631 characters and 29 anchors.
Backend restart after saving the upstream task id completes with one submission.
A real missing task id produces a 404 and completes with two total submissions.
Evidence: ignored `artifacts/docling-pdf-pages/database-real-docling.json`.

A separate test forcibly stopped the verified local Docling process tree after
paper submission, then started `services/docling/run.py` with model checksum
validation and the same key. It completed in 63.69 s: partial (quality warnings),
two total attempts, exactly eleven nonempty pages. The interrupted process id,
replacement id, task id and test logs are preserved under the same artifact
directory (`service-restart-*`, `restart-test.*`). This proves actual service
restart recovery, not merely a simulated missing-task response.

Storage/legacy PostgreSQL cases pass, including concurrent CPU claims, renewed
leases, stale result rejection, cancellation, archive, Guest restrictions and
session deletion. The first expanded test found a session FK preventing cleanup;
the additive migration now sets that private reference null on session deletion.
Full `codex:verify` passes: 479 frontend, 412 Node (nine existing skips), 74 Nest,
API generation, builds and entry smoke. The complete log is
`artifacts/docling-pdf-pages/m2-codex-verify.log`.

The adapter is restricted to loopback/the fixed private Docling hostname. An
initial broader endpoint patch was rejected by automatic review and never
applied; the restricted implementation and its destination/redirect tests pass.
No production state or other user's documents were used. The running local
service uses the pinned Windows runtime; Linux container execution is unverified.
Runtime notes and manifests are in `services/docling/`. Asset-specific notices,
including the visualization font present in the preparer's cache, must be
completed before distribution and remain part of A15. No model binaries are
committed, and this checkpoint does not imply final acceptance.

## Acceptance ledger

M3 checkpoint: canonical page discovery/read, immutable source resolution,
compact payloads and provider-aware token reservation are implemented. The real
PostgreSQL page-evidence case passes with late-page Chinese/chemical matches,
selected-only/pinned versions, duplicate filenames, archive/history and revoked
sessions. `page-evidence-db.json` records two retained windows/two trace entries;
the same 4,000-character canonical window is 4,732 bytes in the resolved source
response versus 4,112 model bytes. For an actual legacy paper passage containing
Pt on page 2, identical 73-character text is 1,201 bytes before projection versus
159 afterwards (`legacy-payload-comparison.json`). These compare payload shapes,
not a claim that OCR text exactly equals the old parser's output.

`tokenizer/calibration-result.json` records eight synthetic full JSON/tool inputs
against DeepSeek's official V4 tokenizer (SHA-256
89085f12ef79460ac5f66d1119325ddfc694b4ab209d80bbd81d35f081dc9614).
Final reservations are 1.378–2.315 times this offline baseline, including safety
and framing; server templates can differ. The first more conservative estimates
are retained separately. Anthropic counts the same request/model using its
official count endpoint plus 5% and 256; count failure blocks generation explicitly.
Nineteen focused Node tests cover actual/estimated exhaustion, 19,999 previous
tokens, unknown usage across retry, cache semantics, tools, repair and cancellation.

Real Chromium browser artifacts are under `browser/`. Initial paper upload,
cancellation, explicit retry and refresh pass. First page navigation exposed a
real duplicate sibling-key bug; `paper-results.json`, log and screenshot retain
that failure. Distinct text/image keys fix it; `paper-pages-results.json` then
passes pages 1–11 with all 29 frozen anchors and sequential full-text loading.
`fixtures-results.json` passes native (10,373 characters over four windows),
scan, mixed, blank, low-quality, encrypted and corrupt uploads, including explicit
failure retry. `citations-results.json` passes original legacy citations after
explicit reprocessing, three windows on one canonical page, visible original-image
highlights, rotation and refresh. A separate first citation script failure came
from treating the closed/offscreen Ask panel as open; its logs are preserved.
`narrow-results.json` passes 390px library/page text with width 390/390 and browser
back/forward. Rotated highlight screenshot was inspected on the actual text column;
long-page highlighting is a containing source block, not a claimed exact glyph box.

Full M3 regression before the final navigation fix passed 482 frontend / 418 Node
(nine existing skips) / 74 Nest, API generation/build/entry smoke. Eighteen focused
UI tests including the new integrated navigation regression pass afterwards.
M4 runs six cases frozen in `docling-pdf-pages-questions.json`, with the existing
local provider configuration (DeepSeek). The UI harness substitutes answer
generation only and never counts as that real-provider acceptance.

| Gate | Current evidence / remaining work |
| --- | --- |
| A01 | PASS: 11 physical/stored/opened pages, 29/29 frozen anchors; all-page original layout/paragraph-order audit, followed by browser full-text reads |
| A02 | PASS: native columns, nine table cells, symbols and rotation; actual rotated highlight is on the source text column |
| A03 | PASS: real scan/mixed OCR and DB/browser reads; native header appears once and image-region anchors survive |
| A04 | PASS: actual upload/preflight and UI distinguish empty/low quality/encrypted/corrupt; errors are nonretryable |
| A05 | PASS: >13k Unicode storage/window join, real 10,373-character page over four UI windows; stable cited text and containing-block highlights |
| A06 | PASS: actual backend/service restart, real 404 recovery, fenced leases/late writes; browser cancel/retry/refresh |
| A07 | PASS: explicit page states, whole-document limit rollback, immutable partial retry; independent real-PDF preflight rejects 201 pages and >25 MiB |
| A08 | PASS: real legacy v1→canonical v2 reprocessing preserves old answer image; DB pinned versions and duplicate names |
| A09 | PASS: HTTP/DB View, selected-member, other-project and Guest boundaries; revoke/cancel/archive fences and page-search scope |
| A10 | PASS: whole-page Fe2O3/Chinese/ZnO queries beyond 4k, fixed paper catalyst searches, selected-only/pinned versions; keyword misses no longer backfill unrelated pages |
| A11 | PASS: same-text byte measurements above; new/legacy model projection excludes geometry/full metadata while all windows/trace remain saved |
| A12 | PASS: 19,999-token regression, calibrated estimates/count API, real usage, cache and unknown-usage/retry boundaries; 60k limit retained |
| A13 | PASS: actual desktop/390px upload/state/text/navigation/citations/failure retries; no browser runtime errors or horizontal overflow |
| A14 | PASS: six frozen cases reviewed against actual reads; affected D01/D05 reruns and all initial failures retained below |
| A15 | PASS: full regression, isolated DB compatibility, actual Docling/browser/provider checks, license notices and runbook; final no-font ingestion/recovery rerun passes |

No mocks, package installation or old-parser results count as passing new-parser
acceptance. M0–M4 remain governed by the original plan.

## M4 real-provider review and corrections

Used the already configured `deepseek-v4-pro` provider with the public paper and
synthetic PDFs only. Six initial cases were frozen before requests. HTTP/test
completion was not the semantic acceptance criterion. Every final cited ID was
resolved, and all selected-only reads stayed on their chosen versions.

| Case | Reviewed result | Requests | Actual input/output tokens | Seconds |
| --- | --- | ---: | ---: | ---: |
| D01 | Zn/b-ZnO, commercial/carbon comparisons and prior-study catalysts; no new experimental parameters; final reads pages 1, 5 and 3 | 4 | 25,776 / 1,175 | 13.957 |
| D02 | Page 9 precipitation is 85 °C / 6 h, not the later drying step | 2 | 5,722 / 634 | 6.896 |
| D03 | Pages 1 and 9: reported 50 cycles, preparation 85 °C / 6 h and drying 80 °C / 5 h kept distinct | 3 | 11,411 / 1,230 | 10.824 |
| D04 | Selected scan: Zn/b-ZnO 280 °C / 73 wt%, Ru/C row, explicit OCR uncertainty | 3 | 8,482 / 774 | 8.563 |
| D05 | Scoped insufficient evidence for the requested price/supplier; related material supplier cited without inventing price | 4 | 19,028 / 1,156 | 12.404 |
| D06 | Selected low-quality page yields only LT; cannot support catalyst/temperature | 3 | 8,016 / 808 | 8.953 |

Initial `provider-2026-10-02T01-27-51-056Z.json` passed D01–D04/D06. D05
overstated absence across the paper after reading only relevant windows. A first
prompt correction still let D05 exhaust its cumulative budget; a following search
correction passed retrieval but D01 then over-read, and D05 still used an overly
broad first sentence. All three reports remain unchanged in ignored artifacts.

Fixes: nonempty keyword searches no longer return unrelated selected opening
pages; discovery remains available with an empty query. The prompt explicitly
distinguishes a missing requested field from a source statement of absence. After
20k cumulative tokens, tool responses advise finishing from evidence already read
or explaining the remaining gap. This does not loosen the 60k cap, disable tools,
clear usage, synthesize an answer, or add a prose/number validation filter.
The final affected-case report is `provider-2026-10-02T01-48-35-873Z.json`;
D01 and D05 both pass actual answer/read-window review. D02–D04/D06 stay below
that advisory threshold and retain their initial accepted results.

Across six initial cases plus six affected-case reruns: 48 generation requests,
297,716 input and 15,849 output tokens. The provider did not return monetary cost;
`knownCost` remains null. Reports include per-request estimates/actual usage and
elapsed time. The DeepSeek estimator remains conservative, roughly twice actual
input for these requests; it is not advertised as exact. `provider-semantic-review.json`
indexes the accepted records. Finite examples demonstrate this regression is
resolved; they do not guarantee every future broad question fits the fixed budget.

## Final compatibility and packaging

`m4-codex-verify.log` passes 483 frontend, 420 Node (nine existing skips), 74 Nest,
generated OpenAPI client consistency, both builds and production entry smoke.
Additional isolated PostgreSQL runs cover canonical storage/search, old passages,
Word/TXT, Excel raw-vs-accepted evidence, question/history, pending tasks and
selected mentions. Initial compatibility tests still registered the old fixed PDF
corpus through the new service-only entry; they now explicitly seed real legacy
parser versions for historical regression. New ingestion continues to use real
Docling tests. One old TXT test had Vitest's one-second default wait; its bounded
wait is now ten seconds. The three affected cases pass after those test fixes.
The first new size-limit assertion used a nonexistent error label; corrected to
the existing `document_too_large` contract. Both preflight tests pass.

Final model inventory excludes the unused FZYTK visualization font: 26 assets,
624,608,340 bytes, manifest SHA-256
`e4282b963037b90ae73392d6d79a26398b9ebcf5ffe8a708ac7ddbdaaa4e2af5`.
It lives in a separate clean runtime directory, preserving the original M0 cache.
The processing-version fingerprint changed accordingly. OCR/layout/table weights
and normalization are unchanged. Real scan conversion with the font absent passes
(14.765 s including cold loading); the missing optional-font warning is expected,
and debug visualization stays off. D01/D05 final runs use this package too.
[Notices](../../services/docling/THIRD_PARTY_NOTICES.md) retain the direct licenses
and pinned model cards; the exported runtime inventory contains 245 distributions
and 388 license/notice files, including nested PDFium dependency notices.

The first final real-parser test worker exited unexpectedly while full regression
was also running; that is an unaccepted run, preserved as
`m4-real-docling-worker-exit.log`. The separate rerun passes in 93.64 s (87.88 s
test time): native/scan/mixed/blank/low-quality/error files, backend restart, real
missing-task recovery and the original paper's 11 pages / 62,631 characters /
29 anchors. `database-real-docling.json` records the final processing fingerprint;
the M2 record is preserved as `database-real-docling-m2.json`. The forced service
restart case was already separately passed in M2, and is intentionally not
repeated by this ordinary final run. The log alone does not establish the first
worker-exit cause.

Browser citation QA's broad filename selector chose reprocessed `Legacy native.pdf`
v2 for the canonical long/rotated checks; it contains the exact same synthetic
bytes as `native.pdf`. Those page/highlight results remain valid and the screenshot
title is retained. The reusable harness now selects the exact filename. The
separate legacy v1 citation-after-v2 check used its actual frozen old version.

## Local retest and operational limits

1. Follow [service setup](../../services/docling/README.md), apply migration 038
   on the intended local database, and start the configured Nest backend/frontend.
2. Upload the supplied paper. Wait for saved results; open pages 1, 3 and 9, then
   inspect recognized text and compare to the original image. Image/formula quality
   warnings are expected and do not mean missing physical pages.
3. Ask the original catalyst question and open its sources. Same-page groups must
   expose every read window. Ask the page-9 precipitation question separately.
4. Upload scan/mixed/low-quality/encrypted fixtures; check warnings/errors, refresh
   processing, and exercise cancel/retry. Reprocess a legacy PDF and reopen an old
   saved answer to confirm its version stays pinned.
5. At a narrow viewport, open the library/viewer and use browser back/forward.

Windows/Python CPU execution is verified; Linux/systemd or a container deployment
needs environment-specific validation. Default concurrency is one and the measured
paper peak was about 2.37 GiB; reserve at least 4 GiB for the parser. OCR, formula
layout and figure labels still need original-page review; no generated values are
promoted to accepted experiments. Keyword retrieval remains literal/lexical;
semantic chunks, embeddings and pgvector are the next separate stage.
Rollback disables new parsing configuration while keeping migration 038, saved
canonical pages, legacy passages and original files readable. No production
change, push, main merge or automatic historical reprocessing is part of this delivery.

The test Nest backend shut down and removed its isolated browser schema. The
verified Vite, Docling process tree and localhost:55439 PostgreSQL instance were
stopped after acceptance. Runtime/model caches and ignored QA evidence remain for
review; no application uploads or unrelated processes were removed. Final
`git diff --check`, Python syntax/license hashes and browser-script syntax pass.
