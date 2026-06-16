function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isSupplementalImport(genericImport) {
  return genericImport?.relationship?.relationship === "supplement";
}

export function getSupplementalImports(dataset = {}) {
  return asArray(dataset.genericImports).filter(isSupplementalImport);
}

export function getMasterImports(dataset = {}) {
  return asArray(dataset.genericImports).filter((genericImport) => !isSupplementalImport(genericImport));
}

export function hasMasterImport(dataset = {}) {
  return getMasterImports(dataset).length > 0;
}
