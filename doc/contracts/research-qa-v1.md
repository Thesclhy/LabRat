# Research Q&A v1 contract

Status: read-only source-trace revision implemented locally; deployment remains at the prior checkpoint
Last reviewed: 2026-09-29

Scope: the confirmed research Q&A plan and acceptance matrix. This contract
extends read-only evidence, not scientific acceptance or analysis execution.

## Read-only answer interface (2026-09-29)

The active goal in ../plans/readonly-qa-trace.md supersedes older answer acceptance
rules in the original planning and evaluation records: no generated-quote matching, prose number/unit extraction or required
numericBindings. Check answer structure and references to actually returned evidence
IDs only, with at most one structural repair. Omit unresolved links and explain the
link limitation; never label prose verified. Source/tool authorization, stored values,
review boundaries and resource budgets remain enforced. Persist all successful read
windows, including uncited ones, and bounded inputs/output identities in the tool
trace; distinguish discovery from reading. Historical artifacts are not rewritten.

## Ownership and versions

PDF/DOC/DOCX/TXT evidence references an existing immutable FileObject. A logical
ContextDocument belongs to one project. Each DocumentVersion pins file hash,
parser/OCR build, ordered passages, coverage and original locators. New uploads
in Ask or the reference library create an independent document, including when
filenames match. An explicit New version action binds documentId and
expectedVersion. Legacy registration without a choice groups by name only when
unambiguous; duplicate identities require an explicit choice. Migration 036
replaces the active-name unique index with a lookup index. Retries resume only the same file hash and
processing version. Reprocessing after a parser change creates a new version.
Archiving removes the document from future retrieval, preserving historical
versions and lawful citations. Excel keeps the existing SourceDocument index
and only follows workbook upload, region selection and semantic confirmation.
It is not a reference document. New Q&A discovery excludes unconfirmed workbook
indexes; read_workbook_source is absent from provider tools and rejects direct
calls. Confirmed region reads retain bounded raw cells inside the confirmed range.
Historical workbook_raw citations remain readable under current authorization.

Document passages are source statements. Project profile evidence freezes the
read fields and their hash. `workbook_raw`, `confirmed_region` and
`experiment_snapshot` remain separate evidence types with their original
coordinates, raw/display values, units, missing states and revision/head hashes.
Saved answers pin these evidence versions; fetching/opening reauthorizes them.

## Unified Ask and selected references

One Ask panel contains cited answers and existing reviewed workflow cards.
PDF, DOC/DOCX and TXT attached with + enter the reference library. Excel attached
with + enters the existing workbook review chain, retaining the original question
as a pending task. Continue is explicit after current accepted regions exist for
each uploaded workbook; exact range eligibility is still checked on the server.
Pending workbook questions are saved in server-owned AssistantTasks before upload,
scoped by actor and project. They survive browser/app restarts and are available
to another authenticated device. Local File bytes are not synchronized: unfinished
uploads require reselecting the file. Recovery never automatically executes or
publishes scientific results. The implementation after deployed 0d4a9ea requires
migration 037; see `doc/plans/cross-device-ask-tasks.md` for delivery status.

AssistantTasks use a bounded manifest of up to eight workbook/reference files and
pin selected document versions, the original question and bounded conversational
context. Create and attach require full-project propose; list/get, dismiss and
explicit continue require full-project read and personal ownership. Public Guest
and selected-experiment-only members are denied. Other project members cannot
enumerate these personal tasks. Every operation rechecks current session/access.

The `/assistant-tasks` API exposes create and cursor-paged pending lists;
`/{taskId}` retrieves one owned task; `/attachments` idempotently binds one file
slot; `/cancel` dismisses the task; `/continue` starts or retrieves its question.
At most 100 waiting tasks are allowed per actor/project and 40 per API page.
Readiness comes from current indexed sources, undeleted sessions, current accepted
regions and available pinned references. The client cannot supply a ready flag.
Missing uploads, withdrawn region confirmation and archived/unreadable references
block continuation. Same-key conflicting creates or attachment replacements return
409. Creating one Q&A request and marking its task submitted share a transaction;
continue/dismiss races serialize on the task. Replaying continue returns the same
run without silently retrying a failed or cancelled question. A saved queued run
can explicitly start through the existing question UI after a server interruption.

Task polling is read-only and surfaces an answer started on another device. New
conversation clears its conversation view, not server pending tasks. Old local
workbook pending cards offer explicit Save across devices, preserving source IDs;
no generic project/chat migration or second analysis execution runtime is added.

