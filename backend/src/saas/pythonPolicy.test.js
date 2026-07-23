import assert from "node:assert/strict";
import { test } from "node:test";

import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { validatePythonPolicy } from "./pythonPolicy.js";

test("allows deterministic numeric code reading the dictionary input contract", () => {
  const result = validatePythonPolicy([
    "import math",
    "import numpy as np",
    "def analyze(inputs, labrat):",
    "    tables = inputs.get('tables', [])",
    "    values = [row[0] for row in tables[0].get('values', [])]",
    "    total = float(np.sum(values)) if values else math.nan",
    "    return {'plotly': {'data': [{'type': 'bar', 'x': ['total'], 'y': [total]}], 'layout': {}}, 'exclusions': [], 'checks': []}",
  ].join("\n"));

  assert.equal(result.ok, true);
});

test("requires exactly analyze(inputs, labrat)", () => {
  const result = validatePythonPolicy([
    "def analyze(tables, labrat):",
    "    return {}",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((item) => item.code === "python_entrypoint_signature_invalid"),
    true,
  );
});

test("rejects inputs.tables attribute access with policy and line diagnostics", () => {
  const result = validatePythonPolicy([
    "def analyze(inputs, labrat):",
    "    rows = inputs.tables",
    "    return {}",
  ].join("\n"));

  assert.equal(result.ok, false);
  const error = result.errors.find((item) => item.code === "python_inputs_attribute_access_invalid");
  assert.deepEqual(
    { line: error.line, attribute: error.attribute, policy: error.policy },
    { line: 2, attribute: "tables", policy: "labrat-python-v2-input-contract" },
  );
});

test("blocks filesystem, network, dynamic code, and numeric-library I/O", () => {
  const result = validatePythonPolicy([
    "import os",
    "import pandas as pd",
    "def analyze(inputs, labrat):",
    "    value = eval('1 + 1')",
    "    frame = pd.read_csv('/tmp/data.csv')",
    "    os.system('echo unsafe')",
    "    return {'value': value}",
  ].join("\n"));

  assert.equal(result.ok, false);
  const codes = result.errors.map((item) => item.code);
  assert.equal(codes.includes("python_import_not_allowed"), true);
  assert.equal(codes.includes("python_call_not_allowed"), true);
  assert.equal(codes.includes("python_process_or_io_not_allowed"), true);
  assert.equal(codes.includes("python_numeric_io_not_allowed"), true);
});

test("rejects unsupported runtimes and JSON literals", () => {
  const result = validatePythonPolicy([
    "def analyze(inputs, labrat):",
    "    return {'ok': true}",
  ].join("\n"), "labrat-python-v1");

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "analysis_runtime_unsupported");
  assert.equal(result.errors.some((item) => item.code === "python_json_literal_invalid"), true);
  assert.equal(ANALYSIS_RUNTIME_VERSION, "labrat-python-v2");
});
