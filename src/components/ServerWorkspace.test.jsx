import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectProfileChat } from "./ProjectProfileChat.jsx";
import { ServerLogin } from "./ServerLogin.jsx";

describe("ServerLogin", () => {
  it("submits username and password", () => {
    const onLogin = vi.fn();
    render(<ServerLogin loading={false} error="" onLogin={onLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "labuser" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "LabRatLab123!" } });
    fireEvent.click(screen.getByText("Sign in"));

    expect(onLogin).toHaveBeenCalledWith({ username: "labuser", password: "LabRatLab123!" });
  });

  it("shows login errors", () => {
    render(<ServerLogin loading={false} error="Invalid credentials." onLogin={() => {}} />);

    expect(screen.getByText("Invalid credentials.")).toBeTruthy();
  });
});

describe("ProjectProfileChat", () => {
  it("asks project profile questions and saves each answer", async () => {
    const onSaveProfile = vi.fn(async (profile) => ({ projectProfile: profile }));
    render(
      <ProjectProfileChat
        open
        project={{ id: "project_1", name: "Catalyst Screening" }}
        projectProfile={{}}
        onSaveProfile={onSaveProfile}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("What is the main research goal for this project?")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. Compare gas selectivity across catalyst loadings"), {
      target: { value: "Study gas selectivity." },
    });
    fireEvent.click(screen.getByText("↑"));

    await waitFor(() => {
      expect(onSaveProfile).toHaveBeenCalledWith({ researchGoal: "Study gas selectivity." });
    });
    expect(screen.getByText("What is the experimental background or campaign context?")).toBeTruthy();
  });

  it("allows skipping optional profile fields", async () => {
    const onSaveProfile = vi.fn(async (profile) => ({ projectProfile: profile }));
    render(
      <ProjectProfileChat
        open
        project={{ id: "project_1", name: "Catalyst Screening" }}
        projectProfile={{ researchGoal: "Goal" }}
        onSaveProfile={onSaveProfile}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Skip"));

    await waitFor(() => {
      expect(onSaveProfile).toHaveBeenCalledWith({
        researchGoal: "Goal",
        experimentBackground: "",
      });
    });
  });
});
