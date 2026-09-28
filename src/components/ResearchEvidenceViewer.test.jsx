import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ResearchEvidenceViewer, evidenceLocation } from "./ResearchEvidenceViewer.jsx";
import * as api from "../data/researchQaApi.js";

vi.mock("../data/researchQaApi.js", () => ({
  getResearchEvidence: vi.fn(), getContextDocumentVersion: vi.fn(), listContextDocumentPassages: vi.fn(),
  contextDocumentPageUrl: vi.fn(),
}));
const selection = { document: { originalName: "Protocol.pdf" }, currentVersion: { id: "v1", versionNumber: 1,
  metadata: { extension: "pdf", pageCount: 3, coverage: [
    { page: 1, status: "ready", warnings: [] },
    { page: 2, status: "ready", warnings: ["ocr_uncertain_text_check_original"] },
    { page: 3, status: "failed", warnings: ["no_readable_text_check_original"] },
  ] } } };
const citation = { id: "ev1", kind: "document_passage", label: "Protocol.pdf", version: { versionId: "historic-v1", versionNumber: 1 },
  locator: { kind: "pdf", page: 2, line: 4, rectangles: [{ left: .1, top: .2, width: .3, height: .05 }] },
  data: { text: "Sample Exp17", uncertain: true }, warnings: [] };

beforeEach(() => {
  vi.resetAllMocks();
  api.contextDocumentPageUrl.mockImplementation((project, version, page) => `/${project}/${version}/pages/${page}`);
  api.getResearchEvidence.mockResolvedValue({ evidence: citation });
  api.getContextDocumentVersion.mockResolvedValue({ version: { ...selection.currentVersion, id: "historic-v1" } });
});

test("library PDF shows every page once, including unreadable pages, without fetching passage batches", async () => {
  render(<ResearchEvidenceViewer projectId="p" selection={selection} onClose={() => {}} />);
  const picker = await screen.findByRole("combobox", { name: "Page", exact: true });
  expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["1", "2", "3"]);
  expect(screen.getByRole("button", { name: "Previous page" }).disabled).toBe(true);
  expect(api.listContextDocumentPassages).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Passage")).toBeNull();
  expect(screen.queryByRole("button", { name: "Load more passages" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByAltText("Original Protocol.pdf, page 2").getAttribute("src")).toBe("/p/v1/pages/2");
  expect(screen.getByText(/OCR is uncertain/)).toBeTruthy();
  fireEvent.change(picker, { target: { value: "3" } });
  expect(screen.getByAltText("Original Protocol.pdf, page 3")).toBeTruthy();
  expect(screen.getByText(/Searchable text is incomplete/)).toBeTruthy();
  expect(screen.queryByText(/OCR is uncertain/)).toBeNull();
  expect(screen.getByRole("button", { name: "Next page" }).disabled).toBe(true);
  fireEvent.load(screen.getByRole("img"));
  expect(document.querySelector(".qa-source-highlight")).toBeNull();
  screen.getByRole("dialog").scrollTop = 700;
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(screen.getByRole("dialog").scrollTop).toBe(0);
});

test("citation opens its pinned page, clears highlights on other pages and can return to the cited page", async () => {
  render(<ResearchEvidenceViewer projectId="p" selection={{ runId: "r", evidenceId: "ev1" }} onClose={() => {}} />);
  await screen.findByText("Sample Exp17");
  await waitFor(() => expect(screen.getByText("of 3")).toBeTruthy());
  expect(api.getContextDocumentVersion).toHaveBeenCalledWith("p", "historic-v1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByRole("combobox", { name: "Page", exact: true }).value).toBe("2");
  fireEvent.load(screen.getByRole("img"));
  expect(document.querySelector(".qa-source-highlight").style.top).toBe("20%");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  fireEvent.load(screen.getByRole("img"));
  expect(document.querySelector(".qa-source-highlight")).toBeNull();
  expect(screen.queryByText("Sample Exp17")).toBeNull();
  expect(screen.getByRole("img").getAttribute("src")).toBe("/p/historic-v1/pages/3");
  fireEvent.click(screen.getByRole("button", { name: "Return to cited page 2" }));
  fireEvent.load(screen.getByRole("img"));
  expect(document.querySelector(".qa-source-highlight")).toBeTruthy();
  expect(screen.getByText("Sample Exp17")).toBeTruthy();
  expect(evidenceLocation(citation)).toBe("Page 2");
});

test("page image failure can be retried and does not leak into the next page", async () => {
  render(<ResearchEvidenceViewer projectId="p" selection={selection} onClose={() => {}} />);
  fireEvent.error(await screen.findByRole("img"));
  expect(screen.getByRole("alert").textContent).toContain("This page could not be displayed");
  fireEvent.click(screen.getByRole("button", { name: "Retry page", exact: true }));
  fireEvent.load(screen.getByRole("img"));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.error(screen.getByRole("img"));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.queryByRole("button", { name: "Retry page", exact: true })).toBeNull();
  expect(screen.getByAltText("Original Protocol.pdf, page 2")).toBeTruthy();
});

test("late version metadata cannot cross project or file selection", async () => {
  let finish;
  api.getContextDocumentVersion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<ResearchEvidenceViewer projectId="old" selection={{ runId: "r", evidenceId: "ev1" }} onClose={() => {}} />);
  await screen.findByText("Sample Exp17");
  const signal = api.getContextDocumentVersion.mock.calls[0][2].signal;
  rerender(<ResearchEvidenceViewer projectId="new" selection={selection} onClose={() => {}} />);
  await screen.findByAltText("Original Protocol.pdf, page 1");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ version: { metadata: { pageCount: 99 } } }));
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.getByRole("img").getAttribute("src")).toBe("/new/v1/pages/1");
  expect(screen.queryByText("Sample Exp17")).toBeNull();
});

