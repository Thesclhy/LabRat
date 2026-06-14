function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean))];
}

export function scanBlockIds(scanResult) {
  return asArray(scanResult?.sheets).flatMap((sheet) => (
    asArray(sheet.blocks).map((block) => block.blockId).filter(Boolean)
  ));
}

export function createBlockReviewState(scanResult = null, previous = {}) {
  const blockIds = scanBlockIds(scanResult);
  const available = new Set(blockIds);
  return {
    blockIds,
    approvedBlockIds: unique(previous.approvedBlockIds).filter((blockId) => available.has(blockId)),
    ignoredBlockIds: unique(previous.ignoredBlockIds).filter((blockId) => available.has(blockId)),
  };
}

export function setBlockReviewDecision(state, blockId, decision) {
  if (!blockId) return createBlockReviewState(null, state);
  const blockIds = unique([...(state?.blockIds || []), blockId]);
  const approved = new Set(state?.approvedBlockIds || []);
  const ignored = new Set(state?.ignoredBlockIds || []);

  approved.delete(blockId);
  ignored.delete(blockId);
  if (decision === "approved") approved.add(blockId);
  if (decision === "ignored") ignored.add(blockId);

  return {
    blockIds,
    approvedBlockIds: blockIds.filter((id) => approved.has(id)),
    ignoredBlockIds: blockIds.filter((id) => ignored.has(id)),
  };
}

export function blockReviewDecision(state, blockId) {
  if (state?.approvedBlockIds?.includes(blockId)) return "approved";
  if (state?.ignoredBlockIds?.includes(blockId)) return "ignored";
  return "pending";
}
