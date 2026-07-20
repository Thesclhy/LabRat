import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";

const MAX_SOURCE_BYTES = 200_000;
const ALLOWED_IMPORT_ROOTS = new Set([
  "collections",
  "decimal",
  "fractions",
  "functools",
  "itertools",
  "math",
  "numpy",
  "operator",
  "pandas",
  "scipy",
  "statistics",
]);
const FORBIDDEN_CALLS = [
  "open",
  "exec",
  "eval",
  "compile",
  "__import__",
  "input",
  "globals",
  "locals",
  "vars",
  "getattr",
  "setattr",
  "delattr",
  "breakpoint",
];
const FORBIDDEN_ATTRIBUTES = [
  "system",
  "popen",
  "spawn",
  "fork",
  "kill",
  "remove",
  "unlink",
  "rmdir",
  "rename",
  "chmod",
  "chown",
  "socket",
  "connect",
  "urlopen",
  "request",
  "post",
  "put",
  "delete",
  "run",
  "Popen",
  "call",
  "check_call",
  "check_output",
];
const FORBIDDEN_NUMERIC_IO_CALLS = [
  "ExcelFile",
  "HDFStore",
  "dump",
  "dumps",
  "fromfile",
  "genfromtxt",
  "load",
  "loadmat",
  "loads",
  "loadtxt",
  "memmap",
  "mmread",
  "mmwrite",
  "read_clipboard",
  "read_csv",
  "read_excel",
  "read_feather",
  "read_fwf",
  "read_hdf",
  "read_html",
  "read_json",
  "read_orc",
  "read_parquet",
  "read_pickle",
  "read_sas",
  "read_spss",
  "read_sql",
  "read_stata",
  "read_table",
  "read_xml",
  "save",
  "savemat",
  "savetxt",
  "savez",
  "savez_compressed",
  "to_clipboard",
  "to_csv",
  "to_excel",
  "to_feather",
  "to_hdf",
  "to_html",
  "to_json",
  "to_orc",
  "to_parquet",
  "to_pickle",
  "to_sql",
  "to_stata",
  "to_xml",
  "tofile",
];
const FORBIDDEN_MODULE_ATTRIBUTES = new Set([
  "ctypes",
  "ctypeslib",
  "io",
  "os",
  "socket",
  "subprocess",
  "sys",
  "urllib",
]);

function policyError(code, message, details = {}) {
  return { code, message, ...details };
}

