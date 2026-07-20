import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { stableDataHash } from "./dataPlanSchemas.js";

const MAX_RESULT_ROWS = 100_000;
const MAX_TRACES = 10_000;
const MAX_TRACE_POINTS = 1_000_000;
const MAX_RESULT_BYTES = 100 * 1024 * 1024;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resultError(code, message, details = {}) {
  return { code, message, ...details };
}

function sourceRecordId(record) {
  return `${record.snapshotId}:${Number(record.recordIndex)}`;
}

function finiteErrors(value, path = "result", errors = []) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(resultError(
      "analysis_non_finite_value",
      `Analysis output ${path} contains NaN or infinity.`,
      { path },
    ));
    return errors;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => finiteErrors(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => finiteErrors(item, `${path}.${key}`, errors));
  }
  return errors;
}

function rowValue(row, fieldKey) {
  if (Object.hasOwn(row || {}, fieldKey)) return row[fieldKey];
  return row?.values?.[fieldKey];
}

function lineageIds(value) {
  return asArray(value?.sourceRecordIds).map((item) => String(item || "")).filter(Boolean);
}

function normalizedUnit(value) {
  return String(value ?? "").trim();
}

function validateLineageIds(ids, acceptedIds, errors, details) {
  if (!ids.length) {
    errors.push(resultError(
      "analysis_lineage_required",
      "Every result row and trace requires source-record lineage.",
      details,
    ));
    return;
  }
  const unknown = ids.filter((id) => !acceptedIds.has(id));
  if (unknown.length) {
    errors.push(resultError(
      "analysis_lineage_unknown",
      "Result lineage references records outside the accepted selection.",
      { ...details, sourceRecordIds: unknown },
    ));
  }
}

function invariantValidation(invariants, rows, errors) {
  return asArray(invariants).map((invariant, invariantIndex) => {
    if (invariant?.type !== "row_sum") {
      const item = {
        type: invariant?.type || "unknown",
        ok: false,
        message: "Unsupported analysis invariant.",
      };
      errors.push(resultError(
        "analysis_invariant_unsupported",
        `Invariant ${item.type} is not supported.`,
        { invariantIndex },
      ));
      return item;
    }
    const target = Number(invariant.target);
    const tolerance = Number(invariant.absoluteTolerance ?? 0);
    const failedRows = [];
    rows.forEach((row, rowIndex) => {
      const values = asArray(invariant.fieldKeys).map((fieldKey) => Number(rowValue(row, fieldKey)));
      if (values.some((value) => !Number.isFinite(value))) {
        failedRows.push({ rowIndex, reason: "missing_or_non_numeric" });
        return;
      }
      const sum = values.reduce((total, value) => total + value, 0);
      if (Math.abs(sum - target) > tolerance) failedRows.push({ rowIndex, sum });
    });
    const item = {
      type: "row_sum",
      fieldKeys: asArray(invariant.fieldKeys),
      target,
      absoluteTolerance: tolerance,
      checkedRowCount: rows.length,
      failedRowCount: failedRows.length,
      ok: failedRows.length === 0,
    };
    if (!item.ok) {
      errors.push(resultError(
        "analysis_invariant_failed",
        `Row-sum invariant failed for ${failedRows.length} result row(s).`,
        { invariantIndex, failedRows: failedRows.slice(0, 100), invariant: item },
      ));
    }
    return item;
  });
}

