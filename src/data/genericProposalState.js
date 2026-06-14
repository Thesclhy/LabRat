function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validStatus(status) {
  return status === "accepted" || status === "rejected" || status === "proposed" ? status : "proposed";
}

function upsertById(items, incoming, idKey) {
  if (!incoming?.[idKey]) return items;
  const index = items.findIndex((item) => item?.[idKey] === incoming[idKey]);
  if (index < 0) return [...items, incoming];
  return items.map((item, itemIndex) => itemIndex === index ? incoming : item);
}

export function setMappingStatus(mappingSet, mappingId, status) {
  if (!mappingSet) return mappingSet;
  return {
    ...mappingSet,
    mappings: asArray(mappingSet.mappings).map((mapping) => (
      mapping.mappingId === mappingId ? { ...mapping, status: validStatus(status) } : mapping
    )),
  };
}

export function setChartProposalStatus(proposalSet, proposalId, status) {
  if (!proposalSet) return proposalSet;
  return {
    ...proposalSet,
    proposals: asArray(proposalSet.proposals).map((proposal) => (
      proposal.proposalId === proposalId ? { ...proposal, status: validStatus(status) } : proposal
    )),
  };
}

export function upsertGenericMappingSet(dataset, mappingSet) {
  const current = dataset && typeof dataset === "object" ? dataset : { experiments: [] };
  return {
    ...current,
    experiments: asArray(current.experiments),
    genericImports: asArray(current.genericImports),
    genericMappingSets: upsertById(asArray(current.genericMappingSets), mappingSet, "mappingSetId"),
    genericChartProposals: asArray(current.genericChartProposals),
  };
}

export function upsertGenericChartProposalSet(dataset, proposalSet) {
  const current = dataset && typeof dataset === "object" ? dataset : { experiments: [] };
  return {
    ...current,
    experiments: asArray(current.experiments),
    genericImports: asArray(current.genericImports),
    genericMappingSets: asArray(current.genericMappingSets),
    genericChartProposals: upsertById(asArray(current.genericChartProposals), proposalSet, "proposalSetId"),
  };
}
