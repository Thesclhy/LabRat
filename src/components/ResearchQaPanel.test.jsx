import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ResearchQaPanel } from "./ResearchQaPanel.jsx";
import { ResearchEvidenceViewer } from "./ResearchEvidenceViewer.jsx";
import * as api from "../data/researchQaApi.js";
import { uploadServerProjectFile, createServerWorkbookReviewSession } from "../data/serverApi.js";

vi.mock("../data/researchQaApi.js", () => ({
  listResearchQuestions: vi.fn(), createResearchQuestion: vi.fn(), getResearchQuestion: vi.fn(), cancelResearchQuestion: vi.fn(), retryResearchQuestion: vi.fn(),
  getResearchEvidence: vi.fn(), listContextDocuments: vi.fn(), registerContextDocument: vi.fn(), getContextDocumentVersion: vi.fn(),
  retryContextDocumentVersion: vi.fn(), archiveContextDocument: vi.fn(), listContextDocumentPassages: vi.fn(), contextDocumentPageUrl: vi.fn(() => "/synthetic.png"),
}));
vi.mock("../data/serverApi.js", () => ({ uploadServerProjectFile: vi.fn(), createServerWorkbookReviewSession: vi.fn() }));

const source = { id: "ev", kind: "document_passage", label: "Protocol.pdf", version: { versionId: "version-1", versionNumber: 1 },
  locator: { kind: "pdf", page: 2, rectangles: [{ left: .1, top: .2, width: .5, height: .04 }] },
  data: { text: "Use 80 C for dry samples only.", uncertain: false }, coverage: { scope: "one_passage" }, warnings: [] };
const complete = { request: { runId: "run", question: "What temperature is documented?", status: "completed" }, artifact: { evidence: [source],
  answer: { status: "answered", claims: [{ text: "The protocol states 80 C for dry samples.", citations: [{ evidenceId: "ev", quote: "80 C for dry samples" }] }], missingEvidence: [], limitations: ["One passage only"] } } };
const props = { open: true, projectId: "project", canEdit: false, onClose: vi.fn(), projectState: {} };

beforeEach(() => {
  vi.resetAllMocks();
  api.listResearchQuestions.mockResolvedValue({ items: [], nextCursor: null });
  api.listContextDocuments.mockResolvedValue({ items: [], nextCursor: null });
  api.createResearchQuestion.mockResolvedValue(complete); api.getResearchQuestion.mockResolvedValue(complete);
  api.getResearchEvidence.mockResolvedValue({ evidence: source }); api.contextDocumentPageUrl.mockReturnValue("/synthetic.png");
});
afterEach(() => vi.restoreAllMocks());

