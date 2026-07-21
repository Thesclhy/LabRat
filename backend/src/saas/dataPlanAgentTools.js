import {
  LEGACY_DATA_PLAN_SCHEMA_VERSION,
  validateDataPlanDraft,
} from "./dataPlanSchemas.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function columnFromAddress(address = "") {
  return text(address).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cellValue(cell) {
  return cell?.value ?? cell?.rawValue ?? cell?.formattedValue ?? "";
}

function rowCells(row) {
  return Array.isArray(row) ? row : asArray(row?.cells);
}

function rowNumber(row) {
  if (Number.isFinite(Number(row?.rowNumber))) return Number(row.rowNumber);
  const firstCell = rowCells(row)[0];
  if (Number.isFinite(Number(firstCell?.row))) return Number(firstCell.row) + 1;
  return null;
}

function findEvidence(evidenceResults, evidenceResultId) {
  const wanted = text(evidenceResultId);
  return asArray(evidenceResults).find((item) => (
    text(item.evidenceResultId || item.retrievalResultId || item.resultId) === wanted
    || text(item.regionId) === wanted
    || text(item.regionUnderstandingRevisionId) === wanted
  )) || asArray(evidenceResults)[0] || null;
}

function firstRow(preview) {
  return asArray(preview?.rows)[0] || null;
}

function headerScore(headerText, targetField) {
  const header = normalize(headerText);
  const target = normalize(targetField);
  let score = 0;
  const reasons = [];

  if (target.includes("reaction time")) {
    if (/\breaction\s*time\b/.test(header)) {
      score += 70;
      reasons.push("exact reaction time header");
    }
    if (/\btime\b|\bminute\b|\bminutes\b|\bmin\b|\bhour\b|\bhours\b|\bhr\b|\bhrs\b/.test(header)) {
      score += 45;
      reasons.push("time unit/header signal");
    }
  }

  if (target.includes("reaction rate")) {
    if (/\breaction\s*rate\b/.test(header)) {
      score += 70;
      reasons.push("exact reaction rate header");
    }
    if (/\brate\b|\brates\b|\bmol\b|\bg\s*h\b|\bper\s*h\b/.test(header)) {
      score += 45;
      reasons.push("rate/unit header signal");
    }
  }

  if (target.includes("carbon number")) {
    if (/\bcarbon\b|\bc\s*number\b|\bc\s*num\b|\bc\d+\b/.test(header)) {
      score += 60;
      reasons.push("carbon-number signal");
    }
  }

  if (target.includes("percentage")) {
    if (/\bpercent\b|\bpercentage\b|%|\boverall\b|\btot\b|\btotal\b/.test(header)) {
      score += 60;
      reasons.push("percentage signal");
    }
  }

  if (header && target && header.includes(target)) {
    score += 25;
    reasons.push("target text contained in header");
  }

  return { score, reasons };
}

function inferExperimentAlias(evidence, query = "") {
  const fromQuery = text(query).match(/\bexp(?:eriment)?\s*0*([0-9]+)\b/i);
  if (fromQuery) return `Exp${Number(fromQuery[1])}`;
  const haystack = [
    evidence?.experimentAlias,
    evidence?.experimentLabel,
    evidence?.sheetName,
    evidence?.workbookName,
    evidence?.description,
  ].join(" ");
  const fromEvidence = haystack.match(/\bexp\s*0*([0-9]+)\b/i);
  return fromEvidence ? `Exp${Number(fromEvidence[1])}` : text(evidence?.sheetName) || "Series 1";
}

function buildSourceEvidence(evidence) {
  return {
    retrievalResultId: text(evidence?.retrievalResultId || evidence?.resultId),
    regionId: text(evidence?.regionId),
    regionUnderstandingRevisionId: text(evidence?.regionUnderstandingRevisionId),
    sourceDocumentId: text(evidence?.sourceDocumentId),
    sheetName: text(evidence?.sheetName),
    range: text(evidence?.range),
    semanticType: text(evidence?.semanticType),
    sourceContentHash: text(evidence?.sourceContentHash),
    evidenceStatus: evidence?.evidenceStatus,
    canUseForDataPlan: evidence?.canUseForDataPlan === true,
  };
}

