# Research Q&A v1 contract

Status: implemented and verified locally — all v1 acceptance gates passed; not deployed
Last reviewed: 2026-09-27

Scope: the confirmed research Q&A plan and acceptance matrix. This contract
extends read-only evidence, not scientific acceptance or analysis execution.

## Ownership and versions

PDF/DOC/DOCX/TXT evidence references an existing immutable FileObject. A logical
ContextDocument belongs to one project. Each DocumentVersion pins file hash,
parser/OCR build, ordered passages, coverage and original locators. Same-name
new content creates another version; retries resume only the same file hash and
processing version. Reprocessing after a parser change creates a new version.
Archiving removes the document from future retrieval, preserving historical
versions and lawful citations. Excel keeps the existing SourceDocument index.

Document passages are source statements. Project profile evidence freezes the
read fields and their hash. `workbook_raw`, `confirmed_region` and
`experiment_snapshot` remain separate evidence types with their original
coordinates, raw/display values, units, missing states and revision/head hashes.
Saved answers pin these evidence versions; fetching/opening reauthorizes them.

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
explicit continuation. Citation repair reuses the already-read evidence with
tools disabled, so correcting a binding does not restart discovery or increase
the shared budget. Browser UTF-8 upload filenames retain their original Unicode
text; file bytes and existing immutable records are unchanged.

Each non-review question starts with one bounded discovery query using its text.
The same search tool covers current accepted field names as discovery targets;
numeric values still require exact experiment resolution and a pinned read.
Short Latin abbreviations match whole tokens so, for example, Co does not match
control. Search misses establish a retrieval gap, never universal absence.
After precise topic and synonym searches find no relevant support, the model
should return scoped insufficient evidence; an empty-query inventory must not
be used to exhaust every source in an attempt to prove universal absence.
This initial read counts toward the session's 24-call cap and visible tool trace;
provider tool-call statistics separately count model-issued calls.
Quoted structured JSON fragments must literally occur in the read data. Exact
source timestamps, verified locator/count phrases and verbatim quoted formulas
are distinguished from scientific numeric assertions; they cannot authorize a
new calculated value or changed unit. Empty continuation arrays do not claim
that more evidence remains. Reasoning is enabled for initial evidence selection
within the same frozen budget; reasoning text is not persisted. The final
tool-free repair disables reasoning to reserve its unchanged output allowance
for the structured answer, using the supplied evidence and exact repair hints.
Q&A disables the gateway's generic automatic format retry. Empty, truncated or
invalid structured output and invalid citations share one service-owned repair
using the frozen evidence already read, with no tools. Other gateway callers
retain their existing retry behavior. Repair hints identify matching stored
numeric paths without automatically assigning scientific meaning or changing
bindings. Verified field identifiers and quoted display names are metadata;
unverified identifiers, wrong locations and new measurements remain invalid.
The model adapter compacts an exactly repeated evidence window to references to
its earlier result. The authorized reader still executes on every call, and a
changed window is returned in full. This does not cache authorization, bypass
archive/revocation checks, or change the registry's immutable evidence. Prompt
instructions are kept concise to leave room for evidence under the same caps.
An application version is checked against stored version metadata; a literal
author-written revision label is checked against the cited passage text. Neither
kind of version number can authorize a scientific measurement with that number.

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

Idempotency binds request key to actor, project, question and scope. Same input
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
