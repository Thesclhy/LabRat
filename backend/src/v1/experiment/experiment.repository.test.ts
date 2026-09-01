import { describe, expect, test, vi } from "vitest";
import { ExperimentRepository } from "./experiment.repository.js";

function repositoryFixture() {
  const query = vi.fn(async (_statement: string, _parameters?: unknown[]) => ({ rows: [] }));
  const repository = new ExperimentRepository({ rawPool: { query } } as never);
  return { query, repository };
}

describe("ExperimentRepository DataSnapshot history scoping", () => {
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
