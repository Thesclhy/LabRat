import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STAR_COLOR, getNote, getProjectStars, getStarColorId, isStarred, setNote, setStarColor, toggleStar } from "./experimentStars.js";

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

  it("defaults to the amber color and lets it be changed", () => {
    toggleStar(PROJECT, ROW, 1000);
    expect(getStarColorId(PROJECT, ROW)).toBe(DEFAULT_STAR_COLOR);
    setStarColor(PROJECT, ROW, "blue", 1100);
    expect(getStarColorId(PROJECT, ROW)).toBe("blue");
  });

  it("ignores unknown colors and preserves the note", () => {
    setNote(PROJECT, ROW, "keep", 1000);
    setStarColor(PROJECT, ROW, "not-a-color", 1100);
    expect(getStarColorId(PROJECT, ROW)).toBe(DEFAULT_STAR_COLOR);
    expect(getNote(PROJECT, ROW)).toBe("keep");
  });

  it("choosing a color implicitly stars the row", () => {
    setStarColor(PROJECT, ROW, "green", 1000);
    expect(isStarred(PROJECT, ROW)).toBe(true);
    expect(getStarColorId(PROJECT, ROW)).toBe("green");
  });

  it("unstarring clears the color back to default", () => {
    setStarColor(PROJECT, ROW, "red", 1000);
    toggleStar(PROJECT, ROW, 1100);
    expect(isStarred(PROJECT, ROW)).toBe(false);
    expect(getStarColorId(PROJECT, ROW)).toBe(DEFAULT_STAR_COLOR);
  });

  it("persists across reads via localStorage", () => {
    setNote(PROJECT, ROW, "keep me", 1000);
    expect(getProjectStars(PROJECT)[ROW]).toMatchObject({ starred: true, note: "keep me" });
  });
});
