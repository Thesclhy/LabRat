function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function applyGenericImportPatch(dataset, datasetPatch) {
  const current = dataset && typeof dataset === "object" ? dataset : { experiments: [] };
  const existingImports = asArray(current.genericImports);
  const incomingImports = asArray(datasetPatch?.genericImports);
  if (!incomingImports.length) {
    return {
      ...current,
      experiments: asArray(current.experiments),
      genericImports: existingImports,
    };
  }

  const existingIds = new Set(existingImports.map((item) => item?.importId).filter(Boolean));
  const nextImports = [
    ...existingImports,
    ...incomingImports.filter((item) => !item?.importId || !existingIds.has(item.importId)),
  ];

  return {
    ...current,
    experiments: asArray(current.experiments),
    genericImports: nextImports,
  };
}
