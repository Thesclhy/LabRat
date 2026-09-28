import { expect, test } from "vitest";
import { isWorkspaceAction, workbookTaskReady } from "./assistantTasks.js";

test("explicit workspace actions use existing workflows while questions and file mentions stay Q&A", () => {
  expect(isWorkspaceAction("Open the Experiment Browser")).toBe(true);
  expect(isWorkspaceAction("Please insert a text box in the manuscript")).toBe(true);
  expect(isWorkspaceAction("Draft a paragraph for the manuscript")).toBe(true);
  expect(isWorkspaceAction("帮我写一段图注")).toBe(true);
  expect(isWorkspaceAction("What does the method say about manuscript export?")).toBe(false);
  expect(isWorkspaceAction("Read the reported mean in method.pdf")).toBe(false);
  expect(isWorkspaceAction("Upload method.pdf")).toBe(false);
});

test("resuming an Excel question needs a current accepted region for every uploaded source", () => {
  const task = { workbookBatch: { items: ["one", "two"].map((id) => ({ status: "uploaded", workbookReviewLink: { sourceDocumentId: id } })) } };
  const region = (id) => ({ sourceDocumentId: id, disposition: "active", reviewStatus: "accepted", acceptedRevisionId: "r1", currentRevisionId: "r1" });
  expect(workbookTaskReady(task, { workbookReviewRegions: [region("one")] })).toBe(false);
  expect(workbookTaskReady(task, { workbookReviewRegions: [region("one"), { ...region("two"), currentRevisionId: "r2" }] })).toBe(false);
  expect(workbookTaskReady(task, { workbookReviewRegions: [region("one"), { ...region("two"), disposition: "ignored" }] })).toBe(false);
  const accepted = { workbookReviewRegions: [region("one"), region("two")] };
  expect(workbookTaskReady(task, accepted)).toBe(true);
  task.workbookBatch.items[1].status = "failed";
  expect(workbookTaskReady(task, accepted)).toBe(false);
  expect(workbookTaskReady({}, accepted)).toBe(false);
});
