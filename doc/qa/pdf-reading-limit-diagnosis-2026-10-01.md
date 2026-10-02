# PDF page labels and Q&A reading-limit diagnosis

Date: 2026-10-01. Scope: diagnosis only; no application change or deployment.

## Evidence and environment

The user reported repeated Page 2/Page 3 source buttons and a reading-limit
answer after uploading `s41467-024-55584-1.pdf`. They confirmed the online admin
account. The inspected production release is
`/opt/labrat/releases/20260930152442-c8a586963e5f`; service is active.
The matching question used Anthropic `claude-sonnet-4-5`.

The supplied PDF's SHA-256 is
`639b4a3cf3056ce7eb5567d160a2e416d98503eed3938831e6d39201f80d7656`.
Independent pypdf inspection finds 11 pages with labels 1–11, no encryption,
and text on every page. The existing application parser returns `ready`,
11 pages, 61,105 text characters, 1,244 passages and no warnings. All pages use
text extraction, not OCR. Rendered pages 2 and 3 were visually inspected.
Production aggregate metadata independently confirms 11 indexed pages,
1,244 passages and `ready` status. No missing-page failure was found.

Production reads were restricted to this filename and the exact user-provided
question. An initial detailed-record query was rejected by automatic approval
review because it would expose project identifiers and evidence text. It was
not executed. Approved replacement queries returned only aggregate page counts,
resource counters, tool names/statuses, lengths and provider/model names.
No identities, evidence text or search terms were returned. All database probes
used read-only transactions and statement timeouts. No model request, production
write or service restart was performed.

## Confirmed findings

1. **The repeated page buttons are ambiguous passage labels, not a page count.**
   `SourcesRead.jsx:36` counts grouped sources; `Sources read · 1` means one
   document/version group for this answer. It does not mean one tool invocation.
   Each evidence window gets a separate button at lines 44–45, while
   `ResearchEvidenceViewer.jsx:7` labels every PDF window only by its page.
   The saved six windows have pages `[2, 2, 2, 3, 2, 3]`, exactly matching the
   screenshot. These are not evidence that the PDF contains only those pages.

2. **The immediate stop is the application's pre-request token reservation.**
   The production failure is `qa_token_limit`, with 3 model requests,
   3 tool rounds, 4 tool calls, 19,680 input tokens, 319 output tokens and zero
   outstanding reserved tokens. Elapsed time is 16,702 ms. The activity is
   search → passage read → passage read → search. Both searches returned eight
   candidates; each read returned three evidence windows.
   Actual reported usage totals 19,999 tokens, below the 60,000 cumulative cap.
   `qaBudget.js:27–28` reserves the entire serialized request's UTF-8 byte length
   plus 2,048 framing units plus `max_tokens`, treating bytes as a conservative
   token upper bound. The next request is blocked before dispatch when this
   reservation plus prior usage exceeds the cap. The recorded usage excludes
   a post-response overrun, tool-call limit and timeout as this run's trigger.
   The rejected request body size was not persisted, so its exact size and exact
   overestimation factor are not established.

3. **PDF chunks are too small to make the bounded reader effective here.**
   `documentPdf.js:147` flushes a passage at each PDF end-of-line. This file's
   median passage length is 65 characters. `research-evidence.repository.ts:74`
   returns only the previous, requested and next passage; the advertised
   4,000-character read budget is a ceiling, not a target-sized paragraph window.
   The six saved evidence windows contain only 387 text characters in total.
   Their PostgreSQL JSON serialization occupies 9,345 bytes, including 2,970
   locator bytes; the saved search-match targets occupy 11,966 bytes. These are
   stored JSON sizes, not measurements of the exact wire request. Source IDs,
   coordinates and metadata accompany very little useful prose. The Anthropic
   tool loop resends prior tool results in subsequent requests, compounding
   this overhead and the conservative reservation.

4. **The fallback preserves evidence but does not synthesize a partial answer.**
   `research-questions.service.ts:184–193` saves `route: read_limit`, empty
   claims and the fixed limitation message, together with the evidence registry,
   trace and usage. It does not discard the stored passages or make another
   model call to answer from them.

## Review of the user's second diagnosis screenshot

- Its principal budget explanation matches the confirmed production trigger.
  Its synthetic reproduction demonstrates the mechanism, not this request's
  exact usage. The real run used 19,999 tokens, not its illustrative 11.5k.
- “One document read” inferred from `Sources read · 1` is incorrect; this run
  made two passage reads and two searches against one source group.
- A fixed fourfold overestimate cannot be inferred for this payload/model.
  Only the request-byte component is being substituted for an input-token
  estimate; output reservation and framing are separate terms.
- “High effort thinking” does not describe this Anthropic request path. The
  shared request declares a thinking preference, but `anthropic.js` does not
  serialize it; the DeepSeek adapter does. It is not the demonstrated cause.
- “Cached input counted at full price” confuses token accounting with pricing.
  The budget counts cached input toward a cumulative token cap; this function
  calculates no monetary charge. Whether this run used cache is not established.
- Repeated history increases cumulative input; “the cap only covers two
  passages” is not a general limit and is unsupported as a capacity claim.
- The final answer opportunity is lost, but the evidence is retained. The
  screenshot's diagnosis also omits the demonstrated line-level fragmentation.

## Verification and limits

- Reused the original PDF and current parser locally without changing code.
- Ran an isolated, no-network `createQaBudget` probe with the observed prior
  usage and a synthetic 34,061-byte request: reservation 40,109; sum 60,108;
  `qa_token_limit` before the fake fetch was called. This verifies the mechanism,
  not the unknown size of the production request that was refused.
- Temporary parsed text and renders are local ignored files under
  `artifacts/pdf-reading-diagnosis-20261001/`; the PDF is not copied into Git.
- No new provider replay or application test suite was run; no functional change
  was made. Whitespace/diff checks cover the diagnosis documents only.
