import { normalizeDatasetDates, normalizeExperimentDate } from "../utils/date.js";
import { num } from "../utils/format.js";

const REQUIRED_MASTER = "MasterTable.xlsx";

let xlsxLoader = null;

export function loadXLSX() {
  xlsxLoader ||= import("xlsx");
  return xlsxLoader;
}

function excelDate(v) {
  return normalizeExperimentDate(v);
}

export function workbookRows(XLSX, workbook, sheetName = workbook.SheetNames[0]) {
  const ws = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
}

export function fileExpLabel(name) {
  const m = /(?:^|[^a-z])exp\s*0*(\d+)/i.exec(name || "");
  return m ? `Exp${Number(m[1])}` : null;
}

function makeEmptyFiles() {
  return { calculation: null, sweep: null, parr_data: null };
}

export async function readWorkbook(XLSX, file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array", cellDates: false });
}

function makeFileRef(file, mode = "browser") {
  if (!file) return null;
  if (mode === "browser") return { name: file.name, url: URL.createObjectURL(file), local: true };
  return file.name;
}

export function parseMasterWorkbook(XLSX, workbook, masterFileName) {
  const rows = workbookRows(XLSX, workbook);
  return rows.slice(2)
    .filter((r) => String(r[0] || "").trim())
    .map((r, idx) => ({
      label: String(r[0] || "").trim(),
      date: excelDate(r[1]),
      catalyst_type: String(r[2] || "") || null,
      catalyst_loading_g: num(r[3]),
      polymer_type: String(r[4] || "") || null,
      polymer_loading_g: num(r[5]),
      temperature_C: num(r[6]),
      pressure_bar: num(r[7]),
      reaction_time_hr: num(r[8]),
      rpm: num(r[9]),
      impeller: String(r[10] || "") || null,
      selectivity_solid_pct: num(r[11]),
      selectivity_liquid_pct: num(r[12]),
      selectivity_gas_pct: num(r[13]),
      conversion_pct: num(r[14]),
      carbon_balance_pct: num(r[15]),
      h2_fraction_pct: num(r[16]),
      methane_fraction_pct: num(r[17]),
      h2_consumption_mol: num(r[18]),
      h2_from_p_decrease: num(r[19]),
      p_decrease_ratio: num(r[20]),
      methane_formation: num(r[21]),
      ch4_per_h2: num(r[22]),
      viscosity_cP: num(r[23]),
      comments: String(r[24] || "") || null,
      sources: [{ file: masterFileName, sheet: workbook.SheetNames[0], row: idx + 3, kind: "registry" }],
      rate_sources: [],
      calculation: null,
      sweep: null,
      parr_data: null,
      files: makeEmptyFiles(),
    }));
}

function attachFolderFiles(experiments, files, mode = "browser") {
  const byLabel = new Map(experiments.map((e) => [e.label.toLowerCase(), e]));
  files.forEach((file) => {
    const label = fileExpLabel(file.name);
    if (!label) return;
    const experiment = byLabel.get(label.toLowerCase());
    if (!experiment) return;
    const lower = String(file.name || "").toLowerCase();
    const ref = makeFileRef(file, mode);
    if (lower.includes("calculation")) experiment.files.calculation = ref;
    else if (lower.includes("sweep")) experiment.files.sweep = ref;
    else if (lower.includes("parrdata")) experiment.files.parr_data = ref;
  });
}

export async function buildDatasetFromExcelFiles(fileList, options = {}) {
  const XLSX = options.XLSX || await loadXLSX();
  const files = Array.from(fileList || []).filter((f) => /\.(xlsx|xls)$/i.test(f.name));
  const master = files.find((f) => f.name.toLowerCase() === REQUIRED_MASTER.toLowerCase())
    || files.find((f) => /master.*table/i.test(f.name));
  if (!master) throw new Error(`No ${REQUIRED_MASTER} found in the selected folder.`);
  const masterWb = await readWorkbook(XLSX, master);
  const experiments = parseMasterWorkbook(XLSX, masterWb, master.name);
  attachFolderFiles(experiments, files, options.mode || "browser");
  const dataset = {
    metadata: {
      generated_at: options.generatedAt || new Date().toISOString(),
      lab: options.lab || "Local Excel folder",
      study: options.study || "Local Excel import",
      calc_version: options.calcVersion || "local",
      n_experiments: experiments.length,
      schema_version: 1,
    },
    experiments,
  };
  if (options.includeLocalFiles !== false) {
    dataset.local_files = files.map((f) => ({ name: f.name, size: f.size, path: f.webkitRelativePath || f.relativePath || f.name }));
  }
  return normalizeDatasetDates(dataset);
}

export async function parseLocalExcelFolder(fileList) {
  return buildDatasetFromExcelFiles(fileList, { mode: "browser", includeLocalFiles: true });
}
