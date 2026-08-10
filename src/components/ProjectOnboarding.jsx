import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";
import { WorkbookReviewDock } from "./WorkbookReviewDock.jsx";
import { getAnalysisThread } from "../data/analysisApi.js";
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

const ASSISTANT_RESPONSE_DELAY_MS = 500;
const PLAN_GENERATION_TIMEOUT_MS = 120_000;
const PLAN_HYDRATION_POLL_MS = 1_500;
const PLAN_DRAFT_STALE_MS = 6 * 60_000;
const PLAN_DRAFTING_STATUSES = new Set(["planning", "retry_drafting", "plan_drafting"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function planFailureMessage(response) {
  const failure = response?.planFailure || null;
  const provider = failure?.details?.provider || null;
  return provider?.detail
    || provider?.message
    || failure?.message
    || "The backend could not draft this reviewable plan. Try again after checking the model provider and confirmed data.";
}

function planDraftIsStale(thread) {
  const updatedAt = Date.parse(thread?.updatedAt || "");
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > PLAN_DRAFT_STALE_MS;
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

function ChoiceButtons({ options, onChoose, disabled = false }) {
  return (
    <div className="project-onboarding-choices">
      {options.map((option) => (
        <button type="button" key={option.value} onClick={() => onChoose(option)} disabled={disabled}>
          <strong>{option.label}</strong>
          {option.detail && <span>{option.detail}</span>}
        </button>
      ))}
    </div>
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
  onRecoverExperimentPlan,
  onAcceptAnalysisResult,
  onRequestCorrection,
  onComplete,
  onExit,
  loadAnalysisThread = getAnalysisThread,
  AnalysisReviewComponent = AnalysisReviewWorkspace,
}) {
  const [state, setState] = useState(() => ({
    ...INITIAL_PROJECT_ONBOARDING,
    ...(readProjectOnboarding(projectId) || {}),
  }));
  const [input, setInput] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [analysisFlow, setAnalysisFlow] = useState({ loading: false, error: "", thread: null, revision: null });
  const [analysisHydrationAttempt, setAnalysisHydrationAttempt] = useState(0);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [planGenerationElapsed, setPlanGenerationElapsed] = useState(0);
  const [planRecoveryChecking, setPlanRecoveryChecking] = useState(
    () => ["plan_generating", "plan_review"].includes(state.step)
      && !state.analysisThreadId
      && Boolean(onRecoverExperimentPlan),
  );
  const fileInputRef = useRef(null);
  const messagesRef = useRef(null);
  const latestContentRef = useRef(null);
  const hydratedSessionRef = useRef("");
  const assistantResponseTimerRef = useRef(null);
  const planAbortControllerRef = useRef(null);
  const planAbortReasonRef = useRef("");
  const planRecoveryAttemptedRef = useRef(false);
  const analysisHydrationTimerRef = useRef(null);
  const publishedCount = asArray(projectState?.experimentSnapshotHeads).length;
  const activeRegions = asArray(reviewRegions.length ? reviewRegions : projectState?.workbookReviewRegions)
    .filter((region) => !region?.disposition || region.disposition === "active");
  const acceptedRegionCount = activeRegions
    .filter((region) => Boolean(region.acceptedRevisionId)).length;
  const reviewContentKey = activeRegions.map((region) => [
    region.id,
    region.reviewStatus,
    region.currentRevisionId,
    region.acceptedRevisionId,
  ].join(":"))
    .join("|");
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

  const respondAfterThinking = useCallback((answer, callback) => {
    if (assistantResponseTimerRef.current) return;
    setPendingAnswer(answer || null);
    setAssistantThinking(true);
    assistantResponseTimerRef.current = globalThis.setTimeout(() => {
      assistantResponseTimerRef.current = null;
      callback();
      setPendingAnswer(null);
      setAssistantThinking(false);
    }, ASSISTANT_RESPONSE_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (assistantResponseTimerRef.current) {
      globalThis.clearTimeout(assistantResponseTimerRef.current);
    }
    planAbortReasonRef.current = "unmounted";
    planAbortControllerRef.current?.abort();
    if (analysisHydrationTimerRef.current) {
      globalThis.clearTimeout(analysisHydrationTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (state.step !== "plan_generating" || !analysisFlow.loading) {
      setPlanGenerationElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const updateElapsed = () => setPlanGenerationElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const interval = globalThis.setInterval(updateElapsed, 1000);
    return () => globalThis.clearInterval(interval);
  }, [analysisFlow.loading, state.step]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const messages = messagesRef.current;
      if (messages?.scrollTo) {
        messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
      }
      latestContentRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [
    state,
    pendingAnswer,
    assistantThinking,
    planRecoveryChecking,
    acceptedRegionCount,
    activeRegionId,
    reviewContentKey,
    analysisFlow.loading,
    analysisFlow.error,
    analysisFlow.thread?.id,
    analysisFlow.revision?.id,
  ]);

  useEffect(() => {
    if (!readProjectOnboarding(projectId)) {
      writeProjectOnboarding(projectId, state);
    }
  }, [projectId]);

  useEffect(() => {
    if (!state.analysisThreadId) return undefined;
    if (
      analysisFlow.thread?.id === state.analysisThreadId
      && analysisFlow.revision?.id
      && analysisFlow.revision?.id === state.analysisPlanRevisionId
    ) return undefined;
    if (
      analysisFlow.thread?.id === state.analysisThreadId
      && analysisFlow.thread?.status === "plan_failed"
      && analysisFlow.error
    ) return undefined;
    let cancelled = false;
    if (analysisHydrationTimerRef.current) {
      globalThis.clearTimeout(analysisHydrationTimerRef.current);
      analysisHydrationTimerRef.current = null;
    }
    setAnalysisFlow((current) => ({ ...current, loading: true, error: "" }));
    loadAnalysisThread(state.analysisThreadId)
      .then((response) => {
        if (cancelled) return;
        const revisions = asArray(response?.planRevisions);
        const revision = revisions.find((item) => item.id === state.analysisPlanRevisionId)
          || revisions.findLast((item) => ["awaiting_review", "accepted"].includes(item.status))
          || revisions.at(-1)
          || null;
        const thread = response?.analysisThread || null;
        if (!thread?.id) {
          throw new Error("The saved analysis thread did not include a reviewable plan.");
        }
        if (!revision?.id && PLAN_DRAFTING_STATUSES.has(thread.status) && !planDraftIsStale(thread)) {
          setAnalysisFlow({ loading: true, error: "", thread, revision: null });
          analysisHydrationTimerRef.current = globalThis.setTimeout(() => {
            analysisHydrationTimerRef.current = null;
            setAnalysisHydrationAttempt((value) => value + 1);
          }, PLAN_HYDRATION_POLL_MS);
          return;
        }
        if (!revision?.id && PLAN_DRAFTING_STATUSES.has(thread.status)) {
          setAnalysisFlow({
            loading: false,
            error: "The saved server draft became stale before producing a plan. Your confirmed regions are safe; start a new attempt.",
            thread,
            revision: null,
          });
          updateState({ step: "region_review", analysisThreadId: "", analysisPlanRevisionId: "" });
          return;
        }
        if (!revision?.id && thread.status === "plan_failed") {
          setAnalysisFlow({
            loading: false,
            error: planFailureMessage(response),
            thread,
            revision: null,
          });
          updateState({ step: "region_review", analysisThreadId: "", analysisPlanRevisionId: "" });
          return;
        }
        if (!revision?.id) {
          throw new Error("The saved analysis thread did not include a reviewable plan.");
        }
        setAnalysisFlow({
          loading: false,
          error: "",
          thread,
          revision,
        });
        updateState({
          step: "plan_review",
          analysisPlanRevisionId: revision.id,
          generationStatus: "idle",
        });
      })
      .catch((error) => {
        if (!cancelled) setAnalysisFlow({ loading: false, error: error?.message || String(error), thread: null, revision: null });
      });
    return () => {
      cancelled = true;
      if (analysisHydrationTimerRef.current) {
        globalThis.clearTimeout(analysisHydrationTimerRef.current);
        analysisHydrationTimerRef.current = null;
      }
    };
  }, [
    analysisFlow.revision?.id,
    analysisFlow.thread?.id,
    analysisHydrationAttempt,
    loadAnalysisThread,
    state.analysisPlanRevisionId,
    state.analysisThreadId,
    updateState,
  ]);

  useEffect(() => {
    if (
      !["plan_generating", "plan_review"].includes(state.step)
      || state.analysisThreadId
      || analysisFlow.loading
      || !onRecoverExperimentPlan
      || planRecoveryAttemptedRef.current
    ) return undefined;
    planRecoveryAttemptedRef.current = true;
    let cancelled = false;
    setPlanRecoveryChecking(true);
    Promise.resolve(onRecoverExperimentPlan())
      .then((response) => {
        if (cancelled) return;
        const thread = response?.analysisThread || null;
        const revision = response?.currentPlanRevision
          || asArray(response?.planRevisions).findLast((item) => ["awaiting_review", "accepted"].includes(item.status))
          || null;
        if (thread?.id && !revision?.id && PLAN_DRAFTING_STATUSES.has(thread.status)) {
          setPlanRecoveryChecking(false);
          setAnalysisFlow({ loading: true, error: "", thread, revision: null });
          updateState({
            step: "plan_generating",
            analysisThreadId: thread.id,
            analysisPlanRevisionId: "",
          });
          setAnalysisHydrationAttempt((value) => value + 1);
          return;
        }
        if (thread?.id && !revision?.id && thread.status === "plan_failed") {
          setPlanRecoveryChecking(false);
          setAnalysisFlow({
            loading: false,
            error: planFailureMessage(response),
            thread,
            revision: null,
          });
          updateState({ step: "region_review", analysisThreadId: "", analysisPlanRevisionId: "" });
          return;
        }
        if (!thread?.id || !revision?.id) {
          setPlanRecoveryChecking(false);
          setAnalysisFlow((current) => ({
            ...current,
            loading: false,
            error: state.step === "plan_review"
              ? "The server did not return the saved reviewable plan."
              : current.error,
          }));
          return;
        }
        setAnalysisFlow({ loading: false, error: "", thread, revision });
        setPlanRecoveryChecking(false);
        updateState({
          step: "plan_review",
          analysisThreadId: thread.id,
          analysisPlanRevisionId: revision.id,
          generationStatus: "idle",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPlanRecoveryChecking(false);
        setAnalysisFlow((current) => ({
          ...current,
          error: `LabRat could not check for the completed plan: ${error?.message || String(error)}`,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    analysisFlow.loading,
    analysisHydrationAttempt,
    onRecoverExperimentPlan,
    state.analysisThreadId,
    state.step,
    updateState,
  ]);

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

  const selectProjectStage = (option) => {
    respondAfterThinking(
      { kind: "project_stage", text: option.label },
      () => updateState({ projectStage: option.value, step: "master_table" }),
    );
  };

  const selectMasterTableStatus = (option) => {
    respondAfterThinking(
      { kind: "master_table", text: option.label },
      () => updateState({ masterTableStatus: option.value, step: "upload" }),
    );
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
    if (!answer || assistantThinking) return;
    setInput("");
    if (state.step === "workflow") {
      respondAfterThinking(
        { kind: "workflow", text: answer },
        () => updateState({ experimentalWorkflow: answer, step: "analysis" }),
      );
      return;
    }
    if (state.step === "analysis") {
      respondAfterThinking(
        { kind: "analysis", text: answer },
        () => updateState((current) => ({
          dataAnalysisProcess: answer,
          step: ["ready", "error"].includes(current.generationStatus) ? "result_review" : "waiting_result",
        })),
      );
      return;
    }
    if (state.step === "correction") {
      respondAfterThinking(
        { kind: "correction", text: answer },
        () => {
          updateState({ correction: answer });
          onRequestCorrection?.(answer);
        },
      );
    }
  };

  const createExperimentPlan = async () => {
    if (analysisFlow.loading || !onCreateExperimentPlan) return;
    const controller = new AbortController();
    planAbortControllerRef.current = controller;
    planAbortReasonRef.current = "";
    setAnalysisFlow({ loading: true, error: "", thread: null, revision: null });
    updateState({ step: "plan_generating" });
    const timeout = globalThis.setTimeout(() => {
      planAbortReasonRef.current = "timeout";
      controller.abort();
    }, PLAN_GENERATION_TIMEOUT_MS);
    try {
      if (onRecoverExperimentPlan) {
        const recovered = await onRecoverExperimentPlan();
        const recoveredThread = recovered?.analysisThread || null;
        const recoveredRevision = recovered?.currentPlanRevision
          || asArray(recovered?.planRevisions).findLast((item) => ["awaiting_review", "accepted"].includes(item.status))
          || null;
        if (recoveredThread?.id && !recoveredRevision?.id && PLAN_DRAFTING_STATUSES.has(recoveredThread.status)) {
          setAnalysisFlow({ loading: true, error: "", thread: recoveredThread, revision: null });
          updateState({
            step: "plan_generating",
            analysisThreadId: recoveredThread.id,
            analysisPlanRevisionId: "",
          });
          setAnalysisHydrationAttempt((value) => value + 1);
          return;
        }
        if (recoveredThread?.id && recoveredRevision?.id) {
          setAnalysisFlow({ loading: false, error: "", thread: recoveredThread, revision: recoveredRevision });
          updateState({
            step: "plan_review",
            analysisThreadId: recoveredThread.id,
            analysisPlanRevisionId: recoveredRevision.id,
            generationStatus: "idle",
          });
          return;
        }
      }
      const response = await onCreateExperimentPlan({ signal: controller.signal });
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
      const abortReason = planAbortReasonRef.current;
      if (!abortReason && onRecoverExperimentPlan) {
        try {
          const recovered = await onRecoverExperimentPlan();
          const recoveredThread = recovered?.analysisThread || null;
          const recoveredRevision = recovered?.currentPlanRevision
            || asArray(recovered?.planRevisions).findLast((item) => ["awaiting_review", "accepted"].includes(item.status))
            || null;
          if (recoveredThread?.id && !recoveredRevision?.id && PLAN_DRAFTING_STATUSES.has(recoveredThread.status)) {
            setAnalysisFlow({ loading: true, error: "", thread: recoveredThread, revision: null });
            updateState({
              step: "plan_generating",
              analysisThreadId: recoveredThread.id,
              analysisPlanRevisionId: "",
            });
            setAnalysisHydrationAttempt((value) => value + 1);
            return;
          }
          if (recoveredThread?.id && recoveredRevision?.id) {
            setAnalysisFlow({ loading: false, error: "", thread: recoveredThread, revision: recoveredRevision });
            updateState({
              step: "plan_review",
              analysisThreadId: recoveredThread.id,
              analysisPlanRevisionId: recoveredRevision.id,
              generationStatus: "idle",
            });
            return;
          }
        } catch {
          // Preserve the original plan-generation error when recovery also fails.
        }
      }
      const message = abortReason === "timeout"
        ? "This page stopped waiting after two minutes. The server may still finish the plan; your confirmed regions are safe, and retry will check the server first."
        : abortReason === "cancelled"
          ? "This page stopped waiting. The server may still finish the plan; retry will reopen it instead of starting a duplicate."
          : error?.message || String(error);
      setAnalysisFlow({ loading: false, error: message, thread: null, revision: null });
      updateState({ step: "region_review" });
    } finally {
      globalThis.clearTimeout(timeout);
      if (planAbortControllerRef.current === controller) {
        planAbortControllerRef.current = null;
        planAbortReasonRef.current = "";
      }
    }
  };

  const cancelExperimentPlan = () => {
    if (planAbortControllerRef.current) {
      planAbortReasonRef.current = "cancelled";
      planAbortControllerRef.current.abort();
      return;
    }
    setAnalysisFlow((current) => ({
      ...current,
      loading: false,
      error: "This page stopped waiting. The server may still finish the plan; retry will reopen it instead of starting a duplicate.",
    }));
    updateState({ step: "region_review", analysisThreadId: "", analysisPlanRevisionId: "" });
  };

  const retryPlanReviewHydration = () => {
    setAnalysisFlow((current) => ({ ...current, loading: false, error: "", thread: null, revision: null }));
    if (state.analysisThreadId) {
      setAnalysisHydrationAttempt((value) => value + 1);
      return;
    }
    planRecoveryAttemptedRef.current = false;
    setPlanRecoveryChecking(true);
    setAnalysisHydrationAttempt((value) => value + 1);
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

  const completeOnboarding = (destination = "overview") => {
    const next = { ...state, status: "completed", step: "complete" };
    writeProjectOnboarding(projectId, next);
    setState(next);
    onComplete?.(destination);
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
  const planGenerationWorking = state.step === "plan_generating" && analysisFlow.loading;
  const planGenerationStatusVisible = planGenerationWorking || planRecoveryChecking;
  const planReviewMissing = state.step === "plan_review"
    && (!analysisFlow.thread?.id || !analysisFlow.revision?.id);
  const reviewSurfaceVisible = ["plan_review", "result_review"].includes(state.step)
    && Boolean(analysisFlow.thread?.id && analysisFlow.revision?.id);

  return (
    <main className={`project-onboarding-page${reviewSurfaceVisible ? " has-review-surface" : ""}`}>
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

        {(planGenerationStatusVisible || ["working", "ready", "error"].includes(state.generationStatus)) && (
          <div className={`project-onboarding-generation-status is-${planGenerationStatusVisible ? "working" : state.generationStatus}`} role="status" aria-live="polite">
            {(planGenerationStatusVisible || state.generationStatus === "working") && <span className="project-onboarding-status-spinner" aria-hidden="true" />}
            {state.generationStatus === "ready" && <span aria-hidden="true">✓</span>}
            {!planGenerationStatusVisible && state.generationStatus === "error" && <span aria-hidden="true">!</span>}
            <strong>
              {planRecoveryChecking
                ? "Checking for your review plan…"
                : planGenerationWorking
                ? `Preparing review plan · ${planGenerationElapsed}s`
                : state.generationStatus === "working"
                ? "Generating your Experiment Browser preview…"
                : state.generationStatus === "ready"
                  ? "Preview ready"
                  : "Generation failed"}
            </strong>
          </div>
        )}

        <div className="project-onboarding-messages" ref={messagesRef}>
          <OnboardingMessage>
            <p>Hi, I’m LabRat, your AI research assistant.</p>
            <p>I can help you manage experimental data, create visualizations, and prepare research outputs. First, help me understand your project.</p>
          </OnboardingMessage>

          {state.step === "welcome" && (
            <button type="button" className="project-onboarding-primary" disabled={assistantThinking} onClick={() => {
              respondAfterThinking(null, () => updateState({ step: "project_stage" }));
            }}>
              Let’s get started
            </button>
          )}

          {state.step !== "welcome" && (
            <OnboardingMessage>
              <p>What stage is your project currently in?</p>
              {state.step === "project_stage" && (
                <ChoiceButtons options={PROJECT_STAGE_OPTIONS} onChoose={selectProjectStage} disabled={assistantThinking} />
              )}
            </OnboardingMessage>
          )}

          {pendingAnswer?.kind === "project_stage" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
          )}

          {state.projectStage && (
            <>
              <OnboardingMessage role="user">
                <p>{PROJECT_STAGE_OPTIONS.find((option) => option.value === state.projectStage)?.label}</p>
              </OnboardingMessage>
              <OnboardingMessage>
                <p>Do you have a master table or another workbook that compiles your experimental data?</p>
                {state.step === "master_table" && (
                  <ChoiceButtons options={MASTER_TABLE_OPTIONS} onChoose={selectMasterTableStatus} disabled={assistantThinking} />
                )}
              </OnboardingMessage>
            </>
          )}

          {pendingAnswer?.kind === "master_table" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
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
              {analysisFlow.error && (
                <div className="project-onboarding-error" role="alert">
                  <p>{analysisFlow.error}</p>
                  <button type="button" className="project-onboarding-secondary" onClick={createExperimentPlan}>
                    Try generating the plan again
                  </button>
                </div>
              )}
            </div>
          )}

          {state.step === "plan_generating" && analysisFlow.loading && (
            <OnboardingMessage>
              <p>I’m using the confirmed workbook evidence to prepare an Experiment Browser plan.</p>
              <div className="project-onboarding-processing"><span /> Generating a reviewable plan…</div>
              <div className="project-onboarding-plan-status" role="status" aria-live="polite">
                <small>{planGenerationElapsed}s elapsed</small>
                <button type="button" className="project-onboarding-secondary" onClick={cancelExperimentPlan}>Stop waiting</button>
              </div>
            </OnboardingMessage>
          )}

          {state.step === "plan_generating" && planRecoveryChecking && (
            <OnboardingMessage>
              <p>I’m checking whether the server finished your reviewable plan before this page was interrupted.</p>
              <div className="project-onboarding-processing"><span /> Checking for the completed plan…</div>
            </OnboardingMessage>
          )}

          {state.step === "plan_generating" && !analysisFlow.loading && !planRecoveryChecking && !analysisFlow.thread && (
            <OnboardingMessage>
              <p><strong>Plan generation was interrupted.</strong></p>
              <p>Your workbook and confirmed regions are safe. LabRat will check the server before starting another plan.</p>
              <button type="button" className="project-onboarding-primary" onClick={createExperimentPlan}>
                Try generating the plan again
              </button>
            </OnboardingMessage>
          )}

          {state.analysisThreadId && analysisFlow.error && !["region_review", "plan_review"].includes(state.step) && (
            <div className="project-onboarding-error" role="alert">
              <p>{analysisFlow.error}</p>
              <button type="button" className="project-onboarding-secondary" onClick={() => {
                setAnalysisFlow({ loading: false, error: "", thread: null, revision: null });
                setAnalysisHydrationAttempt((value) => value + 1);
              }}>Retry loading the plan</button>
            </div>
          )}

          {planReviewMissing && (
            <div className="project-onboarding-analysis">
              <section className="project-onboarding-plan-recovery" aria-live="polite">
                {analysisFlow.error ? (
                  <>
                    <strong>LabRat could not reopen the saved review plan.</strong>
                    <p>{analysisFlow.error}</p>
                    <button type="button" className="project-onboarding-secondary" onClick={retryPlanReviewHydration}>
                      Retry loading the plan
                    </button>
                  </>
                ) : (
                  <>
                    <div className="project-onboarding-processing"><span /> Restoring your review plan…</div>
                    <p>Your generated plan is saved. LabRat is loading the review controls before anything can run.</p>
                  </>
                )}
              </section>
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
              <p>Plan accepted. I’m now creating your Experiment Browser preview, and it may take a little while.</p>
              <p>While I work, tell me more about your project. What does a typical experimental workflow look like—from preparing materials and setting up the reactor through reaction time, sampling, and data collection? Include details such as the reactor type, operating conditions, reaction duration, and your usual experimental routine.</p>
              <p>The more detail you share about your experimental procedure, the more helpful LabRat can become in the future—for example, when diagnosing unusual data or checking calculations.</p>
            </OnboardingMessage>
          )}

          {pendingAnswer?.kind === "workflow" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
          )}

          {state.experimentalWorkflow && (
            <>
              <OnboardingMessage role="user"><p>{state.experimentalWorkflow}</p></OnboardingMessage>
              <OnboardingMessage>
                <p>Got it. Now tell me about your data-analysis process. How do you turn raw measurements into the final values you use?</p>
                <p>Include details such as the software or spreadsheets you use, calculations, data cleaning or exclusions, unit conversions, quality checks, and how you prepare plots or summary tables.</p>
                <p>This context does not change the current import yet, but it will help future LabRat versions diagnose data problems, verify calculations, and suggest more useful analyses.</p>
              </OnboardingMessage>
            </>
          )}

          {pendingAnswer?.kind === "analysis" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
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
              <p>
                Your {publishedCount} {publishedCount === 1 ? "experiment has" : "experiments have"} been published to the Experiment Browser.
              </p>
              <p>Now you can:</p>
              <ChoiceButtons
                options={[
                  {
                    value: "browser",
                    label: "Open Experiment Browser",
                    detail: "View and explore the records you just published.",
                  },
                  {
                    value: "correction",
                    label: "Request a correction",
                    detail: "Describe a reviewed change without silently altering accepted data.",
                  },
                  {
                    value: "overview",
                    label: "Finish onboarding",
                    detail: "Return to the project overview.",
                  },
                ]}
                onChoose={(option) => {
                  if (option.value === "correction") {
                    updateState({ step: "correction" });
                    return;
                  }
                  completeOnboarding(option.value);
                }}
              />
            </OnboardingMessage>
          )}

          {state.step === "correction" && (
            <OnboardingMessage>
              <p>Describe what looks wrong and what should be corrected. I’ll prepare that as a reviewed change instead of silently changing your accepted data.</p>
            </OnboardingMessage>
          )}

          {pendingAnswer?.kind === "correction" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
          )}

          {assistantThinking && (
            <OnboardingMessage>
              <div className="project-onboarding-thinking" role="status" aria-label="LabRat is thinking">
                <span />
                <span />
                <span />
              </div>
            </OnboardingMessage>
          )}
          <div className="project-onboarding-scroll-anchor" ref={latestContentRef} aria-hidden="true" />
        </div>

        {showComposer && !assistantThinking && (
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
