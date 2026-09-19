const list = (value) => Array.isArray(value) ? value : [];

export function orderedPlanRevisions(revisions) {
  return [...list(revisions)].sort((a, b) => Number(a.revision || 0) - Number(b.revision || 0)
    || String(a.id).localeCompare(String(b.id)));
}

export function currentPlanRevision(revisions) {
  return orderedPlanRevisions(revisions).at(-1) || null;
}

export function latestRevisionRun(runs, revisionId, thread) {
  const creationOrder = list(thread?.analysisRunIds);
  return list(runs).filter(run => run.acceptedPlanRevisionId === revisionId).sort((a, b) => {
    const aIndex = creationOrder.indexOf(a.id);
    const bIndex = creationOrder.indexOf(b.id);
    if (aIndex >= 0 || bIndex >= 0) return aIndex - bIndex;
    return ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
      || String(a.id).localeCompare(String(b.id));
  }).at(-1) || null;
}
