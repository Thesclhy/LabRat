import { describe, expect, it, vi } from "vitest";
import { resolveStartupProject } from "./startupProject.js";

function savedProject(dataset = { experiments: [{ label: "Saved" }] }) {
  return {
    dataset,
    sourceName: "saved project",
    staged: ["Saved"],
    blocks: [],
    pages: [],
  };
}

describe("resolveStartupProject", () => {
  it("loads embedded data for demo mode when no saved project exists", async () => {
    const loadEmbedded = vi.fn(async () => ({ experiments: [{ label: "Embedded" }] }));

    const project = await resolveStartupProject({
      blankMode: false,
      loadEmbedded,
      legacyDataset: { experiments: [] },
      sourceName: "embedded LabRat dataset",
    });

    expect(loadEmbedded).toHaveBeenCalledTimes(1);
    expect(project.dataset.experiments[0]).toMatchObject({ label: "Embedded" });
  });

  it("does not load embedded data for blank mode with no saved project", async () => {
    const loadEmbedded = vi.fn(async () => ({ experiments: [{ label: "Embedded" }] }));

    const project = await resolveStartupProject({
      blankMode: true,
      loadEmbedded,
      legacyDataset: { experiments: [{ label: "Legacy localStorage" }] },
      staged: ["Legacy localStorage"],
    });

    expect(loadEmbedded).not.toHaveBeenCalled();
    expect(project.sourceName).toBe("blank project");
    expect(project.dataset.experiments).toEqual([]);
    expect(project.dataset.genericImports).toEqual([]);
    expect(project.dataset.genericMappingSets).toEqual([]);
    expect(project.dataset.genericChartProposals).toEqual([]);
    expect(project.staged).toEqual([]);
  });

  it("loads saved projects in blank mode without embedded data", async () => {
    const loadEmbedded = vi.fn(async () => ({ experiments: [{ label: "Embedded" }] }));

    const project = await resolveStartupProject({
      existingProject: savedProject(),
      blankMode: true,
      loadEmbedded,
    });

    expect(loadEmbedded).not.toHaveBeenCalled();
    expect(project.sourceName).toBe("saved project");
    expect(project.dataset.experiments[0]).toMatchObject({ label: "Saved" });
  });
});
