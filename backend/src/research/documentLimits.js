export const DOCUMENT_LIMITS = Object.freeze({
  fileBytes: 25 * 1024 * 1024,
  pages: 200,
  pagePixels: 12_000_000,
  pageMs: 40_000,
  attemptMs: 180_000,
  expandedBytes: 64 * 1024 * 1024,
  archiveEntries: 2_000,
  characters: 2_000_000,
  passages: 10_000,
  passageCharacters: 4_000,
  resultBytes: 24 * 1024 * 1024,
});

// Changing a parser, language model or locator policy must create new versions.
export const DOCUMENT_PROCESSING_VERSION =
  "labrat.documents.v1.2:pdfjs-6.3.289:tesseract-7.0.0:eng-chi_sim-1.0.0:word-1.0.4:xml-5.11.1";

export function documentError(code, message, statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode });
}
