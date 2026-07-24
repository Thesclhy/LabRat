import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANALYSIS_PLAN_REVISION_VERSION,
  ANALYSIS_RUNTIME_VERSION,
  pythonSourceHash,
} from "./analysisSchemas.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { validatePythonPolicy } from "./pythonPolicy.js";

const RUN_PACKAGE_VERSION = "labrat.analysisRunPackage.v2";
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RUNNER_PATH = fileURLToPath(
  new URL("../../scripts/labrat_python_runner.py", import.meta.url),
);

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function executorFailure(code, message, details = {}) {
  return {
    ok: false,
    error: { code, message, ...details },
  };
}

function hasValidHttpsWorkerEndpoint(workerEndpoint) {
  try {
    return new URL(workerEndpoint).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildAnalysisRunPackage({
  run,
  planRevision,
  inputs,
  pythonProgram,
} = {}) {
  if (
    !run?.id
    || !["queued", "running"].includes(run.status)
    || !planRevision?.id
    || planRevision.status !== "accepted"
  ) {
    throw Object.assign(new Error("An accepted plan and executable run are required."), {
      code: "analysis_run_package_state_invalid",
      statusCode: 409,
    });
  }
  const source = String(pythonProgram?.source || "");
  const sourceHash = pythonSourceHash(source);
  if (
    run.acceptedPlanRevisionId !== planRevision.id
    || planRevision.schemaVersion !== ANALYSIS_PLAN_REVISION_VERSION
    || !Array.isArray(inputs?.tables)
    || (
      !inputs.tables.length
      && (!Array.isArray(inputs?.experiments) || !inputs.experiments.length)
    )
    || pythonProgram?.runtime !== ANALYSIS_RUNTIME_VERSION
    || pythonProgram?.entrypoint !== "analyze"
    || !source
  ) {
    throw Object.assign(new Error("Accepted analysis run inputs or generated program are invalid."), {
      code: "analysis_run_package_invalid",
      statusCode: 422,
    });
  }
  const runPackage = {
    schemaVersion: RUN_PACKAGE_VERSION,
    runId: run.id,
    projectId: run.projectId,
    analysisThreadId: run.analysisThreadId,
    acceptedPlanRevisionId: planRevision.id,
    outputTarget: run.outputTarget || planRevision.outputTarget || "chart",
    runtimeVersion: ANALYSIS_RUNTIME_VERSION,
    inputs: copy(inputs),
    reviewPlan: copy(planRevision.reviewPlan || planRevision.plan?.reviewPlan || {}),
    program: {
      runtime: ANALYSIS_RUNTIME_VERSION,
      entrypoint: "analyze",
      source,
      sourceHash,
    },
  };
  return {
    ...runPackage,
    inputHash: stableDataHash(inputs),
    programHash: sourceHash,
    packageHash: stableDataHash(runPackage),
  };
}

function sanitizedEnvironment(tempDirectory) {
  const source = process.env;
  return Object.fromEntries([
    ["PATH", source.PATH || source.Path || ""],
    ["Path", source.Path || source.PATH || ""],
    ["SYSTEMROOT", source.SYSTEMROOT || source.SystemRoot || ""],
    ["SystemRoot", source.SystemRoot || source.SYSTEMROOT || ""],
    ["WINDIR", source.WINDIR || source.SystemRoot || ""],
    ["TEMP", tempDirectory],
    ["TMP", tempDirectory],
    ["PYTHONIOENCODING", "utf-8"],
    ["PYTHONNOUSERSITE", "1"],
  ].filter(([, value]) => value));
}

async function runLocalProcess(runPackage, {
  pythonCommand = "python",
  runnerPath = DEFAULT_RUNNER_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxInputBytes = MAX_INPUT_BYTES,
  maxOutputBytes = MAX_OUTPUT_BYTES,
  spawnImpl = spawn,
} = {}) {
  const input = JSON.stringify(runPackage);
  const inputBytes = Buffer.byteLength(input, "utf8");
  if (inputBytes > maxInputBytes) {
    return executorFailure(
      "analysis_executor_input_too_large",
      `Analysis input is ${inputBytes} bytes; maximum is ${maxInputBytes}.`,
      { inputBytes, maxInputBytes },
    );
  }
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "labrat-analysis-"));
  const startedAt = new Date().toISOString();
  try {
    const response = await new Promise((resolve) => {
      const child = spawnImpl(pythonCommand, ["-I", runnerPath], {
        cwd: tempDirectory,
        env: sanitizedEnvironment(tempDirectory),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const append = (current, chunk) => Buffer.concat([current, Buffer.from(chunk)]);
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(executorFailure(
          "analysis_executor_timeout",
          `Analysis execution exceeded ${timeoutMs} ms.`,
          { timeoutMs },
        ));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout = append(stdout, chunk);
        if (stdout.length > maxOutputBytes) {
          child.kill("SIGKILL");
          finish(executorFailure(
            "analysis_executor_output_too_large",
            `Analysis output exceeded ${maxOutputBytes} bytes.`,
            { maxOutputBytes },
          ));
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = append(stderr, chunk);
        if (stderr.length > 64 * 1024) stderr = stderr.subarray(stderr.length - 64 * 1024);
      });
      child.on("error", (error) => finish(executorFailure(
        "analysis_executor_start_failed",
        "The local analysis runner could not be started.",
        { detail: error.message },
      )));
      child.on("close", (exitCode, signal) => {
        if (settled) return;
        if (exitCode !== 0) {
          finish(executorFailure(
            "analysis_executor_failed",
            "The local analysis runner exited unsuccessfully.",
            {
              exitCode,
              signal: signal || null,
              stderr: stderr.toString("utf8").slice(-4000),
            },
          ));
          return;
        }
        try {
          const body = JSON.parse(stdout.toString("utf8"));
          finish({
            ...body,
            runtime: {
              ...(body.runtime || {}),
              version: runPackage.runtimeVersion,
              startedAt,
              completedAt: new Date().toISOString(),
              exitCode,
              signal: signal || null,
            },
          });
        } catch {
          finish(executorFailure(
            "analysis_executor_output_invalid",
            "The local analysis runner did not return one valid JSON object.",
          ));
        }
      });
      child.stdin.end(input);
    });
    return response;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

async function runWorker(runPackage, {
  workerEndpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = MAX_OUTPUT_BYTES,
} = {}) {
  let endpoint;
  try {
    endpoint = new URL(workerEndpoint);
  } catch {
    return executorFailure("analysis_worker_endpoint_invalid", "Analysis worker endpoint is invalid.");
  }
  if (endpoint.protocol !== "https:") {
    return executorFailure(
      "analysis_worker_endpoint_insecure",
      "Production analysis workers require an HTTPS endpoint.",
    );
  }
  if (typeof fetchImpl !== "function") {
    return executorFailure("analysis_worker_unavailable", "Analysis worker transport is unavailable.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runPackage),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maxOutputBytes) {
      return executorFailure("analysis_executor_output_too_large", "Analysis worker output is too large.");
    }
    if (!response.ok) {
      return executorFailure(
        "analysis_worker_failed",
        `Analysis worker returned HTTP ${response.status}.`,
      );
    }
    return JSON.parse(raw);
  } catch (error) {
    return executorFailure(
      error?.name === "AbortError" ? "analysis_executor_timeout" : "analysis_worker_failed",
      error?.name === "AbortError"
        ? `Analysis execution exceeded ${timeoutMs} ms.`
        : "Analysis worker request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createAnalysisExecutor({
  mode = "disabled",
  nodeEnv = process.env.NODE_ENV || "development",
  pythonCommand = "python",
  workerEndpoint = "",
  runnerPath = DEFAULT_RUNNER_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxInputBytes = MAX_INPUT_BYTES,
  maxOutputBytes = MAX_OUTPUT_BYTES,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  localRunner = null,
} = {}) {
  const normalizedMode = String(mode || "disabled").trim().toLowerCase();
  const workerConfigured = normalizedMode === "worker" && hasValidHttpsWorkerEndpoint(workerEndpoint);
  const localConfigured = normalizedMode === "local" && nodeEnv !== "production";
  return {
    publicConfig() {
      return {
        mode: normalizedMode,
        configured: localConfigured || workerConfigured,
        adapter: normalizedMode === "local" ? "local_non_production" : normalizedMode,
        productionSafe: workerConfigured,
      };
    },
    async executeAcceptedRun(runPackage) {
      if (normalizedMode === "disabled") {
        return {
          ...executorFailure(
            "analysis_executor_disabled",
            "Analysis execution is disabled until a hardened worker is configured.",
          ),
          adapter: "disabled",
        };
      }
      if (normalizedMode === "local" && nodeEnv === "production") {
        return {
          ...executorFailure(
            "analysis_local_executor_forbidden",
            "The local analysis executor cannot run in production.",
          ),
          adapter: "local_non_production",
        };
      }
      if (!runPackage || runPackage.schemaVersion !== RUN_PACKAGE_VERSION) {
        return executorFailure(
          "analysis_run_package_invalid",
          "Analysis executor requires a canonical accepted run package.",
        );
      }
      if (
        runPackage.runtimeVersion !== ANALYSIS_RUNTIME_VERSION
        || runPackage.program?.sourceHash !== pythonSourceHash(runPackage.program?.source)
        || runPackage.programHash !== runPackage.program?.sourceHash
      ) {
        return executorFailure(
          "analysis_run_package_hash_mismatch",
          "Analysis executor package runtime or program hash is invalid.",
        );
      }
      const policy = validatePythonPolicy(runPackage.program.source, runPackage.runtimeVersion);
      if (!policy.ok) {
        return {
          ...executorFailure(
            "analysis_python_policy_failed",
            "Accepted Python did not pass the runtime policy.",
            { errors: policy.errors },
          ),
          adapter: normalizedMode === "local" ? "local_non_production" : "worker",
        };
      }
      if (normalizedMode === "local") {
        const result = localRunner
          ? await localRunner(copy(runPackage))
          : await runLocalProcess(runPackage, {
            pythonCommand,
            runnerPath,
            timeoutMs,
            maxInputBytes,
            maxOutputBytes,
            spawnImpl,
          });
        return { ...result, adapter: "local_non_production" };
      }
      if (normalizedMode === "worker") {
        const result = await runWorker(runPackage, {
          workerEndpoint,
          fetchImpl,
          timeoutMs,
          maxOutputBytes,
        });
        return { ...result, adapter: "hardened_worker" };
      }
      return {
        ...executorFailure(
          "analysis_executor_mode_unsupported",
          `Analysis executor mode ${normalizedMode} is not supported.`,
        ),
        adapter: normalizedMode,
      };
    },
  };
}

export const analysisExecutorLimits = Object.freeze({
  maxInputBytes: MAX_INPUT_BYTES,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
