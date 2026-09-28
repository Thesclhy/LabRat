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
  test("Excel upload retains its original question in a pending task", async () => {
    server.uploadServerProjectFile.mockResolvedValue({ fileObject: { id: "file" } });
    server.createServerWorkbookReviewSession.mockResolvedValue({ workbookReviewSession: { id: "review", sourceDocumentId: "source" }, sourceDocument: { id: "source" }, regions: [] });
    const view = render(<AgentPanel {...panel} canEdit onWorkbookReviewReady={vi.fn()} />);
    fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [new File(["synthetic"], "data.xlsx")] } });
    fireEvent.change(screen.getByLabelText("Ask LabRat"), { target: { value: "Compare these experiments" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Next: Compare these experiments")).toBeTruthy();
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue after region review" }).disabled).toBe(true);
    view.rerender(<AgentPanel {...panel} canEdit onWorkbookReviewReady={vi.fn()} projectState={{ ...panel.projectState,
      workbookReviewRegions: [{ sourceDocumentId: "source", disposition: "active", reviewStatus: "accepted", acceptedRevisionId: "r1", currentRevisionId: "r1" }] }} />);
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue after region review" }));
    await waitFor(() => expect(api.createResearchQuestion).toHaveBeenCalledWith("project", expect.objectContaining({
      question: "Compare these experiments\nUse the confirmed regions of: data.xlsx [sourceDocumentId: source]." }), expect.anything()));
  });
  test("reference management is searchable in a separate workspace and read-only for View", async () => {
    render(<ReferenceLibrary projectId="project" canEdit={false} />);
    expect(await screen.findByRole("button", { name: "Method.pdf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull(); expect(screen.queryByRole("button", { name: "New version" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search references"), { target: { value: "Meth" } });
    await waitFor(() => expect(api.listContextDocuments).toHaveBeenCalledWith("project", expect.objectContaining({ search: "Meth" }), expect.anything()));
  });
});
