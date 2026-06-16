import { normalizeText } from "./chartSpec.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function fieldProfile(field, profiles) {
  return profiles.get(field?.fieldId) || {};
}

function priorStatus(priorDecisions, proposal) {
  const id = proposal?.proposalId;
  const signature = proposalSignature(proposal);
  return asArray(priorDecisions).find((decision) => (
    decision?.proposalId === id || decision?.signature === signature
  ))?.status || null;
}

function textMatchScore(proposal, contextText) {
  const text = normalizeText(contextText);
  if (!text) return 0.5;
  const candidate = normalizeText([
    proposal?.title,
    proposal?.x?.label,
    proposal?.x?.field,
    proposal?.y?.label,
    proposal?.y?.field,
    ...asArray(proposal?.yFields).flatMap((field) => [field.label, field.field]),
    proposal?.groupBy?.label,
    proposal?.rationale,
  ].filter(Boolean).join(" "));
  const tokens = normalizeText(candidate).split(" ").filter((token) => token.length > 2);
  if (!tokens.length) return 0.5;
  const contextTokens = new Set(text.split(" ").filter((token) => token.length > 2));
  const overlap = tokens.filter((token) => contextTokens.has(token)).length;
  return clamp(0.45 + overlap / Math.max(4, tokens.length), 0.45, 0.9);
}

function roleFit(proposal) {
  const chartType = proposal?.chartType;
  const xRole = proposal?.x?.role;
  const yFields = asArray(proposal?.yFields).length ? asArray(proposal.yFields) : [proposal?.y].filter(Boolean);
  const yMeasurementFit = yFields.every((field) => field?.role === "measurement") ? 1 : 0.55;
  if (chartType === "scatter" || chartType === "point") {
    return yMeasurementFit * (proposal?.x?.valueType === "numeric" ? 1 : 0.65);
  }
  if (chartType === "grouped_bar" || chartType === "stacked_bar") {
    return yMeasurementFit * (yFields.length >= 2 ? 1 : 0.35);
  }
  if (chartType === "distribution_bar") {
    return yMeasurementFit * (yFields.length >= 2 ? 1 : 0.25);
  }
  if (xRole === "identifier") return yMeasurementFit * 0.72;
  if (xRole === "material" || xRole === "condition") return yMeasurementFit;
  return yMeasurementFit * 0.8;
}

function dataQuality(proposal, profiles, pairProfile) {
  const xProfile = fieldProfile(proposal?.x, profiles);
  const yFields = asArray(proposal?.yFields).length ? asArray(proposal.yFields) : [proposal?.y].filter(Boolean);
  const yProfiles = yFields.map((field) => fieldProfile(field, profiles));
  const ySpreadScore = yProfiles.some((profile) => profile.hasUsefulSpread) ? 1 : 0.35;
  const xSpreadScore = proposal?.x?.valueType === "numeric"
    ? (xProfile.hasUsefulSpread ? 1 : 0.4)
    : (xProfile.uniqueCount > 1 ? 0.9 : 0.45);
  const coverage = Math.min(
    xProfile.coverageRate ?? 0.5,
    ...yProfiles.map((profile) => profile.coverageRate ?? 0.5),
  );
  const pairScore = pairProfile?.pairedCount == null
    ? 0.75
    : clamp(pairProfile.pairedCount / 4, 0.2, 1);
  return clamp((ySpreadScore * 0.35) + (xSpreadScore * 0.25) + (coverage * 0.2) + (pairScore * 0.2));
}

export function proposalSignature(proposal) {
  const yFields = asArray(proposal?.yFields).length ? asArray(proposal.yFields) : [proposal?.y].filter(Boolean);
  return [
    proposal?.chartType || "chart",
    proposal?.x?.fieldId || proposal?.x?.field || "",
    yFields.map((field) => field?.fieldId || field?.field || "").join("+"),
    proposal?.groupBy?.fieldId || proposal?.groupBy?.field || "",
    asArray(proposal?.transforms).map((transform) => transform?.type || "").join("+"),
  ].join("|");
}

