import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";
import { WorkbookReviewDock } from "./WorkbookReviewDock.jsx";
import { getAnalysisThread } from "../data/analysisApi.js";
import { listExperimentBrowserRows } from "../data/experimentBrowserApi.js";
import {
  INITIAL_PROJECT_ONBOARDING,
  readProjectOnboarding,
  writeProjectOnboarding,
} from "../data/projectOnboardingState.js";

const PROJECT_STAGE_OPTIONS = [
  {
    value: "early",
    label: "We just started",
    detail: "We barely have data.",
  },
  {
    value: "established",
    label: "We have an established workflow",
    detail: "We already have some amount of data.",
  },
  {
    value: "mature",
    label: "We have a mature routine",
    detail: "We are preparing the project for publication.",
  },
];

const MASTER_TABLE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "changing", label: "Yes, but it will likely change" },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sameWorkflowEntity(current, next) {
  if (current === next) return true;
  if (!current || !next) return current === next;
  return current.id === next.id
    && current.status === next.status
    && current.updatedAt === next.updatedAt;
}

function workbookNameForSession(session) {
  return session?.workbookSummary?.workbookName || session?.fileName || "your workbook";
}

function displayCell(row, column) {
  if (column?.id === "experiment") return row?.label || "-";
  const cell = row?.cells?.[column?.id];
  if (!cell || cell.value == null || cell.value === "") return "-";
  const value = cell.formattedValue ?? cell.value;
  return `${value}${column?.unit ? ` ${column.unit}` : ""}`;
}

function previewColumns(columns) {
  const all = asArray(columns);
  const preferred = all.filter((column) => column.pinned || column.recommended);
  const selected = preferred.length ? preferred : all;
  return selected.slice(0, 6);
}

