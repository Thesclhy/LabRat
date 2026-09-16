import { describe, expect, test, vi } from "vitest";
import { ExperimentRepository } from "./experiment.repository.js";
import { EvidenceRepository } from "../evidence/evidence.repository.js";

function repositoryFixture() {
  const query = vi.fn(async (_statement: string, _parameters?: unknown[]) => ({ rows: [] }));
  const repository = new ExperimentRepository({ rawPool: { query } } as never);
  return { query, repository };
}

describe("ExperimentRepository DataSnapshot history scoping", () => {
  test("normalizes linked evidence for full-project rows and detail only", async () => {
    const fixture = repositoryFixture();
    const accepted = vi.spyOn(EvidenceRepository.prototype, "listAcceptedRegionUnderstandings").mockResolvedValue([{
      region: { id: "region", disposition: "active", acceptedRevisionId: "revision", linkedExperimentId: "experiment_1",
        sourceDocumentId: "doc", workbookReviewSessionId: "session", sheetName: "Sheet1", rangeRef: "C2:D11", dataKind: "Rates" },
      revision: { id: "revision", interpretation: { series: [{ label: "Rate" }] } },
    }] as never);
    const documents = vi.spyOn(EvidenceRepository.prototype, "listSourceDocuments").mockResolvedValue([
      { id: "doc", metadata: { workbookName: "Exp1.xlsx" } },
    ] as never);
    try {
      for (const ids of [null, ["experiment_1"]]) {
        const state = await fixture.repository.loadProjectionState("project_1", ids, true);
        expect(state).toMatchObject({ experimentLinkedRegions: [{ regionId: "region", revisionId: "revision",
          workbookName: "Exp1.xlsx", range: "C2:D11", dataKind: "Rates", seriesLabels: ["Rate"] }] });
      }
      accepted.mockClear(); documents.mockClear();
      expect(await fixture.repository.loadProjectionState("project_1", ["experiment_1"]))
        .toMatchObject({ experimentLinkedRegions: [] });
      expect(accepted).not.toHaveBeenCalled();
      expect(documents).not.toHaveBeenCalled();
    } finally { accepted.mockRestore(); documents.mockRestore(); }
  });

  test("full-project access lists immutable snapshot history without requiring an active head", async () => {
    const fixture = repositoryFixture();
    await fixture.repository.listDataSnapshotSummaries("project_1", null);

    const firstCall = fixture.query.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [statement, parameters] = firstCall!;
    expect(statement).toContain("from data_snapshots snapshot");
    expect(statement).not.toContain("experiment_snapshot_heads");
    expect(statement).toContain("jsonb_array_length(snapshot.experiment_records)");
    expect(parameters).toEqual(["project_1"]);
  });

  test("selected-experiment access exposes only snapshots referenced by allowed active heads", async () => {
    const fixture = repositoryFixture();
    await fixture.repository.listDataSnapshotSummaries("project_1", ["experiment_1"]);

    const firstCall = fixture.query.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [statement, parameters] = firstCall!;
    expect(statement).toContain("join experiment_snapshot_heads head");
    expect(statement).toContain("head.experiment_id = any($2::text[])");
    expect(parameters).toEqual(["project_1", ["experiment_1"]]);
  });
});
