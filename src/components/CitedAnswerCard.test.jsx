import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { CitedAnswerCard } from "./CitedAnswerCard.jsx";
import * as api from "../data/researchQaApi.js";

vi.mock("../data/researchQaApi.js", () => ({ getResearchQuestion: vi.fn(), retryResearchQuestion: vi.fn(), cancelResearchQuestion: vi.fn() }));
const response = (status, failureCode) => ({ request: { runId: "run", status, failureCode }, artifact: null });
beforeEach(() => vi.resetAllMocks());

test("running status keeps its action separate and cancel settles the card", async () => {
  api.getResearchQuestion.mockResolvedValue(response("running"));
  api.cancelResearchQuestion.mockImplementation(async () => {
    const cancelled = response("cancelled"); api.getResearchQuestion.mockResolvedValue(cancelled); return cancelled;
  });
  render(<CitedAnswerCard projectId="project" runId="run" />);
  expect(await screen.findByText("Reading sources…")).toBeTruthy();
  expect(screen.getByRole("status").querySelector("button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByText("Question cancelled.");
  expect(api.cancelResearchQuestion).toHaveBeenCalledWith("project", "run", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("citation failure explains the problem and retry resumes the same saved question", async () => {
  api.getResearchQuestion.mockResolvedValue(response("failed", "qa_citation_invalid"));
  api.retryResearchQuestion.mockImplementation(async () => {
    const running = response("running"); api.getResearchQuestion.mockResolvedValue(running); return running;
  });
  render(<CitedAnswerCard projectId="project" runId="run" />);
  expect((await screen.findByRole("alert")).textContent).toContain("earlier answer failed a citation check");
  expect(screen.queryByText(/when the service is available/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText("Reading sources…");
  await waitFor(() => expect(api.retryResearchQuestion).toHaveBeenCalledTimes(1));
  expect(api.retryResearchQuestion).toHaveBeenCalledWith("project", "run", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("queued questions still offer explicit start and cancel", async () => {
  api.getResearchQuestion.mockResolvedValue(response("queued"));
  render(<CitedAnswerCard projectId="project" runId="run" />);
  await screen.findByText("Question saved and waiting to start.");
  expect(screen.getByRole("button", { name: "Start saved question" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

test("read limits keep a source record without claiming the information is absent", async () => {
  api.getResearchQuestion.mockResolvedValue({request:{runId:"run",status:"completed"},artifact:{
    answer:{status:"insufficient_evidence",route:"read_limit",claims:[],provenanceVersion:2,
      missingEvidence:["Narrow the question or select a source to continue."]},
    evidence:[],trace:[{tool:"search_project_documents",phase:"discovery",input:{query:"cobalt"},status:"ok",returnedCount:0}]
  }});
  render(<CitedAnswerCard projectId="project" runId="run" />);
  await screen.findByText("The question could not be completed within the reading limit.");
  expect(screen.queryByText("The available sources do not support a complete answer.")).toBeNull();
  expect(screen.queryByRole("button",{name:"Retry question"})).toBeNull();
  expect(screen.getByText("Sources read · 0")).toBeTruthy();
  expect(screen.getByText("0 matches · search only")).toBeTruthy();
});
