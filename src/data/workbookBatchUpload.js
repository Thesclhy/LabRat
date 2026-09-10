export const WORKBOOK_BATCH_UPLOAD_CONCURRENCY = 2;

const EXPERIMENT_NUMBER_PATTERN = /\bexp(?:eriment)?[\s_-]*0*(\d{1,5})\b/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

export function parseExperimentNumberFromFileName(fileName) {
  const match = EXPERIMENT_NUMBER_PATTERN.exec(text(fileName));
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeExperimentAlias(value) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, "").replace(/^exp(?:eriment)?0*/, "exp");
}

export function suggestExperimentForFile(fileName, experiments = []) {
  const experimentNumber = parseExperimentNumberFromFileName(fileName);
  if (experimentNumber === null) {
    return { experimentNumber: null, label: "", match: null, status: "no_experiment_in_name" };
  }
  const label = `Exp${experimentNumber}`;
  const wanted = normalizeExperimentAlias(label);
  const matches = asArray(experiments).filter((experiment) => (
    normalizeExperimentAlias(experiment?.label) === wanted
  ));
  if (matches.length === 1) {
    return {
      experimentNumber,
      label,
      match: { experimentId: matches[0].experimentId, label: matches[0].label },
      status: "matched",
    };
  }
  return {
    experimentNumber,
    label,
    match: null,
    status: matches.length > 1 ? "ambiguous" : "unmatched",
  };
}

export function createWorkbookBatchItems(files) {
  return asArray(files).map((file, index) => ({
    index,
    fileName: file?.name || `workbook ${index + 1}`,
    status: "pending",
    error: "",
    workbookReviewLink: null,
    suggestedExperiment: null,
  }));
}

export function summarizeWorkbookBatch(items) {
  const summary = { total: 0, pending: 0, uploading: 0, uploaded: 0, failed: 0 };
  asArray(items).forEach((item) => {
    summary.total += 1;
    if (item?.status in summary) summary[item.status] += 1;
  });
  return summary;
}

export function workbookBatchItemForStorage(item) {
  if (!item || typeof item !== "object") return item;
  const { file: _file, result: _result, ...rest } = item;
  return rest;
}

export async function runWorkbookBatchUpload({
  files = [],
  items = null,
  uploadFile,
  concurrency = WORKBOOK_BATCH_UPLOAD_CONCURRENCY,
  onUpdate,
  onlyIndexes = null,
} = {}) {
  if (typeof uploadFile !== "function") throw new Error("A workbook upload function is required.");
  const fileList = asArray(files);
  const current = asArray(items).length ? asArray(items).map((item) => ({ ...item })) : createWorkbookBatchItems(fileList);
  const selected = new Set(onlyIndexes ? asArray(onlyIndexes) : current.map((item) => item.index));
  const queue = current.filter((item) => selected.has(item.index) && fileList[item.index]);
  const limit = Math.max(1, Number(concurrency) || WORKBOOK_BATCH_UPLOAD_CONCURRENCY);

  const publish = () => {
    onUpdate?.(current.map((item) => ({ ...item })));
  };
  const setItem = (index, patch) => {
    const position = current.findIndex((item) => item.index === index);
    if (position < 0) return;
    current[position] = { ...current[position], ...patch };
  };

  queue.forEach((item) => setItem(item.index, { status: "pending", error: "" }));
  publish();

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const item = queue[cursor];
      cursor += 1;
      const file = fileList[item.index];
      setItem(item.index, { status: "uploading", error: "" });
      publish();
      try {
        const result = await uploadFile(file, item);
        setItem(item.index, {
          status: "uploaded",
          error: "",
          workbookReviewLink: result?.workbookReviewLink || null,
          result: result || null,
        });
      } catch (error) {
        setItem(item.index, {
          status: "failed",
          error: error?.message || String(error),
        });
      }
      publish();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, () => worker()));
  return current.map((item) => ({ ...item }));
}
