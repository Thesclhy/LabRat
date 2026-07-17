function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function identityCandidateKey(candidate) {
  return candidate?.normalizedAlias || candidate?.sourceAlias || "";
}

export function initialIdentityDecisionState(candidates) {
  return Object.fromEntries(asArray(candidates).map((candidate) => {
    const action = candidate?.decision?.action || "";
    return [identityCandidateKey(candidate), {
      action,
      experimentIdentityId: candidate?.decision?.experimentIdentityId || "",
    }];
  }));
}

export function identityCandidateStatus(candidate, decision = {}) {
  if (Number(candidate?.occurrenceCount) > 1) return "conflict";
  if (decision.action === "create") return "create";
  if (decision.action === "reuse" && decision.experimentIdentityId) return "reuse";
  if (asArray(candidate?.matches).length > 1) return "conflict";
  return "unresolved";
}

export function summarizeIdentityDecisions(candidates, decisions = {}) {
  const summary = {
    total: 0,
    create: 0,
    reuse: 0,
    unresolved: 0,
    conflict: 0,
    unmatchedAvailable: 0,
    exactMatchesAvailable: 0,
  };
  asArray(candidates).forEach((candidate) => {
    const decision = decisions[identityCandidateKey(candidate)] || {};
    const status = identityCandidateStatus(candidate, decision);
    summary.total += 1;
    summary[status] += 1;
    if (status !== "unresolved") return;
    const matchCount = asArray(candidate?.matches).length;
    if (matchCount === 0) summary.unmatchedAvailable += 1;
    if (matchCount === 1) summary.exactMatchesAvailable += 1;
  });
  return summary;
}

function candidateIsSelected(candidate, selectedKeys) {
  return !selectedKeys || selectedKeys.has(identityCandidateKey(candidate));
}

export function applyIdentityDecisionBatch(candidates, decisions = {}, {
  mode,
  selectedKeys = null,
} = {}) {
  const selected = selectedKeys instanceof Set ? selectedKeys : selectedKeys ? new Set(selectedKeys) : null;
  let changed = false;
  const next = { ...decisions };

  asArray(candidates).forEach((candidate) => {
    if (!candidateIsSelected(candidate, selected)) return;
    const key = identityCandidateKey(candidate);
    const current = next[key] || { action: "", experimentIdentityId: "" };
    const matchCount = asArray(candidate?.matches).length;
    const status = identityCandidateStatus(candidate, current);
    let replacement = null;

    if (mode === "create_unmatched" && status === "unresolved" && matchCount === 0) {
      replacement = { action: "create", experimentIdentityId: "" };
    } else if (mode === "reuse_unique" && status === "unresolved" && matchCount === 1) {
      replacement = {
        action: "reuse",
        experimentIdentityId: candidate.matches[0].id,
      };
    } else if (mode === "clear") {
      replacement = { action: "", experimentIdentityId: "" };
    }

    if (!replacement
      || (replacement.action === current.action
        && replacement.experimentIdentityId === (current.experimentIdentityId || ""))) return;
    next[key] = replacement;
    changed = true;
  });

  return changed ? next : decisions;
}