The reference library occupies the main workspace, with server-side name/type/
status filtering, stable oldest/newest pagination, readable source passages/PDF
pages, versions, retries and archive. It does not accumulate inside the chat pane.
PDF reading navigates original pages using version metadata rather than passage
pagination; the original-page preview limit remains explicit. Opening a citation
retains its pinned version and page, with exact highlights only on the cited page.
View members may read and ask; document mutations use existing proposal permission.

@ selection pins up to eight documentId/versionId pairs. The server validates
ownership, active document state and readable version state before and during
retrieval. Default sourceScope=project prioritizes selected versions while allowing
other authorized evidence; a selected document's latest version never substitutes
for its pinned version. sourceScope=selected restricts discovery and tools to
selected document versions. Explicit only-use/仅根据 requests with mentions infer
this scope, including English "Based only/solely on this document" in immediate
questions and continued AssistantTasks. The composer displays the same scope.
Question context stores the resolved identities in the personal
AgentRun selectedContext JSON, not in mutable document names. At most six recent
messages (1,000 characters each) and a removable experiment label are untrusted
conversational context; they confer neither citation support nor permissions.

New conversation clears the local conversation view and mention selections,
retaining project documents and durable personal answers. The server restores up
to the latest 20 personal questions when local history is unavailable. Old
unscoped browser history is not imported into an authenticated actor's history.
Runtime diagnostics live in Settings. Existing calculation/analysis approval and
manuscript actions retain their separate review boundaries in the shared panel.

## Local processing

Adapters verified on synthetic fixtures: PDF.js for text and raster page rendering;
Tesseract.js with packaged English/Simplified-Chinese traineddata for OCR;
word-extractor for binary DOC; bounded ZIP/XML traversal for DOCX; explicit
UTF-8/UTF-16/GB18030 decoding for TXT. No OCR/document service is introduced.
No document-provided URL, macro, formula or embedded program is executed.
PDF coordinates use the original page's displayed rotation and normalized
top-left rectangles, with page dimensions/rotation retained for exact rendering.
OCR confidence is the engine's recognition score, never scientific certainty.

## Initial resource budgets

These are enforceable engineering limits, not measured latency guarantees.

| Operation | Limit |
| --- | --- |
| Source file | 25 MiB |
| PDF | 200 pages; 12 million raster pixels/page; 40 s/page |
| Parse attempt | 180 s; one document worker; 512 MiB JS heap |
| Concurrent ingestion | 2 backend workers; 1 active attempt per version |
| DOCX archive | 64 MiB expanded total; 2,000 entries; no DTD/entities |
| Text/index | 2 million characters; 10,000 passages; 4,000 characters/passage |
| Question | 4,000 characters |
| Search | 40 candidates/page; return 8; explicit cursor and coverage |
| Exact read | 4,000 characters or 240 cells/page; explicit next cursor |
| Q&A | 8 tool rounds, 24 tool calls, 12 provider requests including repairs |
| Provider | 60,000 aggregate input/output tokens; 120 s cumulative active wall time across attempts |
| Concurrent Q&A | 1 per actor/project, 4 per backend process |

An isolated process provides time/heap fault containment, not a hardened OS
sandbox or a claim of a strict total resident-memory ceiling. Raster and archive
limits also bound native allocations. Completed PDF pages are checkpointed;
failed pages may be retried within another bounded attempt. All omitted pages
and unreadable parts are explicit. A question never triggers OCR itself.

Document passage reads also include immediately adjacent passages when their
combined text fits the 4,000-character window and tool-byte limit. Each has its
own evidence ID and original locator; unread neighbor IDs remain available for
explicit continuation. One service-owned format/link repair may reuse the already
read evidence with tools disabled; it cannot restart retrieval or grow the budget.
If the token, request or tool-reading budget is exhausted, do not restart the model
or enlarge the limits. After rechecking current authorization and cancellation,
save an insufficient_evidence artifact with route=read_limit, no generated claims,
the successful read windows and trace, and an explicit incomplete-reading message.
This is not evidence that the requested fact is absent. Usage retains the original
limit failure. Cancellation, timeout, provider outages and revoked access remain
failures/cancellations, not completed partial answers. Narrowing the question starts
a new request; it does not silently retry the exhausted run.
Browser UTF-8 upload filenames retain their original Unicode text.

The model chooses the first tool from the question and selected context; there is
no unconditional document search. Existing calculation/diagnosis routing remains
as an early handoff, and the tool set has no execution or publication capability.
Search covers uploaded passages, confirmed regions and accepted field names, not
unconfirmed workbook indexes. Selected-only questions expose only document search/read
tools, in addition to enforcing the same scope server-side. Exact experiment names/aliases must resolve before
a pinned snapshot read. Short abbreviations match whole tokens. Search misses
describe coverage gaps; they do not prove universal absence.

