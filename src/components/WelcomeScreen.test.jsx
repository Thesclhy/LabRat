import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WelcomeScreen, WELCOME_SLOGAN } from "./WelcomeScreen.jsx";

describe("WelcomeScreen", () => {
  it("shows the LabRat logo, slogan, and a log in button before the sign-in form", () => {
    render(<WelcomeScreen loading={false} error="" onLogin={() => {}} />);

    const logo = screen.getByAltText("LabRat");
    expect(logo.getAttribute("src")).toMatch(/labrat-logo\.png$/);
    expect(screen.getByText(WELCOME_SLOGAN)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByLabelText("Username")).toBeNull();
  });

  it("reveals the sign-in form on the same page and submits credentials", () => {
    const onLogin = vi.fn();
    render(<WelcomeScreen loading={false} error="" onLogin={onLogin} />);

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.queryByText(WELCOME_SLOGAN)).toBeNull();

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).toHaveBeenCalledWith({ username: "alice", password: "secret" });
  });

  it("returns to the welcome hero from the sign-in form", () => {
    render(<WelcomeScreen loading={false} error="" onLogin={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(WELCOME_SLOGAN)).toBeTruthy();
    expect(screen.queryByLabelText("Username")).toBeNull();
  });

  it("surfaces sign-in errors inside the embedded form", () => {
    render(<WelcomeScreen loading={false} error="Invalid credentials." onLogin={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Invalid credentials.")).toBeTruthy();
  });
});