function OnboardingMessage({ role = "assistant", children }) {
  return (
    <div className={`project-onboarding-message ${role}`}>
      {role === "assistant"
        ? <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
        : <span className="project-onboarding-user-avatar">You</span>}
      <div>
        <strong>{role === "assistant" ? "LabRat" : "You"}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

function ChoiceButtons({ options, onChoose }) {
  return (
    <div className="project-onboarding-choices">
      {options.map((option) => (
        <button type="button" key={option.value} onClick={() => onChoose(option)}>
          <strong>{option.label}</strong>
          {option.detail && <span>{option.detail}</span>}
        </button>
      ))}
    </div>
  );
}

function BrowserPreview({ preview }) {
  const columns = previewColumns(preview?.columns);
  const rows = asArray(preview?.rows).slice(0, 8);
  return (
    <section className="project-onboarding-browser-preview" aria-label="Experiment Browser preview">
      <header>
        <div>
          <span>Experiment Browser preview</span>
          <strong>{preview?.totalCount || rows.length} experiments found</strong>
        </div>
        <small>Showing the first {rows.length} reviewed records</small>
      </header>
      <div className="project-onboarding-browser-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => <th key={column.id}>{column.label || column.id}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.experimentId || row.label}>
                {columns.map((column) => <td key={column.id}>{displayCell(row, column)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProjectOnboarding({
  projectId,
  projectState,
  onUploadWorkbook,
  onHydrateWorkbookReview,
  reviewState = {},
  reviewRegions = [],
  activeRegionId = "",
  onActiveRegionChange,
  onReviseRegion,
  onConfirmRegion,
  onRetryRegion,
  onIgnoreRegion,
  onDeleteRegion,
  onCreateExperimentPlan,
  onAcceptAnalysisResult,
  onRequestCorrection,
  onComplete,
  onExit,
  loadBrowserPreview = listExperimentBrowserRows,
  loadAnalysisThread = getAnalysisThread,
  AnalysisReviewComponent = AnalysisReviewWorkspace,
}) {
  const [state, setState] = useState(() => ({
    ...INITIAL_PROJECT_ONBOARDING,
    ...(readProjectOnboarding(projectId) || {}),
  }));
  const [input, setInput] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [previewState, setPreviewState] = useState({ loading: false, error: "", value: null });
  const [analysisFlow, setAnalysisFlow] = useState({ loading: false, error: "", thread: null, revision: null });
  const [analysisHydrationAttempt, setAnalysisHydrationAttempt] = useState(0);
  const fileInputRef = useRef(null);
  const hydratedSessionRef = useRef("");
  const publishedCount = asArray(projectState?.experimentSnapshotHeads).length;
  const activeRegions = asArray(reviewRegions.length ? reviewRegions : projectState?.workbookReviewRegions)
    .filter((region) => !region?.disposition || region.disposition === "active");
  const acceptedRegionCount = activeRegions
    .filter((region) => Boolean(region.acceptedRevisionId)).length;
  const currentSession = useMemo(() => {
    const activeSessions = asArray(projectState?.workbookReviewSessions)
      .filter((session) => session?.status !== "deleted");
    return activeSessions.find((session) => session.id === state.workbookReviewSessionId)
      || activeSessions[activeSessions.length - 1]
      || null;
  }, [projectState?.workbookReviewSessions, state.workbookReviewSessionId]);

  const updateState = useCallback((patch) => {
    setState((current) => {
      const resolvedPatch = typeof patch === "function" ? patch(current) : patch;
      const entries = Object.entries(resolvedPatch || {});
      if (!entries.some(([key, value]) => !Object.is(current[key], value))) {
        return current;
      }
      const next = { ...current, ...resolvedPatch };
      writeProjectOnboarding(projectId, next);
      return next;
    });
  }, [projectId]);

  useEffect(() => {
    if (!readProjectOnboarding(projectId)) {
      writeProjectOnboarding(projectId, state);
    }
  }, [projectId]);

  useEffect(() => {
    if (!state.analysisThreadId) return undefined;
    let cancelled = false;
    setAnalysisFlow((current) => ({ ...current, loading: true, error: "" }));
    loadAnalysisThread(state.analysisThreadId)
      .then((response) => {
        if (cancelled) return;
        const revisions = asArray(response?.planRevisions);
        const revision = revisions.find((item) => item.id === state.analysisPlanRevisionId)
          || revisions.findLast((item) => ["awaiting_review", "accepted"].includes(item.status))
          || revisions.at(-1)
          || null;
        setAnalysisFlow({
          loading: false,
          error: "",
          thread: response?.analysisThread || null,
          revision,
        });
      })
      .catch((error) => {
        if (!cancelled) setAnalysisFlow({ loading: false, error: error?.message || String(error), thread: null, revision: null });
      });
    return () => {
      cancelled = true;
    };
  }, [analysisHydrationAttempt, loadAnalysisThread, state.analysisPlanRevisionId, state.analysisThreadId]);

  useEffect(() => {
    if (!currentSession?.id || reviewState?.session?.id === currentSession.id) return;
    if (hydratedSessionRef.current === currentSession.id || !onHydrateWorkbookReview) return;
    hydratedSessionRef.current = currentSession.id;
    Promise.resolve(onHydrateWorkbookReview(currentSession)).catch(() => {
      hydratedSessionRef.current = "";
    });
  }, [currentSession, onHydrateWorkbookReview, reviewState?.session?.id]);

  useEffect(() => {
    if (!publishedCount || state.step === "complete") return;
    if (!["preview", "correction"].includes(state.step)) {
      updateState({ step: "preview", workbookStatus: "published" });
    }
  }, [publishedCount, state.step]);

  useEffect(() => {
    if (state.step !== "preview" || !publishedCount || previewState.loading || previewState.value) return undefined;
    const controller = new AbortController();
    setPreviewState({ loading: true, error: "", value: null });
    loadBrowserPreview(projectId, { limit: 8 }, { signal: controller.signal })
      .then((value) => setPreviewState({ loading: false, error: "", value }))
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setPreviewState({ loading: false, error: error?.message || String(error), value: null });
        }
      });
    return () => controller.abort();
  }, [loadBrowserPreview, projectId, publishedCount, state.step]);

  const selectProjectStage = (option) => {
    updateState({ projectStage: option.value, step: "master_table" });
  };

  const selectMasterTableStatus = (option) => {
    updateState({ masterTableStatus: option.value, step: "upload" });
  };

  const uploadWorkbook = async (file) => {
    if (!file) return;
    setUploadError("");
    updateState({
      step: "region_review",
      workbookStatus: "processing",
      workbookFileName: file.name,
    });
    try {
      const result = await onUploadWorkbook?.(file);
      const session = result?.session || result?.workbookReviewSession || null;
      updateState({
        workbookStatus: "ready",
        workbookFileName: session ? workbookNameForSession(session) : file.name,
        workbookReviewSessionId: session?.id || "",
      });
    } catch (error) {
      setUploadError(error?.message || String(error));
      updateState({ workbookStatus: "error" });
    }
  };

  const onFileSelected = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    uploadWorkbook(file);
  };

  const submitTextAnswer = () => {
    const answer = input.trim();
    if (!answer) return;
    setInput("");
    if (state.step === "workflow") {
      updateState({ experimentalWorkflow: answer, step: "analysis" });
      return;
    }
    if (state.step === "analysis") {
      updateState({
        dataAnalysisProcess: answer,
        step: ["ready", "error"].includes(state.generationStatus) ? "result_review" : "waiting_result",
      });
      return;
    }
    if (state.step === "correction") {
      const next = { ...state, correction: answer };
      writeProjectOnboarding(projectId, next);
      setState(next);
      onRequestCorrection?.(answer);
    }
  };

  const createExperimentPlan = async () => {
    if (analysisFlow.loading || !onCreateExperimentPlan) return;
    setAnalysisFlow({ loading: true, error: "", thread: null, revision: null });
    updateState({ step: "plan_generating" });
    try {
      const response = await onCreateExperimentPlan();
      const thread = response?.analysisThread || null;
      const revision = response?.currentPlanRevision || response?.analysisPlanRevision || null;
      if (!thread?.id || !revision?.id) {
        throw new Error(response?.reply || "LabRat did not return a reviewable Experiment Browser plan.");
      }
      setAnalysisFlow({ loading: false, error: "", thread, revision });
      updateState({
        step: "plan_review",
        analysisThreadId: thread.id,
        analysisPlanRevisionId: revision.id,
        generationStatus: "idle",
      });
    } catch (error) {
      setAnalysisFlow({ loading: false, error: error?.message || String(error), thread: null, revision: null });
      updateState({ step: "region_review" });
    }
  };

  const handleAnalysisWorkflowState = useCallback((workflow) => {
    if (workflow?.thread || workflow?.revision) {
      setAnalysisFlow((current) => {
        const nextThread = workflow.thread || current.thread;
        const nextRevision = workflow.revision || current.revision;
        if (
          sameWorkflowEntity(current.thread, nextThread)
          && sameWorkflowEntity(current.revision, nextRevision)
        ) {
          return current;
        }
        return {
          ...current,
          thread: nextThread,
          revision: nextRevision,
        };
      });
    }
    updateState((current) => {
      const patch = {};
      if (workflow?.thread?.id && current.analysisThreadId !== workflow.thread.id) patch.analysisThreadId = workflow.thread.id;
      if (workflow?.revision?.id && current.analysisPlanRevisionId !== workflow.revision.id) patch.analysisPlanRevisionId = workflow.revision.id;
      if (workflow?.run?.id && current.analysisRunId !== workflow.run.id) patch.analysisRunId = workflow.run.id;
      if (workflow?.result?.id && current.analysisResultId !== workflow.result.id) patch.analysisResultId = workflow.result.id;
      if (workflow?.revision?.status === "accepted" && workflow?.run?.id) {
        if (current.generationStatus !== "ready") patch.generationStatus = workflow.previewReady ? "ready" : "working";
        if (["queued", "running"].includes(workflow?.run?.status)) patch.generationError = "";
        if (["plan_review", "plan_generating"].includes(current.step)) patch.step = "workflow";
      }
      if (workflow?.previewReady) {
        patch.generationStatus = "ready";
        if (current.step === "waiting_result") patch.step = "result_review";
      }
      if (workflow?.error && (workflow?.run?.id || current.generationStatus === "working")) {
        patch.generationStatus = "error";
        patch.generationError = typeof workflow.error === "string"
          ? workflow.error
          : workflow.error?.message || "Experiment Browser generation failed before a preview was created.";
        patch.step = "result_review";
      }
      return patch;
    });
  }, [updateState]);

  const completeOnboarding = () => {
    const next = { ...state, status: "completed", step: "complete" };
    writeProjectOnboarding(projectId, next);
    setState(next);
    onComplete?.();
  };

  const skipOnboarding = () => {
    const next = { ...state, status: "skipped" };
    writeProjectOnboarding(projectId, next);
    setState(next);
    onComplete?.();
  };

  const pauseOnboarding = () => {
    const next = { ...state, status: "paused" };
    writeProjectOnboarding(projectId, next);
    setState(next);
    onExit?.();
  };

  const showComposer = ["workflow", "analysis", "correction"].includes(state.step);
  const placeholder = state.step === "workflow"
    ? "Describe your experimental workflow..."
    : state.step === "analysis"
      ? "Describe how you analyze your data..."
      : "Describe what looks wrong and what should be corrected...";

  return (
    <main className="project-onboarding-page">
      <header className="project-onboarding-header">
        <button type="button" className="project-onboarding-brand" onClick={onExit}>
          <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
          <span>LabRat</span>
        </button>
        <div>
          <span>{projectState?.project?.name || "New project"}</span>
          <button type="button" onClick={skipOnboarding}>Skip onboarding</button>
        </div>
      </header>

      <section className="project-onboarding-chat" aria-label="Project onboarding">
        <div className="project-onboarding-progress">
          <span style={{ width: `${Math.min(100, {
            welcome: 8,
            project_stage: 18,
            master_table: 30,
            upload: 42,
            region_review: 54,
            plan_generating: 64,
            plan_review: 72,
            workflow: 78,
            analysis: 84,
            waiting_result: 86,
            result_review: 90,
            preview: 92,
            correction: 94,
            complete: 100,
          }[state.step] || 8)}%` }} />
        </div>

        {["working", "ready", "error"].includes(state.generationStatus) && (
          <div className={`project-onboarding-generation-status is-${state.generationStatus}`} role="status" aria-live="polite">
            {state.generationStatus === "working" && <span className="project-onboarding-status-spinner" aria-hidden="true" />}
            {state.generationStatus === "ready" && <span aria-hidden="true">✓</span>}
            {state.generationStatus === "error" && <span aria-hidden="true">!</span>}
            <strong>
              {state.generationStatus === "working"
                ? "Generating your Experiment Browser preview…"
                : state.generationStatus === "ready"
                  ? "Preview ready"
                  : "Generation failed"}
            </strong>
          </div>
        )}

        <div className="project-onboarding-messages">
          <OnboardingMessage>
            <p>Hi, I’m LabRat, your AI research assistant.</p>
            <p>I can help you manage experimental data, create visualizations, and prepare research outputs. First, help me understand your project.</p>
          </OnboardingMessage>

          {state.step === "welcome" && (
            <button type="button" className="project-onboarding-primary" onClick={() => updateState({ step: "project_stage" })}>
              Let’s get started
            </button>
          )}

          {state.step !== "welcome" && (
            <OnboardingMessage>
              <p>What stage is your project currently in?</p>
              {state.step === "project_stage" && <ChoiceButtons options={PROJECT_STAGE_OPTIONS} onChoose={selectProjectStage} />}
            </OnboardingMessage>
          )}

          {state.projectStage && (
            <>
              <OnboardingMessage role="user">
                <p>{PROJECT_STAGE_OPTIONS.find((option) => option.value === state.projectStage)?.label}</p>
              </OnboardingMessage>
              <OnboardingMessage>
                <p>Do you have a master table or another workbook that compiles your experimental data?</p>
                {state.step === "master_table" && <ChoiceButtons options={MASTER_TABLE_OPTIONS} onChoose={selectMasterTableStatus} />}
              </OnboardingMessage>
            </>
          )}

          {state.masterTableStatus && (
            <>
              <OnboardingMessage role="user">
                <p>{MASTER_TABLE_OPTIONS.find((option) => option.value === state.masterTableStatus)?.label}</p>
              </OnboardingMessage>
              <OnboardingMessage>
                <p>
                  {state.masterTableStatus === "no"
                    ? "That’s okay. For this preview, upload the workbook that currently comes closest to compiling your experiments."
                    : "Great. Upload that workbook and I’ll start mapping its structure."}
                </p>
                {state.step === "upload" && (
                  <button type="button" className="project-onboarding-upload" onClick={() => fileInputRef.current?.click()}>
                    Upload Excel workbook
                  </button>
                )}
                {state.workbookStatus === "error" && (
                  <div className="project-onboarding-error">
                    <p>{uploadError || "The workbook could not be processed."}</p>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>Try another workbook</button>
                  </div>
                )}
              </OnboardingMessage>
            </>
          )}

          {state.workbookFileName && (
            <OnboardingMessage role="user">
              <p>Uploaded {state.workbookFileName}</p>
            </OnboardingMessage>
          )}

          {["region_review", "plan_generating"].includes(state.step) && (
            <OnboardingMessage>
              <p>I found the main sections of {state.workbookFileName || "your workbook"}. Confirm what each region means before I prepare the Experiment Browser plan.</p>
            </OnboardingMessage>
          )}

          {state.step === "region_review" && (
            <div className="project-onboarding-inline-review">
              <WorkbookReviewDock
                reviewState={{ ...reviewState, session: reviewState.session || currentSession }}
                reviewRegions={activeRegions}
                activeRegionId={activeRegionId}
                onActiveRegionChange={onActiveRegionChange}
                onReviseRegion={onReviseRegion}
                onConfirmRegion={onConfirmRegion}
                onRetryRegion={onRetryRegion}
                onIgnoreRegion={onIgnoreRegion}
                onDeleteRegion={onDeleteRegion}
                onReviewExtractedExperiments={acceptedRegionCount > 0 ? createExperimentPlan : null}
              />
              {analysisFlow.error && <p className="project-onboarding-error" role="alert">{analysisFlow.error}</p>}
            </div>
          )}

          {state.step === "plan_generating" && (
            <OnboardingMessage>
              <p>I’m using the confirmed workbook evidence to prepare an Experiment Browser plan.</p>
              <div className="project-onboarding-processing"><span /> Generating a reviewable plan…</div>
            </OnboardingMessage>
          )}

          {state.analysisThreadId && analysisFlow.error && state.step !== "region_review" && (
            <div className="project-onboarding-error" role="alert">
              <p>{analysisFlow.error}</p>
              <button type="button" className="project-onboarding-secondary" onClick={() => {
                setAnalysisFlow({ loading: false, error: "", thread: null, revision: null });
                setAnalysisHydrationAttempt((value) => value + 1);
              }}>Retry loading the plan</button>
            </div>
          )}

          {analysisFlow.thread?.id && analysisFlow.revision?.id && (
            <div className={`project-onboarding-analysis${["plan_review", "result_review"].includes(state.step) ? "" : " is-background"}`}>
              <AnalysisReviewComponent
                projectId={projectId}
                thread={analysisFlow.thread}
                revision={analysisFlow.revision}
                onAcceptResult={onAcceptAnalysisResult}
                onAccepted={() => {}}
                onWorkflowStateChange={handleAnalysisWorkflowState}
                executionStrategy="direct_source_mapping"
                embedded
              />
            </div>
          )}

          {["workflow", "analysis", "waiting_result", "result_review"].includes(state.step) && (
            <OnboardingMessage>
              <p>Plan accepted. I’m now creating your Experiment Browser preview. While I work on that, tell me more about your project: what does your experimental workflow look like?</p>
            </OnboardingMessage>
          )}

          {state.experimentalWorkflow && (
            <>
              <OnboardingMessage role="user"><p>{state.experimentalWorkflow}</p></OnboardingMessage>
              <OnboardingMessage><p>Got it. What does your data-analysis process look like?</p></OnboardingMessage>
            </>
          )}

          {state.dataAnalysisProcess && <OnboardingMessage role="user"><p>{state.dataAnalysisProcess}</p></OnboardingMessage>}

          {state.step === "waiting_result" && (
            <OnboardingMessage>
              <p>Thanks—I’ll keep that context with this onboarding session. I’m still validating the Experiment Browser preview.</p>
              <div className="project-onboarding-processing"><span /> Finishing source and calculation checks…</div>
            </OnboardingMessage>
          )}

          {state.step === "result_review" && state.generationStatus !== "error" && (
            <OnboardingMessage><p>Perfect—the preview is ready. Review it below before publishing anything to the Experiment Browser.</p></OnboardingMessage>
          )}

          {state.step === "result_review" && state.generationStatus === "error" && (
            <OnboardingMessage>
              <p><strong>Experiment Browser generation failed.</strong></p>
              <p>{state.generationError || "LabRat could not create a reviewable preview from this attempt."}</p>
              <p>Your workbook, confirmed region, accepted plan, and onboarding answers are still saved.</p>
              <button type="button" className="project-onboarding-secondary" onClick={pauseOnboarding}>Quit for now</button>
            </OnboardingMessage>
          )}

          {state.step === "preview" && (
            <OnboardingMessage>
              <p>Here’s how I understood your experiments. Does this look right to you?</p>
              {previewState.loading && <div className="project-onboarding-processing"><span /> Loading reviewed experiments…</div>}
              {previewState.error && <p className="project-onboarding-error">{previewState.error}</p>}
              {previewState.value && <BrowserPreview preview={previewState.value} />}
              <div className="project-onboarding-confirm">
                <button type="button" className="project-onboarding-primary" onClick={completeOnboarding}>Yes, this looks right</button>
                <button type="button" className="project-onboarding-secondary" onClick={() => updateState({ step: "correction" })}>No, something needs correcting</button>
              </div>
            </OnboardingMessage>
          )}

          {state.step === "correction" && (
            <OnboardingMessage>
              <p>Describe what looks wrong and what should be corrected. I’ll prepare that as a reviewed change instead of silently changing your accepted data.</p>
            </OnboardingMessage>
          )}
        </div>

        {showComposer && (
          <div className="project-onboarding-composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitTextAnswer();
                }
              }}
              placeholder={placeholder}
              autoFocus
            />
            <button type="button" disabled={!input.trim()} onClick={submitTextAnswer} aria-label="Send onboarding answer">↑</button>
          </div>
        )}
      </section>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={onFileSelected} />
    </main>
  );
}
