# Workbook Review Selection Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workbook upload review behave like a real confirmation loop: users can left-drag red boxes in the Excel preview, then use fixed input-area actions to either confirm the current understanding or submit natural-language revision text plus red-box updates.

**Architecture:** Keep the existing backend APIs. `WorkbookReviewWorkspace` owns Excel cell selection and draft red boxes. `AgentPanel` owns the Ask LabRat conversation and replaces the normal chat composer with a workbook-review composer while a WorkbookReviewSession is active. The revision path calls the existing revision API; the confirm path calls the existing confirm API.

**Tech Stack:** React 19, `react-data-grid`, existing `serverApi` helpers, Vitest + Testing Library, plain CSS in `src/styles.css`.

---

## File Structure

- Modify `src/main.jsx`
  - `WorkbookReviewWorkspace`: add left-drag cell selection, A1 range draft creation, and selected-range visual styling.
  - `AgentPanel`: replace the normal input footer with a workbook-review composer when `workbookReviewContext.active` is true.
  - `ProjectDashboard`: continue passing `workbookReviewDraftRegions`, `onSubmitWorkbookReviewRevision`, and `onConfirmWorkbookUnderstanding` into `AgentPanel`.
- Modify `src/styles.css`
  - Add workbook drag-selection cell styles.
  - Add fixed footer composer styles for confirm/revision actions.
- Modify `src/components/ProjectDashboard.test.jsx`
  - Add TDD coverage for drag selection.
  - Add TDD coverage for composer confirm/revision API callbacks.
- Modify `doc/task-checklist.md`
  - Update current objective for this implementation milestone.
- Modify `doc/PROGRESS.md`
  - Record the completed implementation and verification.

No backend files should change. No new API should be added. No DatasetCommit, SourceExtractProposal, ChartSpec, FigurePackage, or Manuscript content should be created by this flow.

---

### Task 1: Add RED Test For Left-Drag Excel Red-Box Selection

**Files:**
- Modify: `src/components/ProjectDashboard.test.jsx`
- Later implementation: `src/main.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("WorkbookReviewWorkspace", ...)`, after the existing suggestion-click test:

```jsx
it("creates a local draft red box by dragging from one workbook cell to another", async () => {
  const fetchMock = makeWorkbookReviewFetch();
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  const onDraftRegionsChange = vi.fn();
  try {
    render(
      <WorkbookReviewWorkspace
        projectId="project_1"
        reviewState={reviewState}
        draftRegions={[]}
        onDraftRegionsChange={onDraftRegionsChange}
      />,
    );

    const startCell = await screen.findByLabelText("Cell A1");
    const endCell = await screen.findByLabelText("Cell B1");
    fireEvent.mouseDown(startCell, { button: 0 });
    fireEvent.mouseEnter(endCell);
    fireEvent.mouseUp(endCell);

    await waitFor(() => expect(onDraftRegionsChange).toHaveBeenCalled());
    const nextRegions = onDraftRegionsChange.mock.calls.at(-1)[0];
    expect(nextRegions).toHaveLength(1);
    expect(nextRegions[0]).toMatchObject({
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "A1:B1",
      selectionMethod: "drag_select",
      status: "draft",
    });
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
```

Expected: FAIL because cells do not expose `aria-label="Cell A1"` / drag selection does not create a draft red box.

---

### Task 2: Implement Minimal Drag Selection In `WorkbookReviewWorkspace`

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add drag-selection state and helpers**

Inside `WorkbookReviewWorkspace`, near existing `useState` calls, add:

```jsx
const [dragSelection, setDragSelection] = useState(null);
```

After `createCellDraftRegion`, add a range helper:

```jsx
const createRangeDraftRegion = (start, end, selectionMethod = "drag_select") => {
  if (!sourceDocument?.id || !activeSheetName || !start || !end) return;
  const bounds = normalizeExcelBounds({
    startRow: start.row,
    endRow: end.row,
    startCol: start.col,
    endCol: end.col,
  });
  const range = formatExcelA1Range(bounds);
  onDraftRegionsChange?.(upsertDraftWorkbookRegion(draftRegions, {
    clientRegionId: `draft_${sourceDocument.id}_${activeSheetName}_${range}`.replace(/[^a-zA-Z0-9_]/g, "_"),
    sourceDocumentId: sourceDocument.id,
    sheetName: activeSheetName,
    range,
    selectionMethod,
    description: "",
    status: "draft",
  }));
};
```

