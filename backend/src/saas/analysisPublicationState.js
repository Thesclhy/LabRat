import { currentPlanRevision, latestRevisionRun } from "./analysisOrdering.js";

export function assertCurrentAnalysisPublication({ thread, revision, run, result, revisions, runs }) {
  const current = currentPlanRevision(revisions);
  const latest = latestRevisionRun(runs, current?.id, thread);
  if (!thread || !revision || !run || !result
    || current?.id !== revision.id || latest?.id !== run.id
    || revision.analysisThreadId !== thread.id || run.analysisThreadId !== thread.id
    || run.acceptedPlanRevisionId !== revision.id
    || result.analysisThreadId !== thread.id
    || result.analysisRunId !== run.id
    || result.projectId !== thread.projectId || revision.projectId !== thread.projectId || run.projectId !== thread.projectId
    || run.resultPreviewHash !== result.resultPreviewHash) {
    throw Object.assign(new Error("A newer analysis plan or run is available. Review the latest result before publishing."), {
      code: "analysis_result_stale", statusCode: 409,
    });
  }
}
