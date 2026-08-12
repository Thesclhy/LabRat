import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaasStore } from "./memoryStore.js";

test("memory store persists versioned shared custom columns and values", async () => {
  const store = new MemorySaasStore();
  const column = await store.createExperimentCustomColumn({ labId: "lab_1", projectId: "project_1", label: "Follow-up", actorUserId: "user_1" });
  assert.equal(column.version, 1);
  const renamed = await store.updateExperimentCustomColumn({ projectId: "project_1", customColumnId: column.id, expectedVersion: 1, label: "Decision", actorUserId: "user_2" });
  assert.equal(renamed.label, "Decision");
  assert.equal(renamed.version, 2);
  await assert.rejects(() => store.updateExperimentCustomColumn({ projectId: "project_1", customColumnId: column.id, expectedVersion: 1, label: "Stale" }), { code: "experiment_custom_column_conflict" });

  const firstValue = await store.saveExperimentCustomValue({ labId: "lab_1", projectId: "project_1", customColumnId: column.id, experimentId: "exp_1", value: "Repeat", expectedVersion: 0, actorUserId: "user_1" });
  assert.equal(firstValue.version, 1);
  const blankValue = await store.saveExperimentCustomValue({ labId: "lab_1", projectId: "project_1", customColumnId: column.id, experimentId: "exp_1", value: "", expectedVersion: 1, actorUserId: "user_2" });
  assert.equal(blankValue.value, "");
  assert.equal(blankValue.version, 2);
  await assert.rejects(() => store.saveExperimentCustomValue({ labId: "lab_1", projectId: "project_1", customColumnId: column.id, experimentId: "exp_1", value: "Stale", expectedVersion: 1 }), { code: "experiment_custom_value_conflict" });

  assert.equal(await store.deleteExperimentCustomColumn({ projectId: "project_1", customColumnId: column.id }), true);
  assert.deepEqual(await store.listExperimentCustomColumns({ projectId: "project_1" }), []);
  assert.deepEqual(await store.listExperimentCustomValues({ projectId: "project_1" }), []);
});
