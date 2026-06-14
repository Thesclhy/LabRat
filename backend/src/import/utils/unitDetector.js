const BRACKET_UNIT_PATTERN = /\s*(?:\(([^)]+)\)|\[([^\]]+)\])\s*$/;
const SLASH_UNIT_PATTERN = /\s+\/\s*([A-Za-z%/.-]+)\s*$/;
const TRAILING_UNIT_PATTERN = /^(-?\d+(?:\.\d+)?)\s*([A-Za-z%/.-]+)$/;
const PERCENT_LABEL_PATTERN = /\s+%\s*$/;

function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function detectUnitFromLabel(rawLabel) {
  const label = cleanLabel(rawLabel);
  const bracketMatch = label.match(BRACKET_UNIT_PATTERN);
  if (bracketMatch) {
    return {
      label: cleanLabel(label.slice(0, bracketMatch.index)),
      unit: cleanLabel(bracketMatch[1] || bracketMatch[2]),
      rawLabel: label,
    };
  }

  const slashMatch = label.match(SLASH_UNIT_PATTERN);
  if (slashMatch) {
    return {
      label: cleanLabel(label.slice(0, slashMatch.index)),
      unit: cleanLabel(slashMatch[1]),
      rawLabel: label,
    };
  }

  if (PERCENT_LABEL_PATTERN.test(label)) {
    return {
      label: cleanLabel(label.replace(PERCENT_LABEL_PATTERN, "")),
      unit: "%",
      rawLabel: label,
    };
  }

  return { label, unit: null, rawLabel: label };
}

export function detectUnitFromValue(rawValue) {
  const value = cleanLabel(rawValue);
  const match = value.match(TRAILING_UNIT_PATTERN);
  if (!match) return { parsedValue: null, unit: null, rawValue: value };
  return {
    parsedValue: Number(match[1]),
    unit: cleanLabel(match[2]),
    rawValue: value,
  };
}
