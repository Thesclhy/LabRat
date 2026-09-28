import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ReferenceMentionComposer } from "./ReferenceMentionComposer.jsx";
import { ReferenceLibrary } from "./ReferenceLibrary.jsx";
import { AgentPanel } from "../main.jsx";
import * as api from "../data/researchQaApi.js";
import * as server from "../data/serverApi.js";

vi.mock("../charts/Plot.jsx", () => ({ Plot: () => <div /> }));
vi.mock("../data/researchQaApi.js", async (original) => ({ ...(await original()),
  listContextDocuments: vi.fn(), listResearchQuestions: vi.fn(), createResearchQuestion: vi.fn(), getResearchQuestion: vi.fn(),
  archiveContextDocument: vi.fn(), getContextDocument: vi.fn(), registerContextDocument: vi.fn(), getContextDocumentVersion: vi.fn(),
  listAssistantTasks: vi.fn(), createAssistantTask: vi.fn(), getAssistantTask: vi.fn(), attachAssistantTaskFile: vi.fn(), continueAssistantTask: vi.fn(), cancelAssistantTask: vi.fn(),
}));
vi.mock("../data/serverApi.js", async (original) => ({ ...(await original()), createServerAgentRun: vi.fn(),
  uploadServerProjectFile: vi.fn(), createServerWorkbookReviewSession: vi.fn(), getServerProjectState: vi.fn() }));
vi.mock("../data/analysisApi.js", async (original) => ({ ...(await original()), getProjectAnalysisCapabilities: vi.fn(async () => ({ model: { configured: true }, acceptedData: {} })) }));

const document = { document: { id: "doc", originalName: "Method.pdf", version: 2, updatedAt: "2026-09-28T00:00:00Z" },
  currentVersion: { id: "version", versionNumber: 1, status: "ready" } };
const complete = { request: { runId: "qa-run", question: "Read the method", status: "completed" }, artifact: {
  evidence: [], answer: { status: "insufficient_evidence", claims: [], missingEvidence: [], limitations: [] } } };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  api.listContextDocuments.mockResolvedValue({ items: [document], nextCursor: null });
  api.listResearchQuestions.mockResolvedValue({ items: [], nextCursor: null });
  api.listAssistantTasks.mockResolvedValue({ items: [], nextCursor: null });
  api.createResearchQuestion.mockResolvedValue(complete); api.getResearchQuestion.mockResolvedValue(complete);
  server.getServerProjectState.mockResolvedValue({ project: { id: "project" } });
});
function Composer({ send = vi.fn(), selected = vi.fn() }) {
  const [value, setValue] = useState(""), [references, setReferences] = useState([]);
  return <ReferenceMentionComposer projectId="project" value={value} onChange={setValue} references={references}
    onReferencesChange={(items) => { setReferences(items); selected(items); }} onSend={send} canAttach />;
}
const panel = { open: true, setOpen: vi.fn(), blocks: [], setBlocks: vi.fn(), references: [], activeProjectId: "project",
  actorId: "actor", projectState: { project: { id: "project", name: "Research project" } }, canAsk: true, canEdit: false };

