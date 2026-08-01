const STORAGE_PREFIX = "labrat_project_onboarding_v1_";

export const INITIAL_PROJECT_ONBOARDING = {
  schemaVersion: 3,
  status: "in_progress",
  step: "welcome",
  projectStage: "",
  masterTableStatus: "",
  experimentalWorkflow: "",
  dataAnalysisProcess: "",
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
};

export function projectOnboardingStorageKey(projectId) {
  return `${STORAGE_PREFIX}${encodeURIComponent(String(projectId || ""))}`;
}

export function readProjectOnboarding(projectId) {
  if (!projectId || typeof window === "undefined" || !window.localStorage) return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(projectOnboardingStorageKey(projectId)) || "null");
    if (!stored || typeof stored !== "object") return null;
    return { ...INITIAL_PROJECT_ONBOARDING, ...stored };
  } catch {
    return null;
  }
}

export function writeProjectOnboarding(projectId, state) {
  if (!projectId || typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(projectOnboardingStorageKey(projectId), JSON.stringify({
    ...INITIAL_PROJECT_ONBOARDING,
    ...state,
    schemaVersion: 3,
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
