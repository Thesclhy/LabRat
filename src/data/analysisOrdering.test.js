import { describe, expect, it } from "vitest";
import * as frontend from "./analysisOrdering.js";
import * as backend from "../../backend/src/saas/analysisOrdering.js";
for (const [name, ordering] of Object.entries({ frontend, backend })) {
  describe(name + " analysis ordering", () => {
    it.each([[1, 2, 3], [3, 2, 1], [2, 3, 1]])("selects the maximum revision from %s", (...order) => {
      const revisions = order.map(revision => ({ id: "r" + revision, revision }));
      const copy = structuredClone(revisions);
      expect(ordering.currentPlanRevision(revisions).id).toBe("r3");
      expect(revisions).toEqual(copy);
    });
    it("uses persisted run creation sequence, with timestamp and id fallback", () => {
      const runs = [{ id: "z", acceptedPlanRevisionId: "r", createdAt: "2026-09-19T01:00:00Z" }, { id: "a", acceptedPlanRevisionId: "r", createdAt: "2026-09-19T02:00:00Z" }, { id: "other", acceptedPlanRevisionId: "old" }];
      expect(ordering.latestRevisionRun(runs, "r").id).toBe("a");
      for (const ordered of [runs, [...runs].reverse()]) expect(ordering.latestRevisionRun(ordered, "r", { analysisRunIds: ["other", "z", "a"] }).id).toBe("a");
    });
  });
}
