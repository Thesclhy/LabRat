import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { buildAnalysisRunPackage, createAnalysisExecutor } from "./analysisExecutor.js";
import { ANALYSIS_PLAN_REVISION_VERSION } from "./analysisSchemas.js";
import { deterministicExperimentBrowserProgram } from "./deterministicExperimentBrowserProgram.js";
import { validatePythonPolicy } from "./pythonPolicy.js";

function directSourcePackage() {
  return buildAnalysisRunPackage({
    run: {
      id: "run_direct",
      projectId: "project_1",
      analysisThreadId: "thread_1",
      acceptedPlanRevisionId: "revision_1",
      status: "queued",
      outputTarget: "experiment_browser",
    },
    planRevision: {
      id: "revision_1",
      schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
      status: "accepted",
      outputTarget: "experiment_browser",
      reviewPlan: {},
    },
    inputs: {
      schemaVersion: "labrat.analysisInputs.v5",
      tables: [{
        tableId: "table_1",
        sourceSelectionId: "selection_1",
        source: { sourceDocumentId: "source_1", sheetName: "Sheet1", range: "A1:C4" },
        startRow: 1,
        startColumn: 1,
        rowCount: 4,
        columnCount: 3,
        structure: {
          experimentAxis: "rows",
          experimentIdColumn: "A",
          headerRow: 2,
          inclusion: { startRow: 3, endRow: 4, skippedRows: [] },
          fieldMappings: [{
            sourceColumnIndex: 1,
            displayName: "Temperature",
            valueType: "number",
            unit: "C",
          }, {
            sourceColumnIndex: 2,
            displayName: "Yield",
            valueType: "number",
            unit: "%",
          }],
        },
        columns: [{
          columnIndex: 0,
          excelColumn: "A",
        }, {
          columnIndex: 1,
          excelColumn: "B",
          sourceHeader: "Temperature",
          valueType: "number",
          unit: "C",
        }, {
          columnIndex: 2,
          excelColumn: "C",
          sourceHeader: "Yield",
          valueType: "number",
          unit: "%",
        }],
        values: [
          ["Label", "Temperature", "Yield"],
          [null, null, null],
          ["Exp1", 250, 90],
          ["Exp2", 275, "-"],
        ],
        displayValues: [
          ["Label", "Temperature", "Yield"],
          [null, null, null],
          ["Exp1", "250", "90"],
          ["Exp2", "275", "-"],
        ],
        formulas: Array.from({ length: 4 }, () => [null, null, null]),
      }],
      experiments: [],
    },
    pythonProgram: deterministicExperimentBrowserProgram(),
  });
}

test("built-in source mapper is concise and passes the Python policy", () => {
  const program = deterministicExperimentBrowserProgram();
  assert.equal(validatePythonPolicy(program.source, program.runtime).ok, true);
  assert.ok(program.source.split(/\r?\n/).filter((line) => line.trim()).length <= 180);
  assert.doesNotMatch(program.source, /Exp1|Exp2|250|275/);
});

test("built-in source mapper preserves values, placeholders, and exact cell offsets", {
  skip: !existsSync("/usr/bin/python3"),
}, async () => {
  const executor = createAnalysisExecutor({
    mode: "local",
    nodeEnv: "development",
    pythonCommand: "/usr/bin/python3",
  });
  const executed = await executor.executeAcceptedRun(directSourcePackage());
  assert.equal(executed.ok, true, JSON.stringify(executed.error || {}));
  assert.deepEqual(executed.result.columns.map((column) => column.displayName), ["Temperature", "Yield"]);
  assert.equal(executed.result.recordPatches[0].label, "Exp1");
  assert.equal(executed.result.recordPatches[0].values[0].value, 250);
  assert.deepEqual(executed.result.recordPatches[0].values[0].sources, [{
    tableId: "table_1",
    rowOffset: 2,
    columnOffset: 1,
  }]);
  assert.equal(executed.result.recordPatches[1].values[1].value, null);
  assert.equal(executed.result.recordPatches[1].values[1].missingReason, "source_placeholder");
});