export function createDataPlanAgentTools({
  evidenceResults = [],
  readRangePreview = null,
} = {}) {
  return {
    async inspect_region_schema(input = {}) {
      const evidence = findEvidence(evidenceResults, input.evidenceResultId);
      if (!evidence) {
        return { error: { code: "evidence_result_not_found", message: "Evidence result not found." } };
      }
      const preview = readRangePreview
        ? await readRangePreview({
          sourceDocumentId: evidence.sourceDocumentId,
          sheetName: evidence.sheetName,
          range: evidence.range,
          maxRows: input.maxRows || 40,
          maxColumns: input.maxColumns || 30,
        })
        : null;
      const headerRow = firstRow(preview);
      const headers = rowCells(headerRow).map((cell) => ({
        column: columnFromAddress(cell.address),
        address: text(cell.address),
        text: text(cell.formattedValue ?? cellValue(cell)),
        rawValue: cellValue(cell),
      })).filter((header) => header.column);

      const numericColumns = headers.filter((header) => (
        asArray(preview?.rows).slice(1).some((row) => (
          rowCells(row).some((cell) => (
            columnFromAddress(cell.address) === header.column
            && numericValue(cellValue(cell)) !== null
          ))
        ))
      )).map((header) => ({
        column: header.column,
        headerCell: header.address,
        headerText: header.text,
      }));

      return {
        schema: {
          evidenceResultId: text(evidence.retrievalResultId || evidence.resultId),
          sourceDocumentId: evidence.sourceDocumentId,
          sheetName: evidence.sheetName,
          range: evidence.range,
          semanticType: evidence.semanticType || "",
          headerRow: rowNumber(headerRow) || 1,
          headers,
          numericColumns,
          preview,
          sourceEvidence: buildSourceEvidence(evidence),
        },
      };
    },

    async infer_header_row(input = {}) {
      const schema = input.schema || {};
      return {
        rowNumber: schema.headerRow || 1,
        confidence: schema.headers?.length ? 0.75 : 0.2,
        reason: "MVP uses the first row of the confirmed region as the header row.",
      };
    },

    async rank_candidate_columns(input = {}) {
      const schema = input.schema || {};
      const targetField = text(input.targetField);
      const candidates = asArray(schema.headers).map((header) => {
        const score = headerScore(header.text, targetField);
        const numericBonus = asArray(schema.numericColumns).some((column) => column.column === header.column) ? 10 : 0;
        return {
          column: header.column,
          headerCell: header.address,
          headerText: header.text,
          semanticField: targetField,
          score: score.score + numericBonus,
          reasons: score.reasons,
        };
      }).filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);
      return { targetField, candidates };
    },

    async draft_data_plan(input = {}) {
      const schema = input.schema || {};
      const evidence = schema.sourceEvidence || {};
      const rows = asArray(schema.preview?.rows);
      const lastRow = rows.length ? rowNumber(rows[rows.length - 1]) : (schema.headerRow || 1);
      const experimentAlias = text(input.experimentAlias) || inferExperimentAlias(evidence, input.query);
      const dataPlan = {
        schemaVersion: LEGACY_DATA_PLAN_SCHEMA_VERSION,
        id: `data_plan_draft_${Date.now()}`,
        status: "draft",
        task: "chart_data",
        outputShape: input.outputShape || "xy_series",
        userGoal: text(input.query),
        sourceEvidence: [evidence],
        operations: [
          {
            op: "read_table_region",
            sourceDocumentId: evidence.sourceDocumentId,
            sheetName: evidence.sheetName,
            range: evidence.range,
          },
          {
            op: "use_row_as_header",
            rowNumber: schema.headerRow || 1,
          },
          {
            op: "bind_columns",
            bindings: input.bindings || {},
          },
          {
            op: "select_data_rows",
            startRow: (schema.headerRow || 1) + 1,
            endRow: lastRow,
          },
          {
            op: "emit_xy_series",
            seriesId: `series_${normalize(experimentAlias).replace(/\s+/g, "_") || "1"}`,
            experimentAlias,
            x: input.bindings?.x?.semanticField || "x",
            y: input.bindings?.y?.semanticField || "y",
          },
        ],
      };
      return { dataPlan };
    },

    async validate_data_plan(input = {}) {
      const validation = validateDataPlanDraft(input.dataPlan || {});
      return {
        status: validation.ok ? "valid" : "invalid",
        errors: validation.errors,
      };
    },
  };
}
