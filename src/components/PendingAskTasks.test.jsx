import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PendingAskTasks } from "./PendingAskTasks.jsx";
import * as api from "../data/researchQaApi.js";
vi.mock("../data/researchQaApi.js", () => ({ listAssistantTasks: vi.fn(), getAssistantTask: vi.fn(),
  continueAssistantTask: vi.fn(), cancelAssistantTask: vi.fn(), getResearchQuestion: vi.fn() }));
const task = { id: "saved", status: "waiting", question: "Private pending question", ready: true, referencesReady: true,
  attachments: [{ name: "data.xlsx", kind: "workbook", state: "ready", workbookReviewSessionId: "review" }] };
beforeEach(() => { vi.resetAllMocks(); api.listAssistantTasks.mockResolvedValue({ items: [task], nextCursor: null }); });
test("recovers a committed question after continue response loss without starting it again", async () => {
  const continued = vi.fn(), answer = { request: { runId: "run", status: "completed" } };
  api.getAssistantTask.mockResolvedValue({ ...task, status: "submitted", runId: "run" });
  api.getResearchQuestion.mockResolvedValue(answer);
  api.continueAssistantTask.mockImplementation(async () => {
    api.listAssistantTasks.mockResolvedValue({ items: [], nextCursor: null });
    throw new Error("Connection lost");
  });
  render(<PendingAskTasks projectId="project" onContinue={continued} />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue question" }));
  await waitFor(() => expect(continued).toHaveBeenCalledWith(expect.objectContaining({ runId: "run" }), answer));
  expect(api.continueAssistantTask).toHaveBeenCalledTimes(1);
});
test("View can explicitly continue an owned task and revocation removes previously visible metadata", async () => {
  render(<PendingAskTasks projectId="project" canEdit={false} />);
  expect(await screen.findByText(task.question)).toBeTruthy();
  expect(screen.queryByLabelText("Upload missing data.xlsx")).toBeNull();
  api.listAssistantTasks.mockRejectedValue(Object.assign(new Error("Access removed"), { status: 403 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByText(task.question)).toBeNull());
});
test("missing file stays pending and reselecting supplies the exact task slot", async () => {
  api.listAssistantTasks.mockResolvedValue({ items: [{ ...task, ready: false, attachments: [{ name: "data.xlsx", kind: "workbook", state: "needs_upload" }] }], nextCursor: null });
  const upload = vi.fn(); render(<PendingAskTasks projectId="project" canEdit onUpload={upload} />);
  const input = await screen.findByLabelText("Upload missing data.xlsx");
  expect(screen.getByRole("button", { name: "Continue question" }).disabled).toBe(true);
  const file = new File(["synthetic"], "data.xlsx"); fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ id: "saved" }), 0, file, expect.any(AbortSignal)));
  expect(api.continueAssistantTask).not.toHaveBeenCalled();
});
test("late reads after unmount cannot deliver another account's task", async () => {
  let finish; api.listAssistantTasks.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const continued = vi.fn(), view = render(<PendingAskTasks projectId="project" onContinue={continued} />);
  view.unmount(); finish({ items: [task], nextCursor: null });
  await Promise.resolve(); expect(continued).not.toHaveBeenCalled(); expect(screen.queryByText(task.question)).toBeNull();
});