test("page count failure preserves the citation and offers a bounded retry", async () => {
  api.getContextDocumentVersion.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(<ResearchEvidenceViewer projectId="p" selection={{ runId: "r", evidenceId: "ev1" }} onClose={() => {}} />);
  await screen.findByText(/Connection interrupted/);
  expect(screen.getByText("Sample Exp17")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next page" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry page count" }));
  await screen.findByText("of 3");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("oversized PDFs disclose the preview limit without requesting unsupported pages", async () => {
  render(<ResearchEvidenceViewer projectId="p" selection={{ ...selection, currentVersion: {
    ...selection.currentVersion, metadata: { pageCount: 201 },
  } }} onClose={() => {}} />);
  await screen.findByText("Preview is available for the first 200 of 201 pages.");
  const picker = screen.getByRole("combobox", { name: "Page", exact: true });
  expect(within(picker).getAllByRole("option")).toHaveLength(200);
  fireEvent.change(picker, { target: { value: "200" } });
  expect(screen.getByRole("button", { name: "Next page" }).disabled).toBe(true);
  expect(screen.getByRole("img").getAttribute("src")).toBe("/p/v1/pages/200");
});

test("TXT keeps line navigation and cursor pagination", async () => {
  api.listContextDocumentPassages.mockResolvedValueOnce({ items: [
    { text: "First paragraph", locator: { kind: "text", lineStart: 1, lineEnd: 2 } },
    { text: "Second paragraph", locator: { kind: "text", lineStart: 4, lineEnd: 5 } },
  ], nextCursor: "2" }).mockResolvedValueOnce({ items: [
    { text: "Last paragraph", locator: { kind: "text", lineStart: 7, lineEnd: 8 } },
  ], nextCursor: null });
  render(<ResearchEvidenceViewer projectId="p" selection={{ document: { originalName: "Notes.txt" }, currentVersion: { id: "txt1" } }} onClose={() => {}} />);
  await screen.findByText("First paragraph");
  fireEvent.change(screen.getByLabelText("Passage"), { target: { value: "1" } });
  expect(screen.getByText("Second paragraph")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load more passages" }));
  await screen.findByRole("option", { name: "Lines 7–8" });
  fireEvent.change(screen.getByLabelText("Passage"), { target: { value: "2" } });
  expect(screen.getByText("Last paragraph")).toBeTruthy();
  expect(api.getContextDocumentVersion).not.toHaveBeenCalled();
});
