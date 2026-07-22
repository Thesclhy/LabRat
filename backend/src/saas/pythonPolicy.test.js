import assert from "node:assert/strict";
import test from "node:test";

import { validatePythonPolicy } from "./pythonPolicy.js";

test("rejects network and subprocess imports before execution", () => {
  const result = validatePythonPolicy([
    "import requests",
    "import subprocess",
    "def analyze(tables, labrat):",
    "    return {}",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((item) => item.code === "python_import_not_allowed").map((item) => item.module),
    ["requests", "subprocess"],
  );
});

test("requires exactly one analyze(tables, labrat) entrypoint", () => {
  const missing = validatePythonPolicy("def other(tables, labrat):\n    return {}");
  const duplicated = validatePythonPolicy([
    "def analyze(tables, labrat):",
    "    return {}",
    "def analyze(tables, labrat):",
    "    return {}",
  ].join("\n"));
  const wrongSignature = validatePythonPolicy("def analyze(data):\n    return {}");

  assert.equal(missing.errors.some((item) => item.code === "python_entrypoint_required"), true);
  assert.equal(duplicated.errors.some((item) => item.code === "python_entrypoint_count_invalid"), true);
  assert.equal(wrongSignature.errors.some((item) => item.code === "python_entrypoint_signature_invalid"), true);
});

test("allows numeric libraries but blocks dynamic code and filesystem access", () => {
  const allowed = validatePythonPolicy([
    "import math",
    "import numpy as np",
    "from statistics import mean",
    "def analyze(tables, labrat):",
    "    return {'summary': {'mean': mean([1, 2]) + math.floor(np.array([1])[0])}}",
  ].join("\n"));
  const blocked = validatePythonPolicy([
    "def analyze(tables, labrat):",
    "    payload = open('../secret.txt').read()",
    "    return eval(payload)",
  ].join("\n"));

  assert.equal(allowed.ok, true);
  assert.equal(blocked.errors.some((item) => item.code === "python_call_not_allowed"), true);
  assert.equal(blocked.errors.some((item) => item.code === "python_path_traversal_not_allowed"), true);
});

test("allows ordinary dictionary reads used by generated analysis programs", () => {
  const result = validatePythonPolicy([
    "def analyze(tables, labrat):",
    "    rows = tables.get('records', [])",
    "    values = [row.get('yield') for row in rows]",
    "    return {'result_table': values, 'traces': [], 'lineage': {}, 'summary': {}}",
  ].join("\n"));

  assert.equal(result.ok, true);
});

test("blocks filesystem I/O exposed by otherwise allowed numeric libraries", () => {
  const result = validatePythonPolicy([
    "import numpy as np",
    "import pandas as pd",
    "def analyze(tables, labrat):",
    "    cached = np.load('/tmp/cache.npy')",
    "    external = pd.read_csv('https://example.com/data.csv')",
    "    return {'result_table': [cached, external]}",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(
    result.errors.filter((item) => item.code === "python_numeric_io_not_allowed").length,
    2,
  );
});

test("blocks module and private-attribute escapes through allowed libraries", () => {
  const result = validatePythonPolicy([
    "import pandas as pd",
    "def analyze(tables, labrat):",
    "    names = pd.io.common.os.listdir('.')",
    "    hidden = pd._libs",
    "    return {'result_table': [names, hidden]}",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((item) => item.code === "python_module_escape_not_allowed"),
    true,
  );
  assert.equal(
    result.errors.some((item) => item.code === "python_private_attribute_not_allowed"),
    true,
  );
});

test("blocks indirect dunder and module access through attrgetter", () => {
  const result = validatePythonPolicy([
    "import operator",
    "import statistics",
    "def analyze(tables, labrat):",
    "    globals_map = operator.attrgetter('__globals__')(statistics.mean)",
    "    importer = globals_map.get('__builtins__').get('__import__')",
    "    return {'result_table': [importer('os').getcwd()]}",
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((item) => (
      item.code === "python_import_not_allowed" || item.code === "python_dunder_access_not_allowed"
    )),
    true,
  );
});

test("rejects unsupported runtime versions", () => {
  const result = validatePythonPolicy(
    "def analyze(tables, labrat):\n    return {}",
    "labrat-python-v2",
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "analysis_runtime_unsupported");
});
