import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { WorkspacePermissions, permissionsForProject } from "./WorkspacePermissions.jsx";
import { ManuscriptCanvas } from "./ManuscriptCanvas.jsx";
import { WorkbookReviewDock } from "./WorkbookReviewDock.jsx";
import { ProjectDashboard } from "../main.jsx";
vi.mock("../charts/Plot.jsx", () => ({ Plot: () => <div /> }));

describe("workspace permission boundaries", () => {
  test("view, edit and approve map independently and default deny", () => {
    expect(permissionsForProject(null)).toEqual({ canEdit: false, canApprove: false, canExport: false });
    expect(permissionsForProject({ capabilities: ["read", "export"] })).toEqual({ canEdit: false, canApprove: false, canExport: true });
    expect(permissionsForProject({ capabilities: ["read", "propose", "export"] })).toEqual({ canEdit: true, canApprove: false, canExport: true });
    expect(permissionsForProject({ shellOnly: true, capabilities: ["propose", "approve"] }).canEdit).toBe(false);
  });
  test("readonly manuscript normalization and shortcuts cannot change persisted state", () => {
    const setBlocks = vi.fn(), setPages = vi.fn(), setCanvasHeight = vi.fn(), save = vi.fn();
    const { container } = render(<WorkspacePermissions.Provider value={{ canEdit: false, canApprove: false, canExport: true }}>
      <ManuscriptCanvas blocks={[]} setBlocks={setBlocks} pages={null} setPages={setPages} setCanvasHeight={setCanvasHeight} onSaveProject={save} />
    </WorkspacePermissions.Provider>);
    expect(screen.getByRole("button", { name: "Add page" }).disabled).toBe(true);
    expect(container.querySelector(".canvas").hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(setBlocks).not.toHaveBeenCalled();
    expect(setPages).not.toHaveBeenCalled();
    expect(setCanvasHeight).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  test("unassigned employee sees waiting state and cannot create a project", () => {
    render(<ProjectDashboard user={{ username: "employee" }} labs={[{ id: "lab", name: "Lab", role: "lab_member" }]} activeLabId="lab" projects={[]} canCreateProject={false} />);
    expect(screen.getByText(/Waiting for your lab owner/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New project" }).every((button) => button.disabled)).toBe(true);
  });
  test.each([
    ["view", false, false],
    ["edit", true, false],
    ["approve", true, true],
  ])("%s grants match actual revision and confirmation controls", async (_preset, canEdit, canApprove) => {
    const confirm = vi.fn(async () => ({})), revise = vi.fn(async () => ({}));
    render(<WorkspacePermissions.Provider value={{ canEdit, canApprove, canExport: true }}>
      <WorkbookReviewDock reviewRegions={[{
        id: "region", sheetName: "Runs", rangeRef: "A1:B3", disposition: "active",
        reviewStatus: "awaiting_review", version: 1, currentRevisionId: "revision",
        currentRevision: { id: "revision", summary: ["Synthetic region."], validation: { blockers: [] } },
      }]} onConfirmRegion={confirm} onReviseRegion={revise} />
    </WorkspacePermissions.Provider>);
    const feedback = screen.getByLabelText("Feedback for Runs!A1:B3");
    const confirmButton = screen.getByRole("button", { name: "Confirm region Runs!A1:B3" });
    expect(feedback.disabled).toBe(!canEdit);
    expect(confirmButton.disabled).toBe(!canApprove);
    if (canEdit) {
      fireEvent.change(feedback, { target: { value: "A review proposal, not accepted data." } });
      fireEvent.click(screen.getByRole("button", { name: "Submit revision for Runs!A1:B3" }));
      await waitFor(() => expect(revise).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(feedback.disabled).toBe(false));
    }
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(canApprove ? 1 : 0));
  });
});
