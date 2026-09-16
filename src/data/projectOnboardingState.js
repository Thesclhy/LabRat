const STORAGE_PREFIX = "labrat_project_onboarding_v1_";
const SCHEMA_VERSION = 4;

// Short context questions asked one at a time while the Experiment Browser
// preview generates. Answers are display-only onboarding context today.
export const ONBOARDING_CONTEXT_QUESTIONS = [
  { id: "project_focus", chain: "workflow", question: "In one sentence, what is the focus of this project?" },
  { id: "experiment_routine", chain: "workflow", question: "What does a typical experiment routine look like?" },
  { id: "measured_parameters", chain: "workflow", question: "Which parameters do you measure, and which matter most?" },
  { id: "instruments", chain: "analysis", question: "Which instruments collect your data?" },
  { id: "raw_data_processing", chain: "analysis", question: "How do you turn the raw data into the values you report?" },
];

export const INITIAL_PROJECT_ONBOARDING = {
  schemaVersion: SCHEMA_VERSION,
  status: "in_progress",
  step: "welcome",
  projectStage: "",
  masterTableStatus: "",
  contextAnswers: {},
  contextIndex: 0,
  contextIndexAtPlanReview: null,
  workbookStatus: "idle",
  workbookFileName: "",
  workbookReviewSessionId: "",
  analysisThreadId: "",
  analysisPlanRevisionId: "",
  analysisRunId: "",
  analysisResultId: "",
  generationStatus: "idle",
  generationError: "",
  correction: "",
  workbookRounds: [],
  round: null,
  publishedCountAtRoundStart: 0,
  batch: null,
  batchRounds: [],
};

export function projectOnboardingStorageKey(projectId) {
  return `${STORAGE_PREFIX}${encodeURIComponent(String(projectId || ""))}`;
}

function firstQuestionOfChain(chain) {
  return ONBOARDING_CONTEXT_QUESTIONS.find((item) => item.chain === chain)?.id || "";
}

function indexOfChainStart(chain) {
  const index = ONBOARDING_CONTEXT_QUESTIONS.findIndex((item) => item.chain === chain);
  return index < 0 ? 0 : index;
}

// Version 3 stored the two context answers as free-text essays under
// `experimentalWorkflow` and `dataAnalysisProcess`, with steps named
// `workflow` and `analysis`. Map them onto the first question of each chain so
// a saved session keeps what the user already typed.
export function migrateProjectOnboarding(stored) {
  if (!stored || typeof stored !== "object") return null;
  const { experimentalWorkflow, dataAnalysisProcess, ...rest } = stored;
  const next = { ...rest };
  const contextAnswers = { ...(rest.contextAnswers && typeof rest.contextAnswers === "object" ? rest.contextAnswers : {}) };
  if (typeof experimentalWorkflow === "string" && experimentalWorkflow.trim()) {
    contextAnswers[firstQuestionOfChain("workflow")] = experimentalWorkflow;
  }
  if (typeof dataAnalysisProcess === "string" && dataAnalysisProcess.trim()) {
    contextAnswers[firstQuestionOfChain("analysis")] = dataAnalysisProcess;
  }
  next.contextAnswers = contextAnswers;
  if (rest.step === "workflow") {
    next.step = "context";
    next.contextIndex = contextAnswers[firstQuestionOfChain("workflow")] ? 1 : 0;
  } else if (rest.step === "analysis") {
    next.step = "context";
    next.contextIndex = indexOfChainStart("analysis") + (contextAnswers[firstQuestionOfChain("analysis")] ? 1 : 0);
  }
  if (!Number.isInteger(next.contextIndex)) next.contextIndex = 0;
  // A session saved after publication cannot still be generating its preview.
  const pastPublication = typeof next.step === "string" && (next.step.startsWith("batch_") || ["more_workbooks", "preview", "correction", "complete"].includes(next.step));
  if (pastPublication && next.generationStatus === "working") next.generationStatus = "idle";
  next.schemaVersion = SCHEMA_VERSION;
  return next;
}

export function readProjectOnboarding(projectId) {
  if (!projectId || typeof window === "undefined" || !window.localStorage) return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(projectOnboardingStorageKey(projectId)) || "null");
    if (!stored || typeof stored !== "object") return null;
    return { ...INITIAL_PROJECT_ONBOARDING, ...migrateProjectOnboarding(stored) };
  } catch {
    return null;
  }
}

export function writeProjectOnboarding(projectId, state) {
  if (!projectId || typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(projectOnboardingStorageKey(projectId), JSON.stringify({
    ...INITIAL_PROJECT_ONBOARDING,
    ...migrateProjectOnboarding(state || {}),
    schemaVersion: SCHEMA_VERSION,
  }));
}

export function shouldShowProjectOnboarding(projectId, projectState) {
  if (!projectId || !projectState?.project) return false;
  const stored = readProjectOnboarding(projectId);
  if (["completed", "skipped"].includes(stored?.status)) return false;
  if (stored?.status === "in_progress") return true;
  const hasWorkbook = (projectState.workbookReviewSessions || [])
    .some((session) => session?.status !== "deleted");
  const hasPublishedExperiments = (projectState.experimentSnapshotHeads || []).length > 0;
  return !hasWorkbook && !hasPublishedExperiments;
}
