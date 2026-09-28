# PDF page navigation

Date: 2026-09-28. Status: local verification passed; release pending.

The user found the PDF preview's Passage/text-block selector difficult to read.
It also exposed only the first eight passages until Load more was clicked,
obscuring later pages. PDF reading now uses the original version's page count,
one option per page, Previous/Next, and a page/total indicator. Each page is fetched
on demand. Library reading shows the clean original image without selecting an
arbitrary text block, including pages without readable indexed text.

Saved-answer citations still open the exact pinned version/page and highlight
the original rectangles. Other pages show no citation overlay or quoted passage;
Return to cited page restores both. Citation labels display page numbers without
internal text-block numbers. Page warnings remain visible; the existing
200-page preview limit is disclosed explicitly for longer documents.

The page image has loading/failure/retry states. Missing version metadata is
fetched through the existing version-scoped read API, with cancellation and a
separate retry. Changing projects/files cannot apply late metadata. Turning a
page returns the dialog to the top. Word/TXT retain their existing passage view.
No parser, source evidence, API/schema, authorization or review boundary changed.

Verification:

- Preflight passed. 96 focused tests passed across evidence/Q&A/UnifiedAsk and
  ProjectDashboard. New cases cover unique full-page choices, pages without text,
  exact historical citations, highlight removal/return, image retry, stale project
  requests, metadata retry, the 200-page limit and TXT cursor pagination.
- Production build passed with the existing bundle-size warning.
- Actual Chromium against real HTTP/PostgreSQL and the production frontend build
  passed upload, page 1/2/3 navigation, full coverage despite 11 passages on page 1,
  English/Chinese scans, citation-page return, View reading, Escape/close and
  390px layout. Screenshots were visually inspected. Provider answers and accepted
  workbook confirmation in the shared harness are deterministic test substitutes.
- A final 13-test rerun, rebuild and actual-browser pass verified return-to-top
  behavior and consistent button/text styling across library and chat entry
  points; final screenshots inspected. Test-owned servers/database were stopped
  after checking no other database clients were active. Hosted full regression is a
  deployment gate. No real provider or production research write is needed.

Local evidence: `.tmp/pdf-page-tests.log`, `.tmp/pdf-page-final-tests.log`,
`.tmp/pdf-page-build.log`, `.tmp/pdf-page-browser.log`, and screenshots
`.tmp/unified-ask-browser/pdf-pages-{desktop,mobile,citation}.png`.

Manual retest: refresh LabRat and open Q05-protocol.pdf. The selector should show
three pages, with Previous/Next controls; switch to pages 2 and 3. Then open a
PDF citation from an answer, check its highlight, visit another page and return.
No re-upload or OCR Retry is required. User acceptance remains pending.