The answer interface retains status, claims (text plus optional links in a citations
array) and missingEvidence. Citations reference only evidence IDs returned in this
run. Legacy quote/numericBindings fields are optional at the boundary for existing
adapters, have no content-checking role, and are omitted from newly saved answers.
No rule extracts prose numbers, verifies paraphrases, compares units in prose,
or classifies protocol identifiers. This interface does not establish correctness.

Malformed/empty/truncated output or unknown reference IDs share at most one repair.
After repair, a malformed structure fails as qa_output_invalid (or the provider's
format error); a well-formed answer with unresolved IDs is saved without those
links and with an explicit link limitation. No qa_citation_invalid content gate
is used for new answers. Existing failed records keep their historical code.
Unknown links are also suppressed by the renderer, never converted to arbitrary URLs.

All successfully returned read windows, including adjacent passages and uncited
reads, are frozen in AnswerArtifact.evidence; bodies are omitted from the question
summary response and fetched through the authorized evidence endpoint. The existing
JSON storage suffices, with no new migration. New answers carry provenanceVersion=2.
The bounded trace contains sequence, tool, phase (discovery/read), validated input,
status and elapsedMs. Successful reads identify evidenceIds. Discovery records
returnedCount, bounded matching identities, coverage and nextCursor, with no claim
that the matched sources were fully read. Failed calls cannot add read evidence;
invalid arguments are not copied to trace. No credentials or hidden reasoning are logged.

Sources read groups evidence by immutable document version, workbook source/index
or experiment snapshot; individual window links open the original saved evidence.
The list is collapsible and remains available after refresh or on another device.
Old artifacts lacking provenanceVersion=2 display Saved sources and explain that
their cited-only record is incomplete; neither old prose nor history is rewritten.
OCR/coverage limitations remain visible. Link integrity is never labeled verified facts.

The model adapter compacts identical repeated windows only after the authorized
reader rechecks access; changed windows are returned in full. Reasoning remains
transient and budgeted; the final format/link repair disables it.

## Persistence and endpoints

Migration 034 adds ContextDocument, DocumentVersion, completed pages and passages
with additive Drizzle tables and a Nest ResearchQaModule. Under
`/api/v1/projects/{projectId}`, `context-documents` registers/lists sources;
`context-documents/{documentId}` reads version history and `/archive` archives;
`context-document-versions/{versionId}` reads state, `/retry` resumes processing,
`/passages` and `/passages/{passageId}` read bounded text, and `/pages/{pageNumber}`
renders a private/no-store original PDF page. Closed request schemas and generated
client types are in OpenAPI. Registration, retry and archive require propose;
source reads require full-project read. Migration 035 adds personal project
questions linked to AgentRun and immutable AnswerArtifacts. `research-questions`
creates/lists questions; `/{runId}` reads status, `/retry` explicitly recovers an
interrupted/failed attempt, `/cancel` cancels it, and `/evidence/{evidenceId}` opens
the saved source window. These operations require current full-project read and
exclude public Guest. The mixed AgentRun action route keeps propose.

Question model repairs share a maximum of twelve provider requests/eight tool
rounds/twenty-four calls. Each transport reserves a conservative UTF-8 byte-based
token upper bound before sending, then reconciles reported usage. Unknown usage
keeps the reservation; cost is null when no provider price is known. Up to three
explicit attempts share persisted request/token counters and elapsed active time.
Time between explicitly stopped attempts is excluded; an interrupted attempt's
unknown interval since its last checkpoint is conservatively reserved up to the
deadline. Exhausted questions do not make a new provider call on retry.
Large project-profile fields use explicit field/cursor windows, and document
passages carry a summary plus the cited page's coverage instead of the whole
document's per-page list. The model gets no
network, calculation, acceptance, publication or administration tools.

Idempotency binds request key to actor, project, question, pinned references,
source scope and bounded conversation/context. Same input
returns the same run; different input conflicts. Cancellation/revocation prevents
late answer persistence. Interrupted attempts are visible and explicitly
retryable; no unimplemented durable automatic worker is promised. Provider calls
are bounded but not claimed to be billed exactly once.

Generic AgentRun list/detail/cancel operations exclude `research_qa` runs; the
personal Q&A operations are their only public access path. This prevents another
project member from reading a question or bypassing its cancellation lease.
Newly generated workbook indexes preserve formula cells with no saved result as
missing; a parser's blank-cell zero placeholder is not an experimental value.
Existing immutable indexes and accepted results are not rewritten by this fix.

## Provider schema compatibility

Anthropic's wire schema omits unsupported numeric/string/array limits and keeps
them in field descriptions. The gateway validates the original output shape before
the service-owned format/link check. Claim/link counts, text lengths and shared
resource budgets remain enforced; these are interface limits, not semantic checks.
Provider selection and all other gateway callers remain unchanged.
