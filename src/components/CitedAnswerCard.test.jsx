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
  expect(await screen.findByText("Reading sources and checking citations…")).toBeTruthy();
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
  expect((await screen.findByRole("alert")).textContent).toContain("citations could not be verified");
  expect(screen.queryByText(/when the service is available/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText("Reading sources and checking citations…");
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
