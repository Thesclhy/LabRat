export function proposeExcelMappingsFromScan(scanResult, options = {}) {
  return {
    parserStatus: "stub",
    generatedAt: new Date().toISOString(),
    parserName: options.parserName || "future-ai-parser",
    proposals: [],
    notes: "AI workbook parsing is not enabled. Scanner metadata is available for future proposal generation.",
  };
}
