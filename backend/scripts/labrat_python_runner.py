import ast
import contextlib
import io
import json
import math
import os
import sys
import time


RUNTIME_VERSION = "labrat-python-v2"
ALLOWED_IMPORT_ROOTS = {
    "collections",
    "decimal",
    "fractions",
    "functools",
    "itertools",
    "math",
    "numpy",
    "pandas",
    "scipy",
    "statistics",
}
FORBIDDEN_CALLS = {
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
}
FORBIDDEN_ATTRIBUTES = {
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
}
FORBIDDEN_NUMERIC_IO_CALLS = {
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
}
FORBIDDEN_MODULE_ATTRIBUTES = {
    "ctypes",
    "ctypeslib",
    "io",
    "os",
    "socket",
    "subprocess",
    "sys",
    "urllib",
}


def apply_resource_limits():
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
        one_gib = 1024 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (one_gib, one_gib))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    except (ImportError, AttributeError, OSError, ValueError):
        pass


def validate_tree(tree):
    errors = []
    analyze_functions = [
        node for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "analyze"
    ]
    if len(analyze_functions) != 1:
        errors.append("Python source must define exactly one analyze function.")
    elif (
        isinstance(analyze_functions[0], ast.AsyncFunctionDef)
        or [arg.arg for arg in analyze_functions[0].args.args] != ["inputs", "labrat"]
        or analyze_functions[0].args.vararg
        or analyze_functions[0].args.kwarg
    ):
        errors.append("Python entrypoint signature must be analyze(inputs, labrat).")

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ALLOWED_IMPORT_ROOTS:
                    errors.append(f"Import {root} is not allowed.")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in ALLOWED_IMPORT_ROOTS:
                errors.append(f"Import {root or 'relative'} is not allowed.")
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
                errors.append(f"Call {node.func.id} is not allowed.")
            if (
                isinstance(node.func, ast.Name)
                and node.func.id in FORBIDDEN_NUMERIC_IO_CALLS
            ):
                errors.append(f"Numeric-library I/O API {node.func.id} is not allowed.")
            if isinstance(node.func, ast.Attribute) and node.func.attr in FORBIDDEN_ATTRIBUTES:
                errors.append(f"API {node.func.attr} is not allowed.")
            if (
                isinstance(node.func, ast.Attribute)
                and node.func.attr in FORBIDDEN_NUMERIC_IO_CALLS
            ):
                errors.append(f"Numeric-library I/O API {node.func.attr} is not allowed.")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr.endswith("__"):
                errors.append("Dunder attribute access is not allowed.")
            elif node.attr.startswith("_"):
                errors.append("Private attribute access is not allowed.")
            if node.attr in FORBIDDEN_MODULE_ATTRIBUTES:
                errors.append(
                    f"Module escape through attribute {node.attr} is not allowed."
                )
        elif isinstance(node, ast.Name) and node.id in {
            "__builtins__",
            "__loader__",
            "__spec__",
        }:
            errors.append("Runtime-internal access is not allowed.")
        elif (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and len(node.value) > 4
            and node.value.startswith("__")
            and node.value.endswith("__")
        ):
            errors.append("Dunder-name string access is not allowed.")
    return errors


def restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = name.split(".")[0]
    if level or root not in ALLOWED_IMPORT_ROOTS:
        raise ImportError(f"Import {root or 'relative'} is not allowed.")
    return __import__(name, globals, locals, fromlist, level)


def safe_builtins():
    allowed = {
        "abs",
        "all",
        "any",
        "bool",
        "dict",
        "enumerate",
        "filter",
        "float",
        "int",
        "isinstance",
        "len",
        "list",
        "map",
        "max",
        "min",
        "next",
        "range",
        "reversed",
        "round",
        "set",
        "slice",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
        "Exception",
        "ValueError",
        "TypeError",
        "KeyError",
        "ZeroDivisionError",
    }
    source = __builtins__
    if not isinstance(source, dict):
        source = vars(source)
    result = {name: source[name] for name in allowed}
    result["__import__"] = restricted_import
    return result


class LabRatRuntime:
    @staticmethod
    def is_finite(value):
        return not isinstance(value, (int, float)) or math.isfinite(value)


def emit(payload):
    sys.stdout.write(json.dumps(payload, allow_nan=False, separators=(",", ":")))


def main():
    apply_resource_limits()
    started = time.time()
    package = json.load(sys.stdin)
    if package.get("schemaVersion") != "labrat.analysisRunPackage.v2":
        raise ValueError("Unsupported analysis run package.")
    if package.get("runtimeVersion") != RUNTIME_VERSION:
        raise ValueError("Unsupported analysis runtime.")
    program = package.get("program") or {}
    source = str(program.get("source") or "")
    tree = ast.parse(source, mode="exec")
    errors = validate_tree(tree)
    if errors:
        emit({
            "ok": False,
            "error": {
                "code": "analysis_python_policy_failed",
                "message": "Accepted Python failed runner policy validation.",
                "errors": errors,
            },
        })
        return

    namespace = {"__builtins__": safe_builtins()}
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        exec(compile(tree, "<labrat-analysis>", "exec"), namespace, namespace)
        result = namespace["analyze"](
            package.get("inputs") or {},
            LabRatRuntime(),
        )
    emit({
        "ok": True,
        "result": result,
        "stdout": stdout.getvalue()[-4000:],
        "stderr": stderr.getvalue()[-4000:],
        "runtime": {
            "version": RUNTIME_VERSION,
            "durationMs": int((time.time() - started) * 1000),
            "pid": os.getpid(),
        },
    })


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({
            "ok": False,
            "error": {
                "code": "analysis_python_runner_failed",
                "message": str(error)[:1000],
            },
        })
