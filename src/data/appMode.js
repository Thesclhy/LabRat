export const BLANK_PROJECT_SOURCE_NAME = "blank project";

export function normalizeDataMode(value) {
  return value === "blank" ? "blank" : "demo";
}

export function isBlankDataModeValue(value) {
  return normalizeDataMode(value) === "blank";
}

export function dataMode() {
  return normalizeDataMode(import.meta.env.VITE_LABRAT_DATA_MODE);
}

export function isBlankDataMode() {
  return dataMode() === "blank";
}

export function blankTemplateLinks(baseUrl = import.meta.env.BASE_URL) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return [
    {
      label: "Standard table template",
      href: `${base}templates/generic-import-template.xlsx`,
      note: "Example only - not imported automatically",
    },
    {
      label: "Repeated block table template",
      href: `${base}templates/block-import-template.xlsx`,
      note: "Example only - not imported automatically",
    },
  ];
}
