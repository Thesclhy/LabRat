export const TOOL_AGENT_SCHEMA_VERSION = "labrat.evidenceRetrieval.toolAgent.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function sourceDocumentById(sourceDocuments, sourceDocumentId) {
  return asArray(sourceDocuments).find((document) => document.id === sourceDocumentId) || null;
}

function sourceDocumentName(sourceDocument) {
  return sourceDocument?.metadata?.workbookName
    || sourceDocument?.metadata?.fileName
    || sourceDocument?.originalName
    || "";
}

export function parseEvidenceQuery(query = "") {
  const text = clean(query);
  return {
    query: text,
    experimentAliases: unique([...text.matchAll(/\bexp(?:eriment)?\s*0*([0-9]+)\b/gi)]
      .map((match) => `Exp${Number(match[1])}`)),
    explicitRanges: unique([...text.matchAll(/\b([A-Z]{1,3}[0-9]+)\s*(?::|to)\s*([A-Z]{1,3}[0-9]+)\b/gi)]
      .map((match) => `${match[1].toUpperCase()}:${match[2].toUpperCase()}`)),
  };
}

function semanticSignals(queryText) {
  const normalized = normalizeText(queryText);
  const signals = [];
  if (/\breaction\s*rate\b|\brate\b/.test(normalized)) signals.push("reaction_rate");
  if (/\btime\b|\bminute\b|\bmin\b|\bhour\b|\bhr\b/.test(normalized)) signals.push("time");
  if (/\bcarbon\b|\bc\s*number\b|\bdistribution\b|\bpercentage\b|\bpercent\b/.test(normalized)) {
    signals.push("component_distribution");
  }
  return unique(signals);
}

function lexicalScore(query, card) {
  const queryText = normalizeText(query);
  const cardText = normalizeText(card.searchText);
  const parsed = parseEvidenceQuery(query);
  let score = 0;
  const matchedSignals = [];

  parsed.experimentAliases.forEach((alias) => {
    if (cardText.includes(normalizeText(alias))) {
      score += 40;
      matchedSignals.push(`experiment_alias:${alias}`);
    }
  });
  parsed.explicitRanges.forEach((range) => {
    if (clean(card.range).toUpperCase() === range) {
      score += 40;
      matchedSignals.push(`explicit_range:${range}`);
    }
  });
  semanticSignals(query).forEach((signal) => {
    if (signal === "reaction_rate" && (
      card.semanticType === "reaction_rate_time_series"
      || /reaction.*rate|rate/.test(cardText)
    )) {
      score += 35;
      matchedSignals.push("semantic:reaction_rate");
    }
    if (signal === "time" && /time|minute|min|hour|hr/.test(cardText)) {
      score += 15;
      matchedSignals.push("semantic:time");
    }
    if (signal === "component_distribution" && (
      card.semanticType === "component_distribution"
      || /component|carbon|distribution|percentage|percent/.test(cardText)
    )) {
      score += 35;
      matchedSignals.push("semantic:component_distribution");
    }
  });
  queryText.split(" ").filter((token) => token.length > 2).forEach((token) => {
    if (cardText.includes(token)) score += 2;
  });
  if (!parsed.experimentAliases.length && !semanticSignals(query).length && score === 0 && cardText) {
    score = 1;
  }
  return { score, matchedSignals };
}

export function buildAcceptedRegionCards({ acceptedRegionUnderstandings = [], sourceDocuments = [] } = {}) {
  return asArray(acceptedRegionUnderstandings).flatMap((accepted) => {
    const region = accepted?.region || {};
    const revision = accepted?.revision || {};
    if (region.disposition !== "active" || region.acceptedRevisionId !== revision.id) return [];
    const interpretation = revision.interpretation || {};
    const sourceDocumentId = region.sourceDocumentId || revision.sourceDocumentId;
    const sourceDocument = sourceDocumentById(sourceDocuments, sourceDocumentId);
    const workbookName = sourceDocumentName(sourceDocument);
    const description = asArray(revision.summary).map(clean).filter(Boolean).join(" ");
    const sourceRefs = asArray(revision.sourceRefs).length
      ? revision.sourceRefs
      : [{
        sourceType: "excel_range",
        sourceDocumentId,
        sheet: region.sheetName,
        range: region.rangeRef,
      }];
    const semanticLabels = asArray(interpretation.fields)
      .flatMap((field) => [field?.displayName, field?.semanticKey])
      .map(clean)
      .filter(Boolean);
    const searchText = [
      workbookName,
      region.sheetName,
      region.rangeRef,
      interpretation.semanticType,
      description,
      ...semanticLabels,
    ].filter(Boolean).join(" ");
    return [{
      resultId: `evidence_result_${revision.id}`,
      regionId: region.id,
      regionUnderstandingRevisionId: revision.id,
      kind: "confirmed_region",
      evidenceStatus: "accepted",
      canUseForDataPlan: true,
      source: "region_understanding_revision",
      sourceDocumentId,
      workbookName,
      sheetName: region.sheetName,
      range: region.rangeRef,
      semanticType: interpretation.semanticType || "unknown_region",
      description,
      sourceContentHash: revision.sourceContentHash || "",
      sourceRefs,
      searchText,
    }];
  });
}