Add handlers:

```jsx
const beginCellDragSelection = (event, row, col) => {
  if (event.button !== 0) return;
  event.preventDefault();
  setDragSelection({ active: true, start: { row, col }, end: { row, col } });
};

const extendCellDragSelection = (row, col) => {
  setDragSelection((current) => current?.active
    ? { ...current, end: { row, col } }
    : current);
};

const finishCellDragSelection = () => {
  setDragSelection((current) => {
    if (current?.active) createRangeDraftRegion(current.start, current.end, "drag_select");
    return null;
  });
};
```

Add a mouse-up safety effect:

```jsx
useEffect(() => {
  if (!dragSelection?.active) return undefined;
  window.addEventListener("mouseup", finishCellDragSelection);
  return () => window.removeEventListener("mouseup", finishCellDragSelection);
}, [dragSelection?.active, draftRegions, sourceDocument?.id, activeSheetName]);
```

- [ ] **Step 2: Render cells with pointer hooks and labels**

In the `gridColumns` `renderCell`, replace:

```jsx
renderCell: ({ row }) => row[`col_${col}`],
```

with:

```jsx
renderCell: ({ row }) => {
  const address = `${excelIndexToColumnLabel(col)}${row.__rowIndex + 1}`;
  return (
    <div
      className="workbook-data-grid-cell-value"
      aria-label={`Cell ${address}`}
      onMouseDown={(event) => beginCellDragSelection(event, row.__rowIndex, col)}
      onMouseEnter={() => extendCellDragSelection(row.__rowIndex, col)}
      onMouseUp={finishCellDragSelection}
    >
      {row[`col_${col}`]}
    </div>
  );
},
```

Update `cellClass` to include active selection:

```jsx
if (dragSelection?.active) {
  const selectionBounds = normalizeExcelBounds({
    startRow: dragSelection.start.row,
    endRow: dragSelection.end.row,
    startCol: dragSelection.start.col,
    endCol: dragSelection.end.col,
  });
  if (row.__rowIndex >= selectionBounds.startRow
    && row.__rowIndex <= selectionBounds.endRow
    && col >= selectionBounds.startCol
    && col <= selectionBounds.endCol) {
    classes.push("is-selecting");
  }
}
```

Make sure `gridColumns` depends on `dragSelection`.

- [ ] **Step 3: Add styles**

Add to `src/styles.css` near existing `.workbook-data-grid` styles:

```css
.workbook-data-grid-cell-value {
  align-items: center;
  display: flex;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.workbook-data-grid .is-selecting {
  background: rgba(220, 38, 38, 0.14);
  box-shadow: inset 0 0 0 2px rgba(220, 38, 38, 0.7);
}
```

