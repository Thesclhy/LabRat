import { detectUnitFromLabel } from "./unitDetector.js";

function slug(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[%]/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isDateLabel(value) {
  return /(^|[^a-z])date([^a-z]|$)/i.test(String(value || ""));
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function inferValueType(values = []) {
  const present = values.filter((value) => value != null && String(value).trim() !== "");
  if (!present.length) return "empty";
  if (present.every((value) => numberValue(value) != null)) return "numeric";
  if (present.every((value) => /^(true|false|yes|no)$/i.test(String(value).trim()))) return "boolean";
  if (present.every((value) => !Number.isNaN(Date.parse(String(value))))) return "date";
  return "categorical";
}

function hasToken(key, tokens) {
  const parts = key.split("_").filter(Boolean);
  return tokens.some((token) => (
    token.includes("_") ? key.includes(token) : parts.includes(token)
  ));
}

export function classifyFieldRole(label, options = {}) {
  const key = slug(label);
  const valueType = options.valueType || "unknown";

  if (hasToken(key, ["label", "exp", "experiment", "experiment_id", "run", "run_id", "sample_id", "id", "name"])) {
    return {
      role: "identifier",
      confidence: 0.92,
      reason: "Label appears to identify experiments, runs, or samples.",
    };
  }

  if (hasToken(key, ["date", "operator", "note", "comment", "remark", "remarks", "batch", "file"])) {
    return {
      role: "metadata",
      confidence: 0.86,
      reason: "Label appears to be contextual metadata.",
    };
  }

  if (hasToken(key, ["catalyst", "polymer", "sample", "loading", "solvent", "substrate", "reagent", "material", "mass", "weight"])) {
    return {
      role: "material",
      confidence: 0.84,
      reason: "Label appears to describe material or sample composition.",
    };
  }

  if (hasToken(key, ["temp", "temperature", "pressure", "time", "reaction_time", "rpm", "speed", "impeller", "flow", "ph", "dose"])) {
    return {
      role: "condition",
      confidence: 0.84,
      reason: "Label appears to describe an experimental condition.",
    };
  }

  if (hasToken(key, ["selectivity", "conversion", "conv", "yield", "rate", "area", "concentration", "conc", "response", "balance", "distribution", "fraction", "signal", "intensity"])) {
    return {
      role: "measurement",
      confidence: 0.86,
      reason: "Label appears to describe an experimental result or observation.",
    };
  }

  if (valueType === "numeric") {
    return {
      role: "measurement",
      confidence: 0.52,
      reason: "Numeric field has no strong label signal; review as a possible measurement.",
    };
  }

  return {
    role: "metadata",
    confidence: 0.45,
    reason: "No strong semantic role signal was detected.",
  };
}

export function fieldDescriptorFromHeader({ columnId, displayName, rawHeaderPath = [], values = [], unit = null, source = null, confidence = null }) {
  const unitInfo = detectUnitFromLabel(displayName);
  const resolvedUnit = unit || unitInfo.unit || null;
  const label = cleanLabel(unitInfo.rawLabel || displayName);
  const valueType = isDateLabel(label) ? "date" : inferValueType(values);
  const role = classifyFieldRole(label, { valueType });
  return {
    fieldId: columnId,
    displayName: label,
    rawHeaderPath: rawHeaderPath.map(cleanLabel).filter(Boolean),
    unit: resolvedUnit,
    role: role.role,
    valueType,
    confidence: typeof confidence === "number"
      ? Number(Math.max(0, Math.min(1, (confidence + role.confidence) / 2)).toFixed(3))
      : role.confidence,
    reason: role.reason,
    source,
    warnings: [],
  };
}
