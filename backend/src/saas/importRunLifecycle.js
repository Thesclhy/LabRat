const NORMALIZE_ALLOWED = new Set(["review_ready", "normalized_preview"]);

function lifecycleError(code, message, details = undefined) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code,
    ...(details ? { details } : {}),
  });
}

export function assertCanNormalizeImportRun(importRun) {
  if (NORMALIZE_ALLOWED.has(importRun?.status)) return;
  throw lifecycleError(
    "invalid_import_run_transition",
    `Import run status ${importRun?.status || "unknown"} cannot be normalized.`,
    {
      currentStatus: importRun?.status || null,
      allowedStatuses: [...NORMALIZE_ALLOWED],
      requestedStatus: "normalized_preview",
    },
  );
}

export function assertCanApplyImportRun(importRun) {
  if (importRun?.status === "applied") {
    throw lifecycleError(
      "import_run_already_applied",
      "This import run has already been applied.",
      {
        currentStatus: importRun.status,
        appliedDatasetCommitId: importRun.appliedDatasetCommitId || null,
      },
    );
  }
  if (importRun?.status !== "normalized_preview") {
    throw lifecycleError(
      "invalid_import_run_transition",
      `Import run status ${importRun?.status || "unknown"} cannot be applied.`,
      {
        currentStatus: importRun?.status || null,
        allowedStatuses: ["normalized_preview"],
        requestedStatus: "applied",
      },
    );
  }
  if (!importRun?.normalizePreview) {
    throw lifecycleError(
      "normalize_preview_required",
      "Create a normalize preview before applying this import.",
      { currentStatus: importRun.status },
    );
  }
}