function qualityWarnings(proposal, profiles, pairProfile) {
  const warnings = [];
  const xProfile = fieldProfile(proposal?.x, profiles);
  const yFields = asArray(proposal?.yFields).length ? asArray(proposal.yFields) : [proposal?.y].filter(Boolean);
  const yProfiles = yFields.map((field) => fieldProfile(field, profiles));
  if (pairProfile?.pairedCount != null && pairProfile.pairedCount < 2) {
    warnings.push({
      code: "low_pair_count",
      message: "Fewer than two paired x/y records are available for this chart.",
      severity: "warning",
    });
  }
  if (proposal?.x?.valueType === "numeric" && xProfile.isMostlyConstant) {
    warnings.push({
      code: "x_mostly_constant",
      message: `${proposal.x.label || proposal.x.field} has little or no numeric spread.`,
      severity: "warning",
    });
  }
  yProfiles.forEach((profile, index) => {
    if (profile.isMostlyConstant) {
      const axis = yFields[index];
      warnings.push({
        code: "y_mostly_constant",
        message: `${axis?.label || axis?.field || "Y field"} has little or no numeric spread.`,
        severity: "warning",
      });
    }
    if ((profile.missingRate || 0) > 0.4) {
      const axis = yFields[index];
      warnings.push({
        code: "high_missing_rate",
        message: `${axis?.label || axis?.field || "Y field"} has many missing values.`,
        severity: "warning",
      });
    }
  });
  return warnings;
}

function warningKey(warning) {
  return `${warning?.code || ""}:${warning?.message || ""}`;
}

export function scoreProposal(proposal, {
  profiles,
  pairProfile = null,
  priorDecisions = [],
  userGoal = "",
  projectProfile = {},
} = {}) {
  const contextText = [
    userGoal,
    projectProfile?.researchGoal,
    projectProfile?.experimentBackground,
    projectProfile?.analysisNotes,
    asArray(projectProfile?.tags).join(" "),
  ].join(" ");
  const prior = priorStatus(priorDecisions, proposal);
  const scoreBreakdown = {
    dataQuality: dataQuality(proposal, profiles, pairProfile),
    roleFit: roleFit(proposal),
    goalFit: textMatchScore(proposal, contextText),
    priorPenalty: prior === "accepted" ? 0.15 : 0,
  };
  const rawScore = (scoreBreakdown.dataQuality * 0.45)
    + (scoreBreakdown.roleFit * 0.3)
    + (scoreBreakdown.goalFit * 0.2)
    - scoreBreakdown.priorPenalty
    + (proposal.origin === "ai_intent" ? 0.05 : 0);
  const warnings = [
    ...asArray(proposal.warnings),
    ...qualityWarnings(proposal, profiles, pairProfile),
  ];
  const dedupedWarnings = [...new Map(warnings.map((warning) => [warningKey(warning), warning])).values()];
  return {
    ...proposal,
    score: Number(clamp(rawScore, 0.05, 0.99).toFixed(3)),
    scoreBreakdown: Object.fromEntries(Object.entries(scoreBreakdown).map(([key, value]) => [key, Number(value.toFixed(3))])),
    insight: proposal.insight || proposal.rationale || "Chart candidate scored from field profile and data coverage.",
    warnings: dedupedWarnings,
  };
}

export function rankAndDedupeProposals(proposals, options = {}) {
  const bestBySignature = new Map();
  asArray(proposals)
    .filter(Boolean)
    .filter((proposal) => proposal.status !== "rejected")
    .forEach((proposal) => {
      const signature = proposalSignature(proposal);
      const existing = bestBySignature.get(signature);
      if (!existing || (proposal.score || 0) > (existing.score || 0)) {
        bestBySignature.set(signature, {
          ...proposal,
          mergedOrigins: [...new Set([
            ...asArray(existing?.mergedOrigins),
            existing?.origin,
            ...asArray(proposal.mergedOrigins),
            proposal.origin,
          ].filter(Boolean))],
        });
      }
    });
  return [...bestBySignature.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.title || "").localeCompare(String(b.title || "")))
    .slice(0, options.limit || 8);
}