- [ ] **Step 4: Run the test to verify GREEN**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
```

Expected: PASS.

---

### Task 3: Add RED Tests For Workbook Review Composer In The Ask LabRat Input Position

**Files:**
- Modify: `src/components/ProjectDashboard.test.jsx`
- Later implementation: `src/main.jsx`, `src/styles.css`

- [ ] **Step 1: Add confirm composer test**

Add this test under the existing `AgentPanel` tests:

```jsx
it("shows workbook review confirm and revision controls in the chat input area", async () => {
  localStorage.removeItem("labrat_blank_chat_history_v1_react");
  const onConfirmWorkbookUnderstanding = vi.fn(async () => ({
    workbookReviewSession: { id: "session_1", status: "accepted" },
  }));

  render(
    <AgentPanel
      open
      setOpen={() => {}}
      dataset={{ metadata: {}, experiments: [], genericImports: [] }}
      blocks={[]}
      setBlocks={() => {}}
      references={[]}
      selected={null}
      selectedChartContext={null}
      pendingChartAnalysis={null}
      activeProjectId="project_1"
      projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
      onProjectStateLoaded={() => {}}
      workbookReviewContext={{
        active: true,
        session: { id: "session_1", status: "needs_user_review" },
        workbookName: "Master.xlsx",
        currentUnderstanding: {
          id: "understanding_draft_1",
          facts: [{ factId: "fact_1", kind: "region_description" }],
        },
        pendingRedBoxes: [],
      }}
      onConfirmWorkbookUnderstanding={onConfirmWorkbookUnderstanding}
    />,
  );

  const composer = screen.getByLabelText("Workbook review response");
  expect(composer.querySelector("textarea")).toBeTruthy();
  expect(within(composer).getByRole("button", { name: "Confirm understanding" })).toBeTruthy();
  expect(within(composer).getByRole("button", { name: "Submit revision" })).toBeTruthy();
  expect(screen.queryByPlaceholderText("Ask the rat about your data, charts, or manuscript...")).toBeNull();

  fireEvent.click(within(composer).getByRole("button", { name: "Confirm understanding" }));
  await waitFor(() => expect(onConfirmWorkbookUnderstanding).toHaveBeenCalledWith(expect.objectContaining({
    workbookUnderstandingId: "understanding_draft_1",
  })));
});
```

- [ ] **Step 2: Add revision composer test**

Add:

```jsx
it("submits workbook review correction text with pending red boxes", async () => {
  localStorage.removeItem("labrat_blank_chat_history_v1_react");
  const onSubmitWorkbookReviewRevision = vi.fn(async () => ({
    workbookReviewSession: {
      id: "session_1",
      status: "needs_user_review",
      messages: [{ id: "msg_assistant_2", role: "assistant", content: "I updated the workbook understanding draft." }],
      currentUnderstanding: {
        id: "understanding_draft_2",
        facts: [{ factId: "fact_1", kind: "region_description" }],
      },
    },
  }));

  render(
    <AgentPanel
      open
      setOpen={() => {}}
      dataset={{ metadata: {}, experiments: [], genericImports: [] }}
      blocks={[]}
      setBlocks={() => {}}
      references={[]}
      selected={null}
      selectedChartContext={null}
      pendingChartAnalysis={null}
      activeProjectId="project_1"
      projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
      onProjectStateLoaded={() => {}}
      workbookReviewContext={{
        active: true,
        session: { id: "session_1", status: "needs_user_review" },
        workbookName: "Master.xlsx",
        currentUnderstanding: { id: "understanding_draft_1", facts: [] },
        pendingRedBoxes: [{
          clientRegionId: "draft_region_1",
          operation: "upsert",
          sourceDocumentId: "source_doc_1",
          sheetName: "Sheet1",
          range: "A1:B2",
          selectionMethod: "drag_select",
          description: "",
          status: "draft",
        }],
      }}
      onSubmitWorkbookReviewRevision={onSubmitWorkbookReviewRevision}
    />,
  );

  const composer = screen.getByLabelText("Workbook review response");
  fireEvent.change(within(composer).getByPlaceholderText("Describe what LabRat should change about the selected workbook regions..."), {
    target: { value: "This red box is the reaction rate table." },
  });
  fireEvent.click(within(composer).getByRole("button", { name: "Submit revision" }));

  await waitFor(() => expect(onSubmitWorkbookReviewRevision).toHaveBeenCalledWith(expect.objectContaining({
    message: "This red box is the reaction rate table.",
    previousUnderstandingId: "understanding_draft_1",
    redBoxUpdates: [expect.objectContaining({ range: "A1:B2", selectionMethod: "drag_select" })],
  })));
  expect(await screen.findByText("I updated the workbook understanding draft.")).toBeTruthy();
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
```

Expected: FAIL because the footer still renders the normal chat input and confirm button is still in the workbook context strip.

---

### Task 4: Implement Input-Area Workbook Review Composer

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add local correction draft state**

Inside `AgentPanel`, near `const [input, setInput] = useState("");`, add:

```jsx
const [workbookCorrectionDraft, setWorkbookCorrectionDraft] = useState("");
```

- [ ] **Step 2: Remove confirm action from the context strip**

In the `agent-workbook-context` block, remove the button:

```jsx
<button type="button" onClick={confirmWorkbookReviewFromAgent} disabled={!canConfirmWorkbookReview}>
  Confirm understanding
</button>
```

Keep the context strip as status-only:

```jsx
<div className="agent-workbook-context">
  <div>
    <strong>{workbookReviewContext.workbookName || "Workbook review"}</strong>
    <span>{workbookReviewContext.session?.status || "needs_review"} · {asArray(workbookReviewContext.pendingRedBoxes).length} pending red boxes</span>
  </div>
</div>
```

- [ ] **Step 3: Add revision submit helper**

Add:

```jsx
const submitWorkbookRevisionFromComposer = async () => {
  const text = workbookCorrectionDraft.trim();
  if (!workbookReviewActive || !text || busy) return;
  setWorkbookCorrectionDraft("");
  setHistory((current) => [...current, { role: "user", text }]);
  setBusy(true);
  try {
    const response = await onSubmitWorkbookReviewRevision?.({
      message: text,
      redBoxUpdates: asArray(workbookReviewContext.pendingRedBoxes),
      previousUnderstandingId: workbookReviewContext.currentUnderstanding?.id || null,
    });
    const session = response?.workbookReviewSession || response?.session || workbookReviewContext.session || null;
    const assistantMessage = asArray(session?.messages).filter((message) => message.role !== "user").at(-1);
    setHistory((current) => [...current, {
      role: "assistant",
      text: assistantMessage?.content || response?.clarification?.message || "I updated the workbook understanding draft.",
    }]);
  } catch (err) {
    setHistory((current) => [...current, { role: "assistant", text: `Workbook review update failed: ${err.message || String(err)}` }]);
  } finally {
    setBusy(false);
  }
};
```

- [ ] **Step 4: Render composer in the footer when workbook review is active**

Replace the normal footer contents with a conditional:

```jsx
<div className="agent-foot">
  {workbookReviewActive ? (
    <div className="agent-workbook-composer" aria-label="Workbook review response">
      <button
        type="button"
        className="agent-workbook-confirm"
        onClick={confirmWorkbookReviewFromAgent}
        disabled={!canConfirmWorkbookReview}
      >
        Confirm understanding
      </button>
      <textarea
        value={workbookCorrectionDraft}
        onChange={(event) => setWorkbookCorrectionDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submitWorkbookRevisionFromComposer();
          }
        }}
        placeholder="Describe what LabRat should change about the selected workbook regions..."
      />
      <button
        type="button"
        className="agent-workbook-revise"
        onClick={submitWorkbookRevisionFromComposer}
        disabled={busy || !workbookCorrectionDraft.trim()}
      >
        Submit revision
      </button>
    </div>
  ) : (
    <>
      {pendingSpreadsheetFile && (
        <div className="agent-pending-attachment">
          <span>{pendingSpreadsheetFile.name}</span>
          <button type="button" aria-label="Remove attached spreadsheet" onClick={() => setPendingSpreadsheetFile(null)}>
            x
          </button>
        </div>
      )}
      <button type="button" className="agent-tool" aria-label="Attach spreadsheet" title="Attach spreadsheet" onClick={chooseSpreadsheetAttachment}>+</button>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask the rat about your data, charts, or manuscript..." />
      <button type="button" className="agent-send" onClick={() => send()}>&#8593;</button>
      <input ref={fileActionInputRef} className="agent-file-input" type="file" accept=".xlsx,.xls" onChange={onAgentFileSelected} />
    </>
  )}
