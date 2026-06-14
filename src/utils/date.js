function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateToken(token) {
  const text = String(token || "").trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (match) return isoDate(match[1], match[2], match[3]);
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return isoDate(match[3], match[1], match[2]);
  return null;
}

function parseShortStartRange(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})[/-](\d{1,2})\s*[-–—]\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const start = isoDate(match[5], match[1], match[2]);
  const end = isoDate(match[5], match[3], match[4]);
  return start && end ? `${start} to ${end}` : null;
}

export function normalizeExperimentDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  const shortStartRange = parseShortStartRange(text);
  if (shortStartRange) return shortStartRange;
  const direct = parseDateToken(text);
  if (direct) return direct;
  const tokens = [...text.matchAll(/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/g)]
    .map((match) => parseDateToken(match[0]))
    .filter(Boolean);
  if (tokens.length >= 2) return `${tokens[0]} to ${tokens[1]}`;
  return text;
}

export function formatExperimentDateForDisplay(value) {
  return normalizeExperimentDate(value) || "-";
}

export function experimentDateSortValue(value) {
  const normalized = normalizeExperimentDate(value);
  if (!normalized) return 0;
  const firstSegment = String(normalized).split(" to ")[0];
  const parsed = Date.parse(firstSegment);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeDatasetDates(dataset) {
  if (!dataset || !Array.isArray(dataset.experiments)) return dataset;
  let changed = false;
  const experiments = dataset.experiments.map((experiment) => {
    if (!experiment || typeof experiment !== "object") return experiment;
    const nextDate = normalizeExperimentDate(experiment.date);
    if (nextDate === experiment.date) return experiment;
    changed = true;
    return { ...experiment, date: nextDate };
  });
  return changed ? { ...dataset, experiments } : dataset;
}