describe("unified Ask", () => {
  test("only-selected wording updates the scope hint without treating an ordinary mention as exclusive", async () => {
    render(<Composer />);
    const input = screen.getByLabelText("Ask LabRat");
    fireEvent.change(input, { target: { value: "@Meth", selectionStart: 5 } });
    fireEvent.click(await screen.findByRole("option"));
    for (const question of ["Based only on this document, what sample is required?", "Based solely on this document, what sample is required?", "Only use this method", "仅根据这份资料回答"]) {
      fireEvent.change(input, { target: { value: question } });
      expect(screen.getByText("Only selected references for this question.")).toBeTruthy();
    }
    fireEvent.change(input, { target: { value: "Compare this method with my experiments" } });
    expect(screen.getByText("Selected references first; other project evidence when needed.")).toBeTruthy();
  });
  test("@ selection binds a document version, removes its query and can be removed", async () => {
    const selected = vi.fn(), send = vi.fn(); render(<Composer selected={selected} send={send} />);
    const input = screen.getByLabelText("Ask LabRat");
    fireEvent.change(input, { target: { value: "Read @Meth", selectionStart: 10 } });
    expect(await screen.findByRole("option")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(selected).toHaveBeenCalledWith([{ documentId: "doc", versionId: "version", label: "Method.pdf", versionNumber: 1 }]);
    expect(input.value).toBe("Read "); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Method.pdf" }));
    expect(selected).toHaveBeenLastCalledWith([]);
  });
  test("Chinese composition confirmation does not send a question", () => {
    const send = vi.fn(); render(<Composer send={send} />); const input = screen.getByLabelText("Ask LabRat");
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: "实验" } }); fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled(); fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true }); expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" }); expect(send).toHaveBeenCalledTimes(1);
  });
  test("unready references cannot be selected", async () => {
    api.listContextDocuments.mockResolvedValue({ items: [{ ...document, currentVersion: { ...document.currentVersion, status: "processing" } }], nextCursor: null });
    const selected = vi.fn(); render(<Composer selected={selected} />);
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "@", selectionStart: 1 } });
    fireEvent.click(await screen.findByRole("option")); expect(selected).not.toHaveBeenCalled();
  });
  test("View members use the unified composer without upload or analysis writes", async () => {
    render(<AgentPanel {...panel} />);
    expect(screen.queryByRole("button", { name: "Add files" })).toBeNull();
    expect(screen.queryByText("Analysis & manuscript")).toBeNull(); expect(screen.queryByText("Source questions")).toBeNull();
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "Read the method" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(api.createResearchQuestion).toHaveBeenCalledTimes(1));
    expect(server.createServerAgentRun).not.toHaveBeenCalled();
    expect(await screen.findByText("The available sources do not support a complete answer.")).toBeTruthy();
  });
  test("removing experiment context changes the actual request", async () => {
    render(<AgentPanel {...panel} selected={{ label: "Exp17" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Experiment: Exp17 ×" }));
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "What does the source say?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(api.createResearchQuestion).toHaveBeenCalled());
    expect(api.createResearchQuestion.mock.calls[0][1].selectedExperimentLabel).toBe("");
  });
  test("persisted conversation is separated by actor", async () => {
    localStorage.setItem("labrat_blank_chat_history_v2_project_other_project", JSON.stringify([{ role: "user", text: "Other actor private question" }]));
    render(<AgentPanel {...panel} />);
    await waitFor(() => expect(api.listResearchQuestions).toHaveBeenCalled());
    expect(screen.queryByText("Other actor private question")).toBeNull();
  });
  test("attachment-only Excel goes to original review and never to reference registration", async () => {
    server.uploadServerProjectFile.mockResolvedValue({ fileObject: { id: "file" } });
    server.createServerWorkbookReviewSession.mockResolvedValue({ workbookReviewSession: { id: "review", sourceDocumentId: "source" }, sourceDocument: { id: "source" }, regions: [] });
    const view = render(<AgentPanel {...panel} canEdit onWorkbookReviewReady={vi.fn()} />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["synthetic"], "data.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(server.createServerWorkbookReviewSession).toHaveBeenCalledWith("project", { fileObjectId: "file" }, expect.anything()));
    expect(api.registerContextDocument).not.toHaveBeenCalled(); expect(api.createResearchQuestion).not.toHaveBeenCalled();
  });
  test("sending reference files clears composer attachments and selections but keeps upload receipts", async () => {
    server.uploadServerProjectFile.mockImplementation(async (_project, file) => ({ fileObject: { id: file.name } }));
    api.registerContextDocument.mockImplementation(async (_project, id) => ({ document: { id, originalName: id }, version: { id: `v-${id}`, versionNumber: 1, status: "ready" } }));
    const view = render(<AgentPanel {...panel} canEdit />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["method"], "method.txt"), new File(["control"], "control.docx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("control.docx was added to the reference library.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" }).disabled).toBe(false));
    expect(screen.queryByLabelText("Attached files")).toBeNull();
    expect(screen.queryByLabelText("Selected references")).toBeNull();
    expect(screen.getByText("method.txt was added to the reference library.")).toBeTruthy();
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
  });
  test("clearing uploaded file chips keeps their versions on the accompanying question", async () => {
    let finishQuestion;
    api.createResearchQuestion.mockImplementationOnce(() => new Promise((resolve) => { finishQuestion = resolve; }));
    server.uploadServerProjectFile.mockResolvedValue({ fileObject: { id: "file" } });
    api.registerContextDocument.mockResolvedValue({ document: { id: "method", originalName: "method.txt" }, version: { id: "method-v1", versionNumber: 1, status: "ready" } });
    const view = render(<AgentPanel {...panel} canEdit />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["method"], "method.txt")] } });
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "What sample does this method require?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(api.createResearchQuestion).toHaveBeenCalledWith("project", expect.objectContaining({ referenceDocuments: [{ documentId: "method", versionId: "method-v1" }] }), expect.anything()));
    expect(screen.queryByLabelText("Attached files")).toBeNull();
    expect(screen.queryByLabelText("Selected references")).toBeNull();
    finishQuestion(complete);
    await screen.findByText("The available sources do not support a complete answer.");
  });
  test("partial upload failure restores only unsent files and retry does not upload successful files again", async () => {
    let failNext = true;
    server.uploadServerProjectFile.mockImplementation(async (_project, file) => {
      if (file.name === "second.txt" && failNext) { failNext = false; throw new Error("Upload interrupted"); }
      return { fileObject: { id: file.name } };
    });
    api.registerContextDocument.mockImplementation(async (_project, id) => ({ document: { id, originalName: id }, version: { id: `v-${id}`, versionNumber: 1, status: "ready" } }));
    const view = render(<AgentPanel {...panel} canEdit />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: ["first.txt", "second.txt", "third.txt"].map((name) => new File([name], name)) } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Upload interrupted");
    expect(screen.getByLabelText("Attached files").textContent).toContain("second.txt");
    expect(screen.getByLabelText("Attached files").textContent).toContain("third.txt");
    expect(screen.getByLabelText("Attached files").textContent).not.toContain("first.txt");
    expect(screen.queryByLabelText("Selected references")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("third.txt was added to the reference library.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" }).disabled).toBe(false));
    expect(screen.queryByLabelText("Attached files")).toBeNull();
    expect(screen.queryByLabelText("Selected references")).toBeNull();
    expect(server.uploadServerProjectFile.mock.calls.map(([, file]) => file.name)).toEqual(["first.txt", "second.txt", "second.txt", "third.txt"]);
    expect(api.registerContextDocument.mock.calls.map(([, id]) => id)).toEqual(["first.txt", "second.txt", "third.txt"]);
  });
  test("registered files with parsing errors stay in the library rather than becoming new upload attachments", async () => {
    server.uploadServerProjectFile.mockResolvedValue({ fileObject: { id: "file" } });
    api.registerContextDocument.mockResolvedValue({ document: { id: "method", originalName: "method.txt" }, version: { id: "method-v1", versionNumber: 1, status: "failed" } });
    const view = render(<AgentPanel {...panel} canEdit />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["method"], "method.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("method.txt is not ready. Check its status or retry in the reference library.");
    expect(screen.queryByLabelText("Attached files")).toBeNull();
    expect(screen.queryByLabelText("Selected references")).toBeNull();
    expect(screen.getByText("method.txt was added to the reference library.")).toBeTruthy();
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
  });
  test("Excel upload retains its original question in a pending task", async () => {
    let task = { id: "task", status: "waiting", question: "Compare these experiments", referencesReady: true, ready: false,
      attachments: [{ name: "data.xlsx", kind: "workbook", state: "needs_upload" }] };
    api.listAssistantTasks.mockImplementation(async () => ({ items: api.createAssistantTask.mock.calls.length ? [task] : [], nextCursor: null }));
    api.createAssistantTask.mockImplementation(async () => task); api.getAssistantTask.mockImplementation(async () => task);
    api.attachAssistantTaskFile.mockImplementation(async () => (task = { ...task, attachments: [{ ...task.attachments[0], state: "needs_review", workbookReviewSessionId: "review" }] }));
    api.continueAssistantTask.mockResolvedValue(complete);
    server.uploadServerProjectFile.mockResolvedValue({ fileObject: { id: "file" } });
    server.createServerWorkbookReviewSession.mockResolvedValue({ workbookReviewSession: { id: "review", sourceDocumentId: "source" }, sourceDocument: { id: "source" }, regions: [] });
    const view = render(<AgentPanel {...panel} canEdit onWorkbookReviewReady={vi.fn()} />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["synthetic"], "data.xlsx")] } });
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "Compare these experiments" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(api.attachAssistantTaskFile).toHaveBeenCalledWith("project", "task", { index: 0, workbookReviewSessionId: "review" }, expect.anything()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue question" }).disabled).toBe(true));
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
    expect(api.createAssistantTask.mock.invocationCallOrder[0]).toBeLessThan(server.uploadServerProjectFile.mock.invocationCallOrder[0]);
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.getByRole("button", { name: "Continue question" }).disabled).toBe(true);
    expect(api.cancelAssistantTask).not.toHaveBeenCalled();
    task = { ...task, ready: true };
    view.unmount(); localStorage.clear();
    render(<AgentPanel {...panel} canEdit />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue question" }).disabled).toBe(false));
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue question" }));
    await waitFor(() => expect(api.continueAssistantTask).toHaveBeenCalledWith("project", "task", expect.anything()));
  });
  test("reference management is searchable in a separate workspace and read-only for View", async () => {
    render(<ReferenceLibrary projectId="project" canEdit={false} />);
    expect(await screen.findByRole("button", { name: "Method.pdf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull(); expect(screen.queryByRole("button", { name: "New version" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search references"), { target: { value: "Meth" } });
    await waitFor(() => expect(api.listContextDocuments).toHaveBeenCalledWith("project", expect.objectContaining({ search: "Meth" }), expect.anything()));
  });
  test("an uncertain task-save response retries the exact frozen request before uploading", async () => {
    const saved = { id: "saved", status: "waiting", question: "Read my workbook", attachments: [{ name: "data.xlsx", kind: "workbook", state: "needs_review" }] };
    api.createAssistantTask.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce(saved);
    api.getAssistantTask.mockResolvedValue(saved);
    const view = render(<AgentPanel {...panel} canEdit />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["synthetic"], "data.xlsx")] } });
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "Read my workbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(/has not been confirmed saved/);
    expect(server.uploadServerProjectFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(api.createAssistantTask).toHaveBeenCalledTimes(2));
    expect(api.createAssistantTask.mock.calls[1][1]).toEqual(api.createAssistantTask.mock.calls[0][1]);
  });
});