</div>
```

Keep the hidden file input available outside the conditional if file attachment must remain accessible after leaving workbook review. If the input is inside the non-workbook branch, verify that returning to normal chat still supports attachment.

- [ ] **Step 5: Remove duplicate revision route from `send()`**

Delete or bypass this block from `send()` because revision is now owned by the workbook composer:

```jsx
if (serverAgentEnabled && workbookReviewContext?.active && !meta?.source) {
  ...
}
```

This prevents pressing Enter in a normal-looking chat input from silently submitting a revision.

- [ ] **Step 6: Add styles**

Add to `src/styles.css` near existing `.agent-foot` styles:

```css
.agent-workbook-composer {
  display: grid;
  gap: 8px;
  width: 100%;
}

.agent-workbook-confirm,
.agent-workbook-revise {
  border: 1px solid var(--border);
  border-radius: 8px;
  font-weight: 650;
  min-height: 36px;
}

.agent-workbook-confirm {
  background: #2563eb;
  color: #fff;
}

.agent-workbook-confirm:disabled,
.agent-workbook-revise:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.agent-workbook-composer textarea {
  border: 1px solid var(--border);
  border-radius: 8px;
  min-height: 78px;
  padding: 10px;
  resize: vertical;
}
```

Keep labels English for the current app language. The semantic slots are the user's requested "confirm correct" and "input revision" actions.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
```

