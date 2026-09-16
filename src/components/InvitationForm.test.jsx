import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InvitationForm } from "./InvitationForm.jsx";
import { LabManagement } from "./LabManagement.jsx";
import * as api from "../data/invitationsApi.js";
vi.mock("../data/invitationsApi.js", () => ({
  previewInvitation: vi.fn(), registerWithInvitation: vi.fn(), redeemInvitation: vi.fn(),
  createInvitation: vi.fn(), listInvitations: vi.fn(), revokeInvitation: vi.fn(),
  listLabMembers: vi.fn(), removeLabMember: vi.fn(), listMemberAccess: vi.fn(), setMemberAccess: vi.fn(),
}));
const code = "x".repeat(43);
beforeEach(() => { vi.clearAllMocks(); });

describe("invitation registration", () => {
  test("checks code first, requires matching passwords, and never submits client roles", async () => {
    api.previewInvitation.mockResolvedValue({ kind: "lab_owner", expiresAt: "2030-01-01", lab: null });
    api.registerWithInvitation.mockResolvedValue({ auth: { user: { id: "u" } }, lab: { id: "l" } });
    const complete = vi.fn();
    render(<InvitationForm onComplete={complete} />);
    expect(screen.queryByLabelText("Username")).toBeNull();
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Check invitation" }));
    await screen.findByLabelText("Username");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText(/Password ·/), { target: { value: "TestPassword123!" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "WrongPassword123!" } });
    fireEvent.change(screen.getByLabelText("Lab name"), { target: { value: "New Lab" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Passwords do not match.");
    expect(api.registerWithInvitation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "TestPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(complete).toHaveBeenCalled());
    expect(api.registerWithInvitation).toHaveBeenCalledWith({
      invitationCode: code, username: "owner", displayName: "Owner", password: "TestPassword123!", labName: "New Lab",
    });
  });

  test("existing account redemption has neither password nor selectable lab or role", async () => {
    api.previewInvitation.mockResolvedValue({ kind: "lab_member", lab: { id: "lab_1", name: "Fixed Lab" } });
    api.redeemInvitation.mockResolvedValue({ auth: {}, lab: { id: "lab_1" } });
    render(<InvitationForm signedIn />);
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Check invitation" }));
    await screen.findByText(/Join Fixed Lab as an employee/);
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.queryByLabelText("Lab name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(api.redeemInvitation).toHaveBeenCalledWith({ invitationCode: code }));
    expect(api.registerWithInvitation).not.toHaveBeenCalled();
  });

  test("shows expired code errors and allows retry without stale forms", async () => {
    api.previewInvitation.mockRejectedValue(new Error("Invitation is expired."));
    render(<InvitationForm />);
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Check invitation" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invitation is expired.");
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.getByRole("button", { name: "Check invitation" }).disabled).toBe(false);
  });
});

test("platform management works without a lab and only shows a fresh code until dismissed", async () => {
  api.listInvitations.mockResolvedValue({ items: [], nextCursor: null });
  api.createInvitation.mockResolvedValue({ invitationCode: code, invitation: { id: "inv_1" } });
  render(<LabManagement mode="platform" projects={[]} />);
  await screen.findByText("No invitations yet.");
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByLabelText("New invitation code")).toHaveProperty("value", code);
  fireEvent.click(screen.getByRole("button", { name: "Hide code" }));
  expect(screen.queryByLabelText("New invitation code")).toBeNull();
});
