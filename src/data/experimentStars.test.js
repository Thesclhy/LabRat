import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNote, getProjectStars, isStarred, setNote, toggleStar } from "./experimentStars.js";

const PROJECT = "proj-1";
const ROW = "generic:imp-1:exp-1";

describe("experimentStars", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("starts with no stars", () => {
    expect(getProjectStars(PROJECT)).toEqual({});
    expect(isStarred(PROJECT, ROW)).toBe(false);
    expect(getNote(PROJECT, ROW)).toBe("");
  });

  it("toggles a star on and off", () => {
    toggleStar(PROJECT, ROW, 1000);
    expect(isStarred(PROJECT, ROW)).toBe(true);
    toggleStar(PROJECT, ROW, 2000);
    expect(isStarred(PROJECT, ROW)).toBe(false);
  });

  it("clears the note when unstarred", () => {
    setNote(PROJECT, ROW, "important run", 1000);
    expect(getNote(PROJECT, ROW)).toBe("important run");
    toggleStar(PROJECT, ROW, 2000);
    expect(isStarred(PROJECT, ROW)).toBe(false);
    expect(getNote(PROJECT, ROW)).toBe("");
  });

  it("saving a note implicitly stars the row", () => {
    setNote(PROJECT, ROW, "best yield", 1000);
    expect(isStarred(PROJECT, ROW)).toBe(true);
    expect(getNote(PROJECT, ROW)).toBe("best yield");
  });

  it("scopes stars per project", () => {
    toggleStar(PROJECT, ROW, 1000);
    expect(isStarred("proj-2", ROW)).toBe(false);
    expect(getProjectStars("proj-2")).toEqual({});
  });

  it("falls back to a local scope when no projectId is given", () => {
    toggleStar(null, ROW, 1000);
    expect(isStarred(null, ROW)).toBe(true);
  });

  it("persists across reads via localStorage", () => {
    setNote(PROJECT, ROW, "keep me", 1000);
    expect(getProjectStars(PROJECT)[ROW]).toMatchObject({ starred: true, note: "keep me" });
  });
});