Expected: PASS.

---

### Task 5: Full Verification And Docs

**Files:**
- Modify: `doc/task-checklist.md`
- Modify: `doc/PROGRESS.md`

- [ ] **Step 1: Update checklist**

Set current objective to:

```markdown
Objective: Complete workbook upload review MVP interaction: left-drag red-box selection in Excel preview plus fixed Ask LabRat input-area confirm/revision composer.
```

Mention touched files:

```markdown
Touched areas: WorkbookReviewWorkspace drag selection, AgentPanel workbook composer, ProjectDashboard tests, styles, progress docs.
```

- [ ] **Step 2: Run targeted and full frontend verification**

Run:

```bash
npm test -- src/components/ProjectDashboard.test.jsx
npm test
npm run build
git diff --check
```

Expected:

- ProjectDashboard tests pass.
- Full frontend tests pass.
- Build exits 0. Existing Plotly chunk warning is acceptable.
- `git diff --check` exits 0. Existing LF/CRLF warnings are acceptable if unchanged.

- [ ] **Step 3: Backend verification**

Because this plan does not change backend code, backend tests are optional. If run:

```bash
npm --prefix backend test
```

Expected: PASS, with existing optional Postgres skip allowed.

- [ ] **Step 4: Update progress**

Add a newest-first entry to `doc/PROGRESS.md`:

```markdown
- Completed workbook review MVP interaction cleanup. Excel preview now supports left-drag local red-box selection, and Ask LabRat switches its fixed input area to a confirm/revision composer during active WorkbookReviewSession review. Confirm calls the existing confirm API; revision submits natural-language text plus pending red-box updates through the existing revision API. Verification: `npm test -- src/components/ProjectDashboard.test.jsx`, full `npm test`, `npm run build`, and `git diff --check` passed. Follow-up: manual Docker QA should verify drag feel, scrolling, suggestion click, revision loop, confirm, and reload.
```

---

## Manual QA Checklist

- [ ] Start Docker or local dev.
- [ ] Create/open a server project.
- [ ] Open Ask LabRat.
- [ ] Click `+`, attach an `.xlsx`, type a request, send.
- [ ] Confirm the main workspace switches to Excel preview and Ask LabRat remains the review surface.
- [ ] Click a suggested range; confirm it appears as a red box in the left Excel preview.
- [ ] Left-drag from one cell to another; confirm a new red box appears.
- [ ] Type a correction in the bottom workbook-review composer and submit revision.
- [ ] Confirm LabRat appends a new assistant reply and the composer remains available.
- [ ] Click confirm; confirm the session becomes accepted and no DatasetCommit, SourceExtractProposal, ChartSpec, or Manuscript block is created.
- [ ] Reload project; confirm accepted WorkbookUnderstanding is still available from project state/list endpoint.

## Self-Review

- Spec coverage: covers left-drag selection, fixed input-area confirm/revision composer, revision loop persistence through existing APIs, and confirm boundary.
- Placeholder scan: no TODO/TBD placeholders remain.
- Type consistency: uses existing `workbookReviewContext`, `onSubmitWorkbookReviewRevision`, `onConfirmWorkbookUnderstanding`, `workbookReviewDraftRegions`, `upsertDraftWorkbookRegion`, and SourceDocument A1 helpers already present in `src/main.jsx`.