function buildUnconfirmedRegionCards({ sourceRegions = [], sourceDocuments = [] } = {}) {
  return asArray(sourceRegions).map((region) => {
    const sourceDocument = sourceDocumentById(sourceDocuments, region.sourceDocumentId);
    const workbookName = sourceDocumentName(sourceDocument);
    const searchText = [
      workbookName,
      region.sheetName,
      region.range,
      region.kind,
      region.label,
      region.summary,
    ].filter(Boolean).join(" ");
    return {
      kind: "detected_region",
      evidenceStatus: "suggested_unconfirmed",
      canUseForDataPlan: false,
      requiredNextStep: "confirm_region",
      source: "source_region",
      sourceRegionId: region.id,
      sourceDocumentId: region.sourceDocumentId,
      workbookName,
      sheetName: region.sheetName,
      range: region.range,
      semanticType: region.semanticType || region.kind || "unknown_region",
      description: region.label || region.summary || "",
      confidence: region.confidence ?? null,
      searchText,
    };
  });
}

export function createEvidenceAgentTools({
  acceptedRegionUnderstandings = [],
  sourceDocuments = [],
  sourceRegions = [],
  readRangePreview = null,
} = {}) {
  const acceptedCards = buildAcceptedRegionCards({ acceptedRegionUnderstandings, sourceDocuments });
  const unconfirmedCards = buildUnconfirmedRegionCards({ sourceRegions, sourceDocuments });

  return {
    async list_confirmed_regions(input = {}) {
      const semanticType = clean(input.semanticType);
      const experimentAlias = clean(input.experimentAlias);
      const regions = acceptedCards.filter((card) => {
        if (semanticType && card.semanticType !== semanticType) return false;
        if (experimentAlias && !normalizeText(card.searchText).includes(normalizeText(experimentAlias))) return false;
        return true;
      });
      return { regions };
    },

    async semantic_search_confirmed_regions(input = {}) {
      const query = clean(input.query);
      const topK = Math.max(1, Math.min(20, Number(input.topK) || 5));
      const ranked = acceptedCards
        .map((card) => {
          const scored = lexicalScore(query, card);
          return {
            ...card,
            score: scored.score,
            ranker: "fallback_region_card",
            matchedSignals: scored.matchedSignals,
            matchedReason: "Matched against accepted region-understanding revision text.",
          };
        })
        .filter((card) => card.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { results: ranked };
    },

    async semantic_search_unconfirmed_regions(input = {}) {
      const query = clean(input.query);
      const topK = Math.max(1, Math.min(20, Number(input.topK) || 5));
      const ranked = unconfirmedCards
        .map((card) => {
          const scored = lexicalScore(query, card);
          return {
            ...card,
            score: scored.score,
            ranker: "fallback_region_card",
            matchedSignals: scored.matchedSignals,
            matchedReason: "Matched against unconfirmed detected source-region text.",
          };
        })
        .filter((card) => card.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { suggestions: ranked };
    },

    async read_confirmed_region_preview(input = {}) {
      const regionId = clean(input.regionId);
      const region = acceptedCards.find((card) => card.regionId === regionId || card.resultId === regionId);
      if (!region) {
        return { error: { code: "confirmed_region_not_found", message: "Confirmed region not found." } };
      }
      const preview = readRangePreview
        ? await readRangePreview({
          sourceDocumentId: region.sourceDocumentId,
          sheetName: region.sheetName,
          range: region.range,
          maxRows: input.maxRows || 20,
          maxColumns: input.maxColumns || 12,
        })
        : null;
      return { region, preview };
    },

    async verify_evidence_selection(input = {}) {
      const selectedRegionIds = asArray(input.selectedRegionIds).map(clean).filter(Boolean);
      const requiredAliases = asArray(input.requiredExperimentAliases).map(clean).filter(Boolean);
      const requiredSemanticTypes = asArray(input.requiredSemanticTypes).map(clean).filter(Boolean);
      const selected = selectedRegionIds
        .map((regionId) => acceptedCards.find((card) => card.regionId === regionId || card.resultId === regionId))
        .filter(Boolean);
      const rejected = [];
      const usableRegions = selected.filter((card) => {
        if (requiredSemanticTypes.length && !requiredSemanticTypes.includes(card.semanticType)) {
          rejected.push({ regionId: card.regionId, code: "semantic_type_mismatch" });
          return false;
        }
        for (const alias of requiredAliases) {
          if (!normalizeText(card.searchText).includes(normalizeText(alias))) {
            rejected.push({ regionId: card.regionId, code: "experiment_alias_mismatch", expected: alias });
            return false;
          }
        }
        if (!card.sourceDocumentId || !card.sheetName || !card.range) {
          rejected.push({ regionId: card.regionId, code: "missing_source_ref" });
          return false;
        }
        return true;
      });
      return {
        status: usableRegions.length && !rejected.length ? "verified" : "rejected",
        usableRegions,
        rejected,
      };
    },
  };
}
