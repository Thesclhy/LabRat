const SUPPORTED_TRANSFORMS = new Set([
  "normalize_sum_to_percent",
  "sum_fields",
  "ratio",
  "percent_of_total",
  "pivot_longer",
  "sort_components",
  "filter_non_numeric",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

export function normalizeTransformType(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["normalize_to_100", "normalize_percent", "normalize_components_to_percent"].includes(text)) return "normalize_sum_to_percent";
  if (["pivot", "wide_to_long"].includes(text)) return "pivot_longer";
  if (["sort_carbon", "sort_component", "sort_carbon_number"].includes(text)) return "sort_components";
  return SUPPORTED_TRANSFORMS.has(text) ? text : "";
}

export function normalizeChartTransforms(transforms = []) {
  return asArray(transforms).map((transform, index) => {
    const type = normalizeTransformType(transform?.type || transform?.transformType);
    if (!type) return null;
    const inputFieldIds = unique([
      ...asArray(transform.inputFieldIds),
      ...asArray(transform.fields),
      ...asArray(transform.sourceIds),
    ]);
    return {
      transformId: transform.transformId || `transform_${index + 1}_${type}`,
      type,
      scope: transform.scope || (type === "normalize_sum_to_percent" ? "per_experiment" : "chart"),
      inputFieldIds,
      outputField: transform.outputField || null,
      outputUnit: transform.outputUnit || (type === "normalize_sum_to_percent" || type === "percent_of_total" ? "%" : null),
      outputLabel: transform.outputLabel || null,
      formula: transform.formula || formulaForTransform(type),
      warnings: asArray(transform.warnings),
    };
  }).filter(Boolean);
}

function formulaForTransform(type) {
  if (type === "normalize_sum_to_percent") return "value / sum(input values in scope) * 100";
  if (type === "sum_fields") return "sum(input values)";
  if (type === "ratio") return "input[0] / input[1]";
  if (type === "percent_of_total") return "input[0] / sum(input values) * 100";
  if (type === "pivot_longer") return "wide component fields -> component/value rows";
  if (type === "sort_components") return "sort components by declared componentOrder";
  if (type === "filter_non_numeric") return "remove rows where required values are not numeric";
  return "";
}

export function transformInputIds(transform) {
  return unique([
    ...asArray(transform?.inputFieldIds),
    ...asArray(transform?.fields),
    ...asArray(transform?.sourceIds),
  ]);
}

export function hasTransform(transforms, type) {
  return normalizeChartTransforms(transforms).some((transform) => transform.type === type);
}