function importRoots(source) {
  const imports = [];
  String(source || "").split(/\r?\n/).forEach((line, index) => {
    const withoutComment = line.replace(/#.*$/, "");
    const direct = withoutComment.match(/^\s*import\s+(.+)$/);
    if (direct) {
      direct[1].split(",").forEach((entry) => {
        const module = entry.trim().split(/\s+as\s+/i)[0].split(".")[0];
        if (module) imports.push({ module, line: index + 1 });
      });
    }
    const from = withoutComment.match(/^\s*from\s+([a-zA-Z_][\w.]*)\s+import\s+/);
    if (from) imports.push({ module: from[1].split(".")[0], line: index + 1 });
  });
  return imports;
}

function sourceWithoutStrings(source) {
  return String(source || "")
    .replace(/'''[\s\S]*?'''/g, "''")
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/#.*$/gm, "");
}

export function validatePythonPolicy(source, runtimeVersion = ANALYSIS_RUNTIME_VERSION) {
  const value = String(source || "");
  const errors = [];
  if (runtimeVersion !== ANALYSIS_RUNTIME_VERSION) {
    errors.push(policyError(
      "analysis_runtime_unsupported",
      `Python runtime must be ${ANALYSIS_RUNTIME_VERSION}.`,
      { runtimeVersion },
    ));
  }
  if (!value.trim()) {
    errors.push(policyError("python_source_required", "Python source is required."));
  }
  if (Buffer.byteLength(value, "utf8") > MAX_SOURCE_BYTES) {
    errors.push(policyError(
      "python_source_too_large",
      `Python source must be ${MAX_SOURCE_BYTES} bytes or fewer.`,
      { maxBytes: MAX_SOURCE_BYTES },
    ));
  }

  importRoots(value).forEach(({ module, line }) => {
    if (!ALLOWED_IMPORT_ROOTS.has(module)) {
      errors.push(policyError(
        "python_import_not_allowed",
        `Python import ${module} is not allowed in ${ANALYSIS_RUNTIME_VERSION}.`,
        { module, line },
      ));
    }
  });

  const entrypoints = [...value.matchAll(/^\s*def\s+analyze\s*\(([^)]*)\)\s*(?:->[^:]*)?:/gm)];
  if (!entrypoints.length) {
    errors.push(policyError(
      "python_entrypoint_required",
      "Python source must define analyze(tables, labrat).",
    ));
  } else {
    if (entrypoints.length !== 1) {
      errors.push(policyError(
        "python_entrypoint_count_invalid",
        "Python source must define exactly one analyze entrypoint.",
        { count: entrypoints.length },
      ));
    }
    const parameters = entrypoints[0][1].split(",").map((item) => item.trim()).filter(Boolean);
    if (parameters.length !== 2 || parameters[0] !== "tables" || parameters[1] !== "labrat") {
      errors.push(policyError(
        "python_entrypoint_signature_invalid",
        "Python entrypoint signature must be analyze(tables, labrat).",
      ));
    }
  }

  const executableSource = sourceWithoutStrings(value);
  FORBIDDEN_CALLS.forEach((name) => {
    const pattern = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, "m");
    if (pattern.test(executableSource)) {
      errors.push(policyError(
        "python_call_not_allowed",
        `Python call ${name} is not allowed.`,
        { call: name },
      ));
    }
  });
  FORBIDDEN_ATTRIBUTES.forEach((name) => {
    const pattern = new RegExp(`\\.${name}\\s*\\(`, "m");
    if (pattern.test(executableSource)) {
      errors.push(policyError(
        "python_process_or_io_not_allowed",
        `Python process, network, or filesystem API ${name} is not allowed.`,
        { attribute: name },
      ));
    }
  });
  FORBIDDEN_NUMERIC_IO_CALLS.forEach((name) => {
    const pattern = new RegExp(`(^|[^\\w])${name}\\s*\\(`, "m");
    if (pattern.test(executableSource)) {
      errors.push(policyError(
        "python_numeric_io_not_allowed",
        `Numeric-library I/O API ${name} is not allowed.`,
        { call: name },
      ));
    }
  });
  const moduleEscapes = [...executableSource.matchAll(/\.([a-zA-Z_]\w*)/g)]
    .map((match) => match[1])
    .filter((name) => FORBIDDEN_MODULE_ATTRIBUTES.has(name));
  if (moduleEscapes.length) {
    errors.push(policyError(
      "python_module_escape_not_allowed",
      "Access to process, network, or filesystem modules through allowed libraries is not allowed.",
      { attributes: [...new Set(moduleEscapes)] },
    ));
  }
  if (/\._(?!_)[a-zA-Z]\w*/m.test(executableSource)) {
    errors.push(policyError(
      "python_private_attribute_not_allowed",
      "Private attributes of allowed libraries are not available to analysis programs.",
    ));
  }
  if (/(?:^|[^\w])(?:__builtins__|__loader__|__spec__|__class__|__subclasses__)(?:$|[^\w])/m.test(executableSource)
    || /\.__[a-zA-Z_]+__/m.test(executableSource)) {
    errors.push(policyError(
      "python_dunder_access_not_allowed",
      "Python runtime internals and dunder traversal are not allowed.",
    ));
  }
  if (/(?:\.\.[\\/]|[a-zA-Z]:[\\/]|\/(?:etc|proc|sys|dev|home|root|var|tmp)\/)/i.test(value)) {
    errors.push(policyError(
      "python_path_traversal_not_allowed",
      "Filesystem paths and path traversal are not allowed.",
    ));
  }

  return {
    ok: errors.length === 0,
    runtimeVersion,
    imports: importRoots(value).map((item) => item.module),
    errors,
  };
}

export const pythonPolicyLimits = Object.freeze({
  maxSourceBytes: MAX_SOURCE_BYTES,
  allowedImportRoots: [...ALLOWED_IMPORT_ROOTS],
});