export function validateAnalysisResult({
  run,
  plan,
  selection,
  executorResult,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!executorResult?.ok) {
    errors.push(resultError(
      "analysis_executor_failed",
      executorResult?.error?.message || "Analysis executor did not complete successfully.",
      { executorError: executorResult?.error || null },
    ));
  }
  if (run?.inputHash !== selection?.selectionHash) {
    errors.push(resultError(
      "analysis_input_hash_mismatch",
      "AnalysisRun input hash differs from the accepted selection.",
    ));
  }
  if (run?.programHash !== plan?.programHash) {
    errors.push(resultError(
      "analysis_program_hash_mismatch",
      "AnalysisRun program hash differs from the accepted plan.",
    ));
  }
  if (
    run?.runtimeVersion !== plan?.runtimeVersion
    || run?.runtimeVersion !== ANALYSIS_RUNTIME_VERSION
    || executorResult?.runtime?.version !== run?.runtimeVersion
  ) {
    errors.push(resultError(
      "analysis_runtime_mismatch",
      "Analysis runtime differs from the accepted plan runtime.",
    ));
  }

  const rawResult = executorResult?.result || {};
  const result = {
    resultTable: asArray(rawResult.result_table || rawResult.resultTable),
    traces: asArray(rawResult.traces),
    lineage: rawResult.lineage && typeof rawResult.lineage === "object" ? rawResult.lineage : {},
    summary: rawResult.summary && typeof rawResult.summary === "object" ? rawResult.summary : {},
    execution: {
      adapter: executorResult?.adapter || "unknown",
      runtime: executorResult?.runtime || {},
      stdout: String(executorResult?.stdout || "").slice(-4000),
      stderr: String(executorResult?.stderr || "").slice(-4000),
    },
  };
  const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (resultBytes > MAX_RESULT_BYTES) {
    errors.push(resultError(
      "analysis_result_too_large",
      `Analysis result is ${resultBytes} bytes; maximum is ${MAX_RESULT_BYTES}.`,
      { resultBytes, maxBytes: MAX_RESULT_BYTES },
    ));
  }
  if (result.resultTable.length > MAX_RESULT_ROWS) {
    errors.push(resultError(
      "analysis_result_row_limit_exceeded",
      `Analysis result contains more than ${MAX_RESULT_ROWS} rows.`,
    ));
  }
  if (result.traces.length > MAX_TRACES) {
    errors.push(resultError(
      "analysis_trace_limit_exceeded",
      `Analysis result contains more than ${MAX_TRACES} traces.`,
    ));
  }
  errors.push(...finiteErrors(result.resultTable, "result.resultTable"));
  errors.push(...finiteErrors(result.traces, "result.traces"));

  const acceptedRecordsById = new Map(asArray(selection?.records).map((record) => [
    sourceRecordId(record),
    record,
  ]));
  const acceptedSourceRecordIds = new Set(acceptedRecordsById.keys());
  const expectedShape = String(plan?.expectedOutput?.shape || "").trim();
  if (expectedShape !== "experiment_traces") {
    errors.push(resultError(
      "analysis_output_shape_unsupported",
      `Analysis output shape ${expectedShape || "(missing)"} is not supported.`,
    ));
  }
  const expectedYFields = asArray(plan?.expectedOutput?.yFields)
    .map((fieldKey) => String(fieldKey || "").trim())
    .filter(Boolean);
  const resultIds = new Set();
  const outputSourceRecordIds = new Set();
  result.resultTable.forEach((row, rowIndex) => {
    const resultId = String(row?.__result_id || row?.resultId || "").trim();
    if (!resultId) {
      errors.push(resultError(
        "analysis_result_id_required",
        "Every analysis result row requires a stable result id.",
        { rowIndex },
      ));
    } else if (resultIds.has(resultId)) {
      errors.push(resultError(
        "analysis_result_id_duplicate",
        `Duplicate analysis result id ${resultId}.`,
        { rowIndex, resultId },
      ));
    }
    resultIds.add(resultId);
    const rowPreservingId = row?.__snapshot_id != null && row?.__record_index != null
      ? `${row.__snapshot_id}:${Number(row.__record_index)}`
      : null;
    const ids = rowPreservingId
      ? [rowPreservingId]
      : lineageIds(result.lineage[resultId] || row);
    if (rowPreservingId) {
      const acceptedRecord = acceptedRecordsById.get(rowPreservingId);
      if (!row?.__experiment_id) {
        errors.push(resultError(
          "analysis_experiment_identity_required",
          "Row-preserving outputs must retain experiment identity.",
          { rowIndex, resultId },
        ));
      } else if (
        acceptedRecord
        && String(row.__experiment_id) !== String(acceptedRecord.experimentId)
      ) {
        errors.push(resultError(
          "analysis_experiment_identity_mismatch",
          "Row-preserving output experiment identity differs from its accepted source record.",
          {
            rowIndex,
            resultId,
            actualExperimentId: row.__experiment_id,
            expectedExperimentId: acceptedRecord.experimentId,
          },
        ));
      }
      if (outputSourceRecordIds.has(rowPreservingId)) {
        errors.push(resultError(
          "analysis_source_record_duplicate",
          "An accepted source record may appear in at most one row-preserving output row.",
          { rowIndex, resultId, sourceRecordId: rowPreservingId },
        ));
      }
      outputSourceRecordIds.add(rowPreservingId);
    }
    expectedYFields.forEach((fieldKey) => {
      if (!Object.hasOwn(row || {}, fieldKey) && !Object.hasOwn(row?.values || {}, fieldKey)) {
        errors.push(resultError(
          "analysis_expected_field_missing",
          `Analysis result row is missing expected field ${fieldKey}.`,
          { rowIndex, resultId, fieldKey },
        ));
        return;
      }
      const value = rowValue(row, fieldKey);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(resultError(
          "analysis_expected_field_invalid",
          `Analysis result field ${fieldKey} must be one finite number.`,
          { rowIndex, resultId, fieldKey },
        ));
      }
    });
    validateLineageIds(ids, acceptedSourceRecordIds, errors, { rowIndex, resultId });
  });

  const traceIds = new Set();
  let tracePointCount = 0;
  const unitByField = new Map(
    [
      ...asArray(plan?.calculationManifest?.inputs),
      ...asArray(plan?.calculationManifest?.derivedFields),
    ]
      .map((field) => [
        String(field?.fieldKey || field?.outputFieldKey || "").trim(),
        normalizedUnit(field?.unit || field?.outputUnit),
      ])
      .filter(([fieldKey]) => fieldKey),
  );
  const expectedYUnits = new Set(
    asArray(plan?.expectedOutput?.yFields)
      .map((fieldKey) => unitByField.get(String(fieldKey || "").trim()))
      .filter(Boolean),
  );
  result.traces.forEach((trace, traceIndex) => {
    const traceId = String(trace?.traceId || "").trim();
    if (!traceId) {
      errors.push(resultError(
        "analysis_trace_id_required",
        "Every analysis trace requires a stable traceId.",
        { traceIndex },
      ));
    } else if (traceIds.has(traceId)) {
      errors.push(resultError(
        "analysis_trace_id_duplicate",
        `Duplicate analysis trace id ${traceId}.`,
        { traceIndex, traceId },
      ));
    }
    traceIds.add(traceId);
    const x = asArray(trace?.x);
    const y = asArray(trace?.y);
    tracePointCount += Math.max(x.length, y.length);
    if (x.length !== y.length) {
      errors.push(resultError(
        "analysis_trace_length_mismatch",
        `Trace ${traceId || traceIndex} has different x and y lengths.`,
        { traceIndex, traceId, xLength: x.length, yLength: y.length },
      ));
    }
    x.forEach((value, pointIndex) => {
      if (
        (typeof value !== "number" || !Number.isFinite(value))
        && typeof value !== "string"
      ) {
        errors.push(resultError(
          "analysis_trace_x_value_invalid",
          `Trace ${traceId || traceIndex} x values must be finite numbers or strings.`,
          { traceIndex, traceId, pointIndex },
        ));
      }
    });
    y.forEach((value, pointIndex) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(resultError(
          "analysis_trace_y_value_invalid",
          `Trace ${traceId || traceIndex} y values must be finite numbers.`,
          { traceIndex, traceId, pointIndex },
        ));
      }
    });
    const traceYUnit = normalizedUnit(trace?.yUnit);
    const traceYField = String(trace?.yField || "").trim();
    const expectedTraceUnit = traceYField ? unitByField.get(traceYField) : null;
    if (
      expectedTraceUnit && traceYUnit !== expectedTraceUnit
      || !expectedTraceUnit && expectedYUnits.size && !expectedYUnits.has(traceYUnit)
    ) {
      errors.push(resultError(
        "analysis_trace_unit_mismatch",
        `Trace ${traceId || traceIndex} unit does not match the accepted calculation manifest.`,
        {
          traceIndex,
          traceId,
          yField: traceYField || null,
          actualUnit: traceYUnit || null,
          expectedUnits: expectedTraceUnit ? [expectedTraceUnit] : [...expectedYUnits],
        },
      ));
    }
    const ids = lineageIds(trace);
    validateLineageIds(ids, acceptedSourceRecordIds, errors, { traceIndex, traceId });
    if (trace?.experimentId) {
      const traceExperimentIds = new Set(
        ids
          .map((id) => acceptedRecordsById.get(id)?.experimentId)
          .filter(Boolean),
      );
      if (
        traceExperimentIds.size !== 1
        || !traceExperimentIds.has(trace.experimentId)
      ) {
        errors.push(resultError(
          "analysis_trace_experiment_mismatch",
          `Trace ${traceId || traceIndex} experiment identity differs from its lineage.`,
          { traceIndex, traceId, experimentId: trace.experimentId },
        ));
      }
    }
    const lineageEntryIds = lineageIds(result.lineage[traceId]);
    if (ids.length && lineageEntryIds.length && stableDataHash(ids) !== stableDataHash(lineageEntryIds)) {
      errors.push(resultError(
        "analysis_lineage_mismatch",
        `Trace ${traceId} lineage differs from the result lineage sidecar.`,
        { traceIndex, traceId },
      ));
    }
  });
  if (tracePointCount > MAX_TRACE_POINTS) {
    errors.push(resultError(
      "analysis_trace_point_limit_exceeded",
      `Analysis result contains ${tracePointCount} trace points; maximum is ${MAX_TRACE_POINTS}.`,
      { tracePointCount, maxTracePoints: MAX_TRACE_POINTS },
    ));
  }

  const inputRecordCount = asArray(selection?.records).length;
  const outputRecordCount = result.resultTable.length;
  const summary = result.summary;
  if (Number(summary.inputRecordCount) !== inputRecordCount
    || Number(summary.outputRecordCount) !== outputRecordCount) {
    errors.push(resultError(
      "analysis_result_count_mismatch",
      "Execution summary input/output counts do not match accepted inputs and result rows.",
      {
        expectedInputRecordCount: inputRecordCount,
        actualInputRecordCount: summary.inputRecordCount,
        expectedOutputRecordCount: outputRecordCount,
        actualOutputRecordCount: summary.outputRecordCount,
      },
    ));
  }
  const excludedRecordCount = Number(summary.excludedRecordCount);
  if (!Number.isInteger(excludedRecordCount) || excludedRecordCount < 0
    || outputRecordCount + excludedRecordCount > inputRecordCount) {
    errors.push(resultError(
      "analysis_exclusion_count_invalid",
      "Execution summary exclusion count is invalid.",
    ));
  }
  const excludedRecords = asArray(summary.excludedRecords);
  if (
    Number.isInteger(excludedRecordCount)
    && excludedRecords.length !== excludedRecordCount
  ) {
    errors.push(resultError(
      "analysis_exclusion_count_mismatch",
      "Execution summary excludedRecords length differs from excludedRecordCount.",
      {
        excludedRecordCount,
        excludedRecordDetailCount: excludedRecords.length,
      },
    ));
  }
  const excludedSourceRecordIds = new Set();
  excludedRecords.forEach((excluded, excludedIndex) => {
    const id = String(excluded?.sourceRecordId || "").trim();
    const reason = String(excluded?.reason || "").trim();
    if (!acceptedSourceRecordIds.has(id)) {
      errors.push(resultError(
        "analysis_excluded_record_unknown",
        "An excluded record is not part of the accepted selection.",
        { excludedIndex, sourceRecordId: id || null },
      ));
    }
    if (!reason) {
      errors.push(resultError(
        "analysis_exclusion_reason_required",
        "Every excluded record requires a visible reason.",
        { excludedIndex, sourceRecordId: id || null },
      ));
    }
    if (excludedSourceRecordIds.has(id)) {
      errors.push(resultError(
        "analysis_excluded_record_duplicate",
        "An accepted source record may be excluded only once.",
        { excludedIndex, sourceRecordId: id || null },
      ));
    }
    if (outputSourceRecordIds.has(id)) {
      errors.push(resultError(
        "analysis_output_exclusion_overlap",
        "An accepted source record cannot be both output and excluded.",
        { excludedIndex, sourceRecordId: id || null },
      ));
    }
    if (id) excludedSourceRecordIds.add(id);
  });
  if (expectedShape === "experiment_traces") {
    const accountedIds = new Set([
      ...outputSourceRecordIds,
      ...excludedSourceRecordIds,
    ]);
    const missingIds = [...acceptedSourceRecordIds].filter((id) => !accountedIds.has(id));
    const unknownIds = [...accountedIds].filter((id) => !acceptedSourceRecordIds.has(id));
    if (missingIds.length || unknownIds.length) {
      errors.push(resultError(
        "analysis_input_accounting_mismatch",
        "Every accepted input record must appear exactly once as output or a declared exclusion.",
        {
          missingSourceRecordIds: missingIds.slice(0, 100),
          unknownSourceRecordIds: unknownIds.slice(0, 100),
        },
      ));
    }
  }
  const plannedMissingMode = String(plan?.calculationManifest?.missingValuePolicy?.mode || "");
  if (String(summary.missingValuePolicy || "") !== plannedMissingMode) {
    errors.push(resultError(
      "analysis_missing_value_policy_mismatch",
      "Executed missing-value policy differs from the accepted manifest.",
      { planned: plannedMissingMode, actual: summary.missingValuePolicy || null },
    ));
  }

  const invariants = invariantValidation(
    plan?.calculationManifest?.invariants,
    result.resultTable,
    errors,
  );
  const validation = {
    ok: errors.length === 0,
    inputRecordCount,
    outputRecordCount,
    excludedRecordCount: Number.isInteger(excludedRecordCount) ? excludedRecordCount : null,
    traceCount: result.traces.length,
    tracePointCount,
    missingValuePolicy: plannedMissingMode,
    invariants,
    errors,
    warnings,
  };
  const contentHash = errors.length ? null : stableDataHash(result);
  const resultPreviewHash = errors.length ? null : stableDataHash({
    resultTable: result.resultTable,
    traces: result.traces,
    summary: result.summary,
    validation: {
      inputRecordCount,
      outputRecordCount,
      excludedRecordCount: validation.excludedRecordCount,
      traceCount: validation.traceCount,
      tracePointCount,
      missingValuePolicy: plannedMissingMode,
      invariants,
    },
  });
  return {
    ok: errors.length === 0,
    result,
    validation,
    errors,
    warnings,
    contentHash,
    resultPreviewHash,
  };
}

export const analysisResultLimits = Object.freeze({
  maxResultRows: MAX_RESULT_ROWS,
  maxTraces: MAX_TRACES,
  maxTracePoints: MAX_TRACE_POINTS,
  maxResultBytes: MAX_RESULT_BYTES,
});
