import { resolveAnalysisSelection, resolveExperimentScope } from "./analysisSelection.js";
import { validateAnalysisPlanRevision } from "./analysisSchemas.js";

const PREVIEW_RECORD_LIMIT = 50;
const INSPECTION_LIMIT = 200;

const TOOL_DEFINITIONS = [{
  name: "get_project_analysis_context",
  description: "Return bounded project and accepted-artifact analysis context.",
}, {
  name: "inspect_analysis_selection",
  description: "Inspect a bounded page from a previously previewed selection.",
}, {
  name: "list_analysis_fields",
  description: "List unit-aware fields from accepted active experiment snapshots.",
}, {
  name: "preview_analysis_selection",
  description: "Resolve accepted fields and experiments into a reviewable selection.",
}, {
  name: "resolve_experiment_scope",
  description: "Resolve explicit ids or aliases to active experiment identities.",
}, {
  name: "validate_analysis_plan",
  description: "Validate a calculation manifest and exact Python without executing it.",
}];

const HANDLER_KEYS = {
  get_project_analysis_context: "getProjectAnalysisContext",
  inspect_analysis_selection: "inspectAnalysisSelection",
  list_analysis_fields: "listAnalysisFields",
  preview_analysis_selection: "previewAnalysisSelection",
  resolve_experiment_scope: "resolveExperimentScope",
  validate_analysis_plan: "validateAnalysisPlan",
};

function text(value) {
  return String(value ?? "").trim();
}

function toolError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function boundedPreview(value) {
  const records = Array.isArray(value?.records) ? value.records : [];
  return {
    ...value,
    records: records.slice(0, PREVIEW_RECORD_LIMIT),
    recordCount: records.length,
    truncated: records.length > PREVIEW_RECORD_LIMIT,
  };
}

export function createAnalysisToolRegistry({ handlers = {} } = {}) {
  const selections = new Map();
  return {
    list() {
      return TOOL_DEFINITIONS.map((item) => ({ ...item }));
    },
    async call(name, args = {}, authContext = {}) {
      const handlerKey = HANDLER_KEYS[name];
      if (!handlerKey) {
        throw toolError("analysis_tool_not_found", `Analysis tool ${name} was not found.`, 404);
      }
      const projectId = text(args.projectId);
      if (!projectId) {
        throw toolError("analysis_tool_project_required", "Analysis tools require projectId.");
      }
      if (text(authContext.projectId) !== projectId) {
        throw toolError("analysis_tool_project_forbidden", "Analysis tool project scope does not match authorization.", 403);
      }
      const handler = handlers[handlerKey];
      if (typeof handler !== "function") {
        throw toolError("analysis_tool_unavailable", `Analysis tool ${name} is not configured.`, 503);
      }

      const boundedArgs = name === "inspect_analysis_selection"
        ? {
          ...args,
          limit: Math.min(Math.max(Number.parseInt(args.limit, 10) || 50, 1), INSPECTION_LIMIT),
          selection: selections.get(text(args.selectionId)) || null,
        }
        : args;
      const output = await handler(boundedArgs, authContext);
      if (output?.projectId && output.projectId !== projectId) {
        throw toolError("analysis_tool_project_mismatch", "Analysis tool returned another project's data.", 500);
      }
      if (name === "preview_analysis_selection") {
        if (output?.selectionId) selections.set(output.selectionId, output);
        return boundedPreview(output);
      }
      return output;
    },
  };
}

async function activeInputs(store, projectId) {
  const [dataSnapshots, experimentIdentities, experimentSnapshotHeads] = await Promise.all([
    store.listDataSnapshots({ projectId }),
    store.listExperimentIdentities({ projectId }),
    store.listExperimentSnapshotHeads({ projectId }),
  ]);
  return { projectId, dataSnapshots, experimentIdentities, experimentSnapshotHeads };
}

export function createStoreBackedAnalysisHandlers({ store } = {}) {
  return {
    async getProjectAnalysisContext({ projectId }) {
      const [project, inputs, sourceDocuments, chartSpecs, manuscripts] = await Promise.all([
        store.findProjectById(projectId),
        activeInputs(store, projectId),
        store.listSourceDocuments({ projectId }),
        store.listChartSpecs({ projectId }),
        store.listManuscripts({ projectId }),
      ]);
      return {
        projectId,
        project: project ? {
          id: project.id,
          name: project.name,
          description: project.description || "",
          projectProfile: project.metadata?.projectProfile || {},
        } : null,
        publishedExperimentCount: inputs.experimentSnapshotHeads.length,
        sourceDocumentCount: sourceDocuments.length,
        chartSpecCount: chartSpecs.length,
        manuscriptCount: manuscripts.length,
      };
    },
    async listAnalysisFields({ projectId }) {
      const selection = resolveAnalysisSelection({
        ...(await activeInputs(store, projectId)),
        selectionRequest: { experimentIds: [], fieldIds: [], includeSeries: false },
      });
      return {
        projectId,
        fields: selection.fieldCatalog,
        publishedExperimentCount: selection.experimentIds.length,
      };
    },
    async resolveExperimentScope({ projectId, experimentIds = [], experimentAliases = [] }) {
      const inputs = await activeInputs(store, projectId);
      const activeIds = new Set(inputs.experimentSnapshotHeads.map((head) => head.experimentId));
      const scope = resolveExperimentScope({
        experimentIdentities: inputs.experimentIdentities.filter((identity) => activeIds.has(identity.id)),
        requestedExperimentIds: experimentIds,
        requestedAliases: experimentAliases,
      });
      return { projectId, ...scope };
    },
    async previewAnalysisSelection({ projectId, selectionRequest = {} }) {
      return resolveAnalysisSelection({
        ...(await activeInputs(store, projectId)),
        selectionRequest,
      });
    },
    async inspectAnalysisSelection({ projectId, selection, offset = 0, limit = 50 }) {
      if (!selection || selection.projectId !== projectId) {
        throw toolError("analysis_selection_not_found", "Analysis selection handle was not found.", 404);
      }
      const start = Math.max(Number.parseInt(offset, 10) || 0, 0);
      return {
        projectId,
        selectionId: selection.selectionId,
        rows: selection.records.slice(start, start + limit),
        page: {
          offset: start,
          limit,
          totalCount: selection.records.length,
        },
      };
    },
    async validateAnalysisPlan({ projectId, plan }) {
      return { projectId, ...validateAnalysisPlanRevision(plan) };
    },
  };
}