describe("cited source Q&A interface", () => {
  test("View member asks, opens an exact original-page citation, and has no write controls", async () => {
    render(<ResearchQaPanel {...props} />);
    expect(screen.queryByRole("button", { name: "Upload sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Analysis & manuscript" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Question about project sources"), { target: { value: "What temperature is documented?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask with citations" }));
    expect(await screen.findByText("The protocol states 80 C for dry samples.")).toBeTruthy();
    expect(api.createResearchQuestion.mock.calls[0][1].question).toBe("What temperature is documented?");
    fireEvent.click(screen.getByRole("button", { name: /Protocol.pdf · Page 2/ }));
    expect(await screen.findByText("Use 80 C for dry samples only.")).toBeTruthy();
    expect(api.getResearchEvidence).toHaveBeenCalledWith("project", "run", "ev", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByAltText("Original Protocol.pdf, page 2").getAttribute("src")).toBe("/synthetic.png");
    expect(document.querySelector(".qa-source-highlight").style.top).toBe("20%");
    fireEvent.click(screen.getByRole("button", { name: "Close source evidence" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("refresh restores server answers; viewers get review guidance without proposal permission", async () => {
    const review = { ...complete, artifact: { evidence: [], answer: { status: "needs_analysis", claims: [], missingEvidence: [], limitations: [] } } };
    api.listResearchQuestions.mockResolvedValue({ items: [review.request], nextCursor: null }); api.getResearchQuestion.mockResolvedValue(review);
    render(<ResearchQaPanel {...props} />);
    expect(await screen.findByText("This needs a reviewed analysis plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Prepare a reviewed analysis plan" })).toBeNull();
    expect(screen.getByText(/An editor can prepare/)).toBeTruthy();
    expect(api.createResearchQuestion).not.toHaveBeenCalled();
  });

  test("an editor explicitly hands new calculations to the existing review flow", async () => {
    const onAnalysis = vi.fn();
    const review = { ...complete, artifact: { evidence: [], answer: { status: "needs_analysis", claims: [], missingEvidence: [], limitations: [] } } };
    api.listResearchQuestions.mockResolvedValue({ items: [review.request], nextCursor: null }); api.getResearchQuestion.mockResolvedValue(review);
    render(<ResearchQaPanel {...props} canEdit onAnalysis={onAnalysis} />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a reviewed analysis plan" }));
    expect(onAnalysis).toHaveBeenCalledWith(complete.request.question);
  });

  test("Word uploads become available immediately and Excel reuses workbook review", async () => {
    const onWorkbookUploaded = vi.fn();
    uploadServerProjectFile.mockResolvedValue({ fileObject: { id: "file" } });
    api.registerContextDocument.mockResolvedValue({ version: { id: "version", status: "ready" } });
    createServerWorkbookReviewSession.mockResolvedValue({ workbookReviewSession: { id: "review" } });
    render(<ResearchQaPanel {...props} canEdit onWorkbookUploaded={onWorkbookUploaded} />);
    const upload = screen.getByLabelText("Upload PDF, Word, TXT or Excel");
    fireEvent.change(upload, { target: { files: [new File(["synthetic"], "method.docx"), new File(["synthetic"], "data.xls")] } });
    await waitFor(() => expect(onWorkbookUploaded).toHaveBeenCalledTimes(1));
    expect(api.registerContextDocument).toHaveBeenCalledTimes(1);
    expect(createServerWorkbookReviewSession).toHaveBeenCalledWith("project", { fileObjectId: "file" }, expect.anything());
    expect(screen.queryByRole("button", { name: /Accept for Q&A|Confirm inclusion/ })).toBeNull();
  });

  test("uncertain OCR and raw missing formulas are visible and source strings are never interpreted as HTML", async () => {
    const evidence = { ...source, data: { text: "<script>window.bad=true</script>", uncertain: true } };
    api.getResearchEvidence.mockResolvedValue({ evidence });
    const { rerender } = render(<ResearchEvidenceViewer projectId="project" selection={{ runId: "run", evidenceId: "ev" }} onClose={() => {}} />);
    expect(await screen.findByText(/OCR is uncertain/)).toBeTruthy();
    expect(document.querySelector("dialog script")).toBeNull();
    api.getResearchEvidence.mockResolvedValue({ evidence: { kind: "workbook_raw", label: "data.xls", locator: { sheet: "Sheet1", range: "A1" }, version: {},
      data: { cells: [{ address: "A1", rawValue: null, formattedValue: null, formula: "B1*2", cacheMissing: true }] } } });
    rerender(<ResearchEvidenceViewer projectId="project" selection={{ runId: "run", evidenceId: "raw" }} onClose={() => {}} />);
    expect(await screen.findByText(/B1\*2 · no cached value/)).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByText("Missing")).toHaveLength(2);
  });

  test("switching project aborts in-flight reads and prevents a late answer from entering the new project", async () => {
    let resolveOld;
    api.listResearchQuestions.mockResolvedValue({ items: [complete.request], nextCursor: null });
    api.getResearchQuestion.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<ResearchQaPanel key="old" {...props} />);
    await waitFor(() => expect(api.getResearchQuestion).toHaveBeenCalled());
    const oldSignal = api.getResearchQuestion.mock.calls[0][2].signal;
    api.listResearchQuestions.mockResolvedValue({ items: [], nextCursor: null });
    rerender(<ResearchQaPanel key="new" {...props} projectId="new-project" />);
    expect(oldSignal.aborted).toBe(true);
    resolveOld(complete);
    await waitFor(() => expect(screen.queryByText("The protocol states 80 C for dry samples.")).toBeNull());
  });
});
