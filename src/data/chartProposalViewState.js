function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function setChartProposalStatus(proposalSet, proposalId, status) {
  if (!proposalSet || !proposalId) return proposalSet;
  return {
    ...proposalSet,
    proposals: asArray(proposalSet.proposals).map((proposal) => (
      proposal.proposalId === proposalId ? { ...proposal, status } : proposal
    )),
  };
}

export function removeChartProposal(proposalSet, proposalId) {
  if (!proposalSet || !proposalId) return proposalSet;
  return {
    ...proposalSet,
    proposals: asArray(proposalSet.proposals).filter((proposal) => proposal.proposalId !== proposalId),
  };
}
