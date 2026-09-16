import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";
import { WorkbookReviewDock } from "./WorkbookReviewDock.jsx";
import { WorkbookBatchCard, templateMatchDetail } from "./WorkbookBatchCard.jsx";
import { useWorkbookBatchActions } from "../hooks/useWorkbookBatch.js";
import { createWorkbookBatchItems, summarizeWorkbookBatch } from "../data/workbookBatchUpload.js";
import { uid } from "../utils/format";
import { getAnalysisThread } from "../data/analysisApi.js";
import {
  INITIAL_PROJECT_ONBOARDING,
  ONBOARDING_CONTEXT_QUESTIONS,
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

const PROGRESS_BY_STEP = {
  welcome: 8,
  project_stage: 18,
  master_table: 30,
  upload: 42,
  region_review: 54,
  plan_generating: 64,
  plan_review: 72,
  context: 80,
  waiting_result: 86,
  result_review: 90,
  more_workbooks: 92,
  batch_pick: 93,
  batch_upload: 93,
  batch_template_choice: 94,
  batch_teach: 94,
  batch_apply: 95,
  batch_leftovers: 95,
  batch_repeat: 96,
  preview: 97,
  correction: 98,
  complete: 100,
};

const BATCH_STEPS = new Set(["batch_pick", "batch_upload", "batch_template_choice", "batch_teach", "batch_apply", "batch_leftovers", "batch_repeat"]);
const BATCH_SOFT_NOTICE_FILES = 40;

function isBatchStep(step) {
  return BATCH_STEPS.has(step);
}

function batchUploadedItems(batch) {
  return asArray(batch?.items).filter((item) => item.status === "uploaded" && item.workbookReviewLink?.workbookReviewSessionId);
}

// Files linked through the template plus the teaching file itself, which
// was confirmed by hand before the template existed.
function batchLinkedCount(batch) {
  const viaTemplate = asArray(batch?.apply?.items).filter((row) => row.confirmed).length
    + asArray(batch?.handLinkedDocs).length;
  if (batch?.templateSource === "chosen") {
    // A saved template's own source file, if it is in this batch, was linked
    // when the template was taught.
    const uploadedDocs = new Set(batchUploadedItems(batch).map((item) => item.workbookReviewLink?.sourceDocumentId));
    const sources = asArray(batch?.match?.results).filter((result) => result.isTemplateSource && uploadedDocs.has(result.sourceDocumentId)).length;
    return viaTemplate + sources;
  }
  return viaTemplate + (batch?.teach?.sessionId ? 1 : 0);
}

// Files still needing attention after apply and confirm: uploaded, not the
// teaching file, not confirmed through the batch list, not a template source.
function batchLeftovers(batch) {
  const confirmedDocs = new Set([
    ...asArray(batch?.apply?.items).filter((row) => row.confirmed).map((row) => row.sourceDocumentId),
    ...asArray(batch?.handLinkedDocs),
  ]);
  const resultsByDoc = new Map(asArray(batch?.match?.results).map((result) => [result.sourceDocumentId, result]));
  // With a saved template applied, the first file is an ordinary file too.
  const teachDoc = batch?.templateSource === "chosen" ? "" : (batch?.teach?.sourceDocumentId || "");
  return batchUploadedItems(batch)
    .filter((item) => {
      const docId = item.workbookReviewLink?.sourceDocumentId || "";
      if (!docId || docId === teachDoc || confirmedDocs.has(docId)) return false;
      return !resultsByDoc.get(docId)?.isTemplateSource;
    })
    .map((item) => ({
      item,
      result: resultsByDoc.get(item.workbookReviewLink?.sourceDocumentId) || null,
      row: asArray(batch?.apply?.items).find((row) => row.sourceDocumentId === item.workbookReviewLink?.sourceDocumentId && !row.confirmed) || null,
    }));
}

function batchLinkFor(item) {
  return item?.workbookReviewLink || null;
}

function templateSummaryFrom(response) {
  const template = response?.regionExtractionTemplate || null;
  if (!template?.id) return null;
  return {
    id: template.id,
    name: template.name || "",
    currentVersionId: template.currentVersionId || "",
    currentVersion: template.currentVersion || asArray(response?.versions).length || 1,
    status: template.status || "active",
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function contextQuestionAt(index) {
  return ONBOARDING_CONTEXT_QUESTIONS[index] || null;
}

function isContextChainStart(index) {
  const item = contextQuestionAt(index);
  if (!item) return false;
  return ONBOARDING_CONTEXT_QUESTIONS.findIndex((candidate) => candidate.chain === item.chain) === index;
}

function hasContextAnswer(answers, id) {
  return Object.prototype.hasOwnProperty.call(answers || {}, id);
}

const DEFAULT_PLAN_REQUEST = "Use the confirmed master table to build reviewed Experiment Browser records.";

function planRequestForWorkbook(fileName) {
  return `Use the confirmed regions in ${fileName} to build reviewed Experiment Browser records.`;
}

// Rounds: each master table upload is one round. Completed rounds are kept
// in workbookRounds; the current round descriptor is set at upload time.
function roundNumberOf(current) {
  return current?.round?.number || asArray(current?.workbookRounds).length + 1;
}

function planRequestOf(current) {
  if (current?.round?.planRequest) return current.round.planRequest;
  return current?.workbookFileName ? planRequestForWorkbook(current.workbookFileName) : DEFAULT_PLAN_REQUEST;
}

const ROUND_RESET_FIELDS = {
  round: null,
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
  contextIndexAtPlanReview: null,
};

// Context questions are asked in the first round only.
function contextQuestionsRemain(current) {
  return roundNumberOf(current) === 1 && current.contextIndex < ONBOARDING_CONTEXT_QUESTIONS.length;
}

// A drafted plan opens plan review immediately unless the user is in the
// middle of a context question during drafting; then the step stays at
// plan_generating with the plan held until that answer or skip.
function planArrivalPatch(current, threadId, revisionId, { hold = true } = {}) {
  const questionOpen = hold && current.step === "plan_generating" && contextQuestionsRemain(current);
  return {
    step: questionOpen ? "plan_generating" : "plan_review",
    analysisThreadId: threadId,
    analysisPlanRevisionId: revisionId,
    generationStatus: "idle",
    ...(questionOpen ? {} : {
      contextIndexAtPlanReview: Number.isInteger(current.contextIndexAtPlanReview)
        ? current.contextIndexAtPlanReview
        : current.contextIndex,
    }),
  };
}

// Records one context answer ("" means skipped) and decides where the
// conversation goes next. During drafting: the next question, or plan review
// if the plan is already waiting. After plan acceptance: the next question,
// the waiting state once every question is done, or straight to the result
// review when the preview finished while the user was answering.
function contextAnswerPatch(current, answerText, { skipChain = false, planReady = false } = {}) {
  const item = contextQuestionAt(current.contextIndex);
  if (!item) return {};
  const contextAnswers = { ...(current.contextAnswers || {}), [item.id]: answerText };
  let contextIndex = current.contextIndex + 1;
  if (skipChain) {
    while (contextIndex < ONBOARDING_CONTEXT_QUESTIONS.length && ONBOARDING_CONTEXT_QUESTIONS[contextIndex].chain === item.chain) {
      contextIndex += 1;
    }
  }
  if (current.step === "plan_generating") {
    if (planReady) return { contextAnswers, contextIndex, step: "plan_review", contextIndexAtPlanReview: contextIndex };
    return { contextAnswers, contextIndex };
  }
  if (["ready", "error"].includes(current.generationStatus)) {
    return { contextAnswers, contextIndex, step: "result_review" };
  }
  if (contextIndex >= ONBOARDING_CONTEXT_QUESTIONS.length) {
    return { contextAnswers, contextIndex, step: "waiting_result" };
  }
  return { contextAnswers, contextIndex };
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

function ContextQuestionTurn({ item, index, answers, isCurrent, pendingAnswer, hint }) {
  const answered = hasContextAnswer(answers, item.id);
  if (!answered && !isCurrent) return null;
  const previous = index > 0 ? ONBOARDING_CONTEXT_QUESTIONS[index - 1] : null;
  const acknowledge = previous && (answers?.[previous.id] || "").trim() ? "Got it. " : "";
  const pending = pendingAnswer?.kind === "context" && pendingAnswer.questionId === item.id;
  return (
    <>
      <OnboardingMessage>
        <p>{acknowledge}{item.question}</p>
        {isCurrent && !pending && hint && <p className="project-onboarding-hint">{hint}</p>}
      </OnboardingMessage>
      {pending && (
        <OnboardingMessage role="user"><p>{pendingAnswer.text || "Skipped"}</p></OnboardingMessage>
      )}
      {answered && (
        <OnboardingMessage role="user"><p>{answers[item.id] || "Skipped"}</p></OnboardingMessage>
      )}
    </>
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
  onUploadBatchFile,
  onRefreshProject,
  renderWorkbookGrid,
  onSaveExtractionTemplate,
  onUpdateExtractionTemplate,
  onLinkRegion,
  extractionTemplates = [],
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
  const batchInputRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const messagesRef = useRef(null);
  const latestContentRef = useRef(null);
  const hydratedSessionRef = useRef("");
  const assistantResponseTimerRef = useRef(null);
  const planAbortControllerRef = useRef(null);
  const planAbortReasonRef = useRef("");
  const planRecoveryAttemptedRef = useRef(false);
  const analysisHydrationTimerRef = useRef(null);
  const analysisFlowRef = useRef(analysisFlow);
  analysisFlowRef.current = analysisFlow;
  const explicitPublishedCount = Number(projectState?.publishedExperimentCount);
  const publishedCount = Number.isInteger(explicitPublishedCount) && explicitPublishedCount >= 0
    ? explicitPublishedCount
    : asArray(projectState?.experimentSnapshotHeads).length;
  const currentSession = useMemo(() => {
    const activeSessions = asArray(projectState?.workbookReviewSessions)
      .filter((session) => session?.status !== "deleted");
    return activeSessions.find((session) => session.id === state.workbookReviewSessionId)
      || activeSessions[activeSessions.length - 1]
      || null;
  }, [projectState?.workbookReviewSessions, state.workbookReviewSessionId]);
  // Only the current round's workbook is under review; regions from earlier
  // rounds stay confirmed on the server but must not reappear in the dock.
  const belongsToCurrentSession = (region) => !currentSession?.id
    || !region?.workbookReviewSessionId
    || region.workbookReviewSessionId === currentSession.id;
  const draftRegions = asArray(reviewRegions).filter(belongsToCurrentSession);
  const activeRegions = (draftRegions.length ? draftRegions : asArray(projectState?.workbookReviewRegions).filter(belongsToCurrentSession))
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
  const planRequest = planRequestOf(state);
  const roundNumber = roundNumberOf(state);
  const completedRounds = asArray(state.workbookRounds);
  const roundPublishedCount = Math.max(0, publishedCount - (state.publishedCountAtRoundStart || 0));

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

  const batchActions = useWorkbookBatchActions({
    projectId,
    uploadFile: onUploadBatchFile,
    reloadProject: onRefreshProject,
    onBatchUpdate: (batchId, updater) => updateState((current) => (
      current.batch?.batchId === batchId ? { batch: updater(current.batch) } : {}
    )),
  });

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
            error: "The saved server draft became stale before producing a plan. Your confirmed interpretations are safe; start a new attempt.",
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
        updateState((current) => planArrivalPatch(current, current.analysisThreadId, revision.id));
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
    Promise.resolve(onRecoverExperimentPlan({ request: planRequest }))
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
        updateState((current) => planArrivalPatch(current, thread.id, revision.id, { hold: false }));
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
    planRequest,
    state.analysisThreadId,
    state.step,
    updateState,
  ]);

  useEffect(() => {
    if (isBatchStep(state.step)) return;
    if (!currentSession?.id || reviewState?.session?.id === currentSession.id) return;
    if (hydratedSessionRef.current === currentSession.id || !onHydrateWorkbookReview) return;
    hydratedSessionRef.current = currentSession.id;
    Promise.resolve(onHydrateWorkbookReview(currentSession)).catch(() => {
      hydratedSessionRef.current = "";
    });
  }, [currentSession, onHydrateWorkbookReview, reviewState?.session?.id, state.step]);

  // In the per-experiment path the grid shows whichever batch file is open.
  const batchOpenSessionId = isBatchStep(state.step)
    ? (state.batch?.openSessionId || (state.step === "batch_teach" ? state.batch?.teach?.sessionId : "") || "")
    : "";
  useEffect(() => {
    if (!batchOpenSessionId || !onHydrateWorkbookReview) return;
    if (reviewState?.session?.id === batchOpenSessionId || hydratedSessionRef.current === batchOpenSessionId) return;
    hydratedSessionRef.current = batchOpenSessionId;
    Promise.resolve(onHydrateWorkbookReview({ id: batchOpenSessionId })).catch(() => {
      hydratedSessionRef.current = "";
    });
  }, [batchOpenSessionId, onHydrateWorkbookReview, reviewState?.session?.id]);

  // Publication of this round's experiments ends the round. Earlier rounds'
  // experiments are excluded through the count recorded at round start.
  useEffect(() => {
    if (roundPublishedCount <= 0) return;
    if (["complete", "more_workbooks", "preview", "correction"].includes(state.step) || isBatchStep(state.step)) return;
    updateState({ step: "more_workbooks", workbookStatus: "published", generationStatus: "idle", generationError: "" });
  }, [roundPublishedCount, state.step]);

  const planHeldFor = (flow) => Boolean(flow?.thread?.id && flow?.revision?.id) && !flow?.loading;
  const planReadyPending = state.step === "plan_generating" && planHeldFor(analysisFlow);
  const draftingWindowOpen = state.step === "plan_generating" && (analysisFlow.loading || planReadyPending);
  const contextQuestionOpen = contextQuestionsRemain(state)
    && (state.step === "context" || draftingWindowOpen);
  // Questions answered before plan review render above the plan surface;
  // the rest render below it. Sessions that never recorded the split (older
  // saved state) show everything in the post-acceptance block.
  const contextSplitIndex = Number.isInteger(state.contextIndexAtPlanReview)
    ? state.contextIndexAtPlanReview
    : ["context", "waiting_result", "result_review", "preview", "correction", "complete"].includes(state.step)
      ? 0
      : Number.POSITIVE_INFINITY;
  const completedBatchRounds = asArray(state.batchRounds);
  const savedTemplates = asArray(extractionTemplates)
    .filter((template) => template?.status !== "archived" && template?.currentVersionId);
  const batchVisible = Boolean(state.batch) && isBatchStep(state.step) && state.step !== "batch_pick";
  const batchItems = asArray(state.batch?.items);
  const batchSummary = summarizeWorkbookBatch(batchItems);
  const batchRunning = batchSummary.pending > 0 || batchSummary.uploading > 0;
  const batchNameMatches = batchUploadedItems(state.batch).filter((item) => item.suggestedExperiment?.status === "matched").length;
  const batchNameUnresolved = Math.max(0, batchSummary.uploaded - batchNameMatches);
  const batchMatchResults = asArray(state.batch?.match?.results);
  const batchEligibleMatches = batchMatchResults.filter((result) => result.eligibleForBatchConfirm && !result.isTemplateSource).length;
  // Typed-over files can be prefilled for individual confirmation; anything
  // else without a one-click match has a different layout.
  const batchPrefillableResults = batchMatchResults.filter((result) => result.status === "formula_mismatch" && result.matchedRange && !result.isTemplateSource);
  const batchAppliedDocs = new Set(asArray(state.batch?.apply?.items).map((row) => row.sourceDocumentId));
  const batchPrefillPending = batchPrefillableResults.filter((result) => !batchAppliedDocs.has(result.sourceDocumentId));
  const batchTypedOverMatches = batchMatchResults.filter((result) => result.eligibleForBatchConfirm && !result.isTemplateSource && asArray(result.typedOverCells).length).length;
  const batchUnmatched = batchMatchResults.filter((result) => (
    !result.eligibleForBatchConfirm && !result.isTemplateSource && !(result.status === "formula_mismatch" && result.matchedRange)
  )).length;
  const batchTeachLink = state.batch?.teach?.sessionId
    ? { workbookReviewSessionId: state.batch.teach.sessionId, sourceDocumentId: state.batch.teach.sourceDocumentId, workbookName: state.batch.teach.fileName }
    : null;
  const batchOpenFileName = state.batch?.openFileName
    || batchUploadedItems(state.batch).find((item) => item.workbookReviewLink?.workbookReviewSessionId === state.batch?.openSessionId)?.fileName
    || "this file";
  const batchLeftoverEntries = batchLeftovers(state.batch);
  const contextRoundActive = roundNumber === 1;
  const contextQuestionsAfterPlan = contextRoundActive
    && Number.isFinite(contextSplitIndex)
    && ONBOARDING_CONTEXT_QUESTIONS.length > contextSplitIndex;

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
    updateState((current) => ({
      step: "region_review",
      workbookStatus: "processing",
      workbookFileName: file.name,
      round: { number: roundNumberOf(current), planRequest: planRequestForWorkbook(file.name) },
      publishedCountAtRoundStart: publishedCount,
    }));
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
    if (contextQuestionOpen) {
      const questionId = contextQuestionAt(state.contextIndex)?.id || "";
      respondAfterThinking(
        { kind: "context", questionId, text: answer },
        () => updateState((current) => contextAnswerPatch(current, answer, { planReady: planHeldFor(analysisFlowRef.current) })),
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

  const skipContextQuestion = () => {
    if (!contextQuestionOpen || assistantThinking) return;
    const questionId = contextQuestionAt(state.contextIndex)?.id || "";
    const skipChain = isContextChainStart(state.contextIndex);
    setInput("");
    respondAfterThinking(
      { kind: "context", questionId, text: "" },
      () => updateState((current) => contextAnswerPatch(current, "", { skipChain, planReady: planHeldFor(analysisFlowRef.current) })),
    );
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
        const recovered = await onRecoverExperimentPlan({ request: planRequest });
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
          updateState((current) => planArrivalPatch(current, recoveredThread.id, recoveredRevision.id));
          return;
        }
      }
      const response = await onCreateExperimentPlan({ signal: controller.signal, request: planRequest });
      const thread = response?.analysisThread || null;
      const revision = response?.currentPlanRevision || response?.analysisPlanRevision || null;
      if (!thread?.id || !revision?.id) {
        throw new Error(response?.reply || "LabRat did not return a reviewable Experiment Browser plan.");
      }
      setAnalysisFlow({ loading: false, error: "", thread, revision });
      updateState((current) => planArrivalPatch(current, thread.id, revision.id));
    } catch (error) {
      const abortReason = planAbortReasonRef.current;
      if (!abortReason && onRecoverExperimentPlan) {
        try {
          const recovered = await onRecoverExperimentPlan({ request: planRequest });
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
            updateState((current) => planArrivalPatch(current, recoveredThread.id, recoveredRevision.id));
            return;
          }
        } catch {
          // Preserve the original plan-generation error when recovery also fails.
        }
      }
      const message = abortReason === "timeout"
        ? "This page stopped waiting after two minutes. The server may still finish the plan; your confirmed interpretations are safe, and retry will check the server first."
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
        if (["plan_review", "plan_generating"].includes(current.step)) {
          patch.step = contextQuestionsRemain(current) ? "context" : "waiting_result";
        }
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

  const advanceBatchToTeach = (items) => {
    const uploaded = asArray(items).filter((item) => item.status === "uploaded" && item.workbookReviewLink?.workbookReviewSessionId);
    if (!uploaded.length) return false;
    const first = uploaded[0];
    const teach = {
      sessionId: first.workbookReviewLink.workbookReviewSessionId,
      sourceDocumentId: first.workbookReviewLink.sourceDocumentId || "",
      fileName: first.workbookReviewLink.workbookName || first.fileName,
    };
    // A saved template can be applied straight away; teaching is only needed
    // when none exists or the user wants a new one.
    const canReuse = savedTemplates.length > 0;
    updateState((current) => ({
      batch: { ...current.batch, teach, openSessionId: canReuse ? "" : teach.sessionId },
      step: canReuse ? "batch_template_choice" : "batch_teach",
    }));
    return true;
  };

  const chooseBatchTemplate = (option) => {
    respondAfterThinking({ kind: "batch_template", text: option.label }, () => {
      if (option.value === "teach_new") {
        updateState((current) => ({
          batch: { ...current.batch, openSessionId: current.batch?.teach?.sessionId || "" },
          step: "batch_teach",
        }));
        return;
      }
      const template = savedTemplates.find((item) => item.id === option.value);
      if (template) rematchBatch(template, { source: "chosen" });
    });
  };

  const startBatchFromFiles = async (files) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const batchId = `onboarding_batch_${uid()}`;
    batchActions.rememberFiles(batchId, list);
    updateState({
      batch: { batchId, items: createWorkbookBatchItems(list), match: null, apply: null, teach: null, template: null, openSessionId: "", error: "" },
      step: "batch_upload",
    });
    try {
      const finalItems = await batchActions.runBatch(batchId, list);
      advanceBatchToTeach(finalItems);
    } catch (error) {
      updateState((current) => ({ batch: { ...current.batch, error: error?.message || String(error) } }));
    }
  };

  const onBatchFilesSelected = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    startBatchFromFiles(files);
  };

  const retryBatchUpload = async () => {
    const finalItems = await batchActions.retryBatch(stateRef.current.batch);
    if (stateRef.current.step === "batch_upload") advanceBatchToTeach(finalItems);
  };

  const openBatchFile = (link) => {
    const sessionId = link?.workbookReviewSessionId || "";
    if (!sessionId) return;
    updateState((current) => ({
      batch: { ...current.batch, openSessionId: sessionId, openFileName: link.workbookName || "" },
    }));
  };

  const rematchBatch = async (template, { source } = {}) => {
    const batch = stateRef.current.batch;
    const chosen = template
      || asArray(extractionTemplates).find((item) => item.id === batch?.template?.id)
      || batch?.template;
    if (!batch || !chosen?.currentVersionId) return;
    updateState((current) => ({
      batch: {
        ...current.batch,
        template: { ...current.batch?.template, ...chosen },
        templateSource: source || current.batch?.templateSource || "saved",
        match: null,
        apply: null,
        openSessionId: "",
      },
      step: "batch_apply",
    }));
    await batchActions.matchTemplate({ ...batch, match: null, apply: null }, chosen);
  };

  const saveBatchTemplate = async (region, options) => {
    const saved = await onSaveExtractionTemplate?.(region, options);
    const template = templateSummaryFrom(saved);
    if (template) await rematchBatch(template, { source: "saved" });
    return saved;
  };

  const updateBatchTemplate = async (region, template) => {
    const saved = await onUpdateExtractionTemplate?.(region, template);
    const updated = templateSummaryFrom(saved);
    if (updated) await rematchBatch(updated, { source: "saved" });
    return saved;
  };

  const goBackToTemplateChoice = () => {
    updateState((current) => ({
      batch: { ...current.batch, openSessionId: "", redrawSessionId: "", linkNotice: null },
      step: savedTemplates.length ? "batch_template_choice" : "batch_teach",
    }));
  };

  const teachNewTemplateFromFile = (link) => {
    const sessionId = link?.workbookReviewSessionId || "";
    if (!sessionId) return;
    updateState((current) => ({
      batch: {
        ...current.batch,
        teach: { sessionId, sourceDocumentId: link.sourceDocumentId || "", fileName: link.workbookName || "" },
        template: null,
        templateSource: "",
        match: null,
        apply: null,
        openSessionId: sessionId,
        redrawSessionId: "",
        linkNotice: null,
      },
      step: "batch_teach",
    }));
  };

  // Prefill the typed-over files at their matched range. They land in the
  // confirm list as "needs individual confirmation".
  const prefillMismatchedFiles = async ({ thenReview = false } = {}) => {
    const batch = stateRef.current.batch;
    const applied = new Set(asArray(batch?.apply?.items).map((row) => row.sourceDocumentId));
    const docs = asArray(batch?.match?.results)
      .filter((result) => result.status === "formula_mismatch" && result.matchedRange && !result.isTemplateSource && !applied.has(result.sourceDocumentId))
      .map((result) => result.sourceDocumentId);
    if (docs.length) await batchActions.applyTemplate(batch, docs, { onlyStatuses: ["formula_mismatch"] });
    if (thenReview) updateState((current) => ({ batch: { ...current.batch, openSessionId: "" }, step: "batch_leftovers" }));
  };

  const redrawBlockInFile = (link) => {
    const sessionId = link?.workbookReviewSessionId || "";
    if (!sessionId) return;
    updateState((current) => ({
      batch: { ...current.batch, openSessionId: sessionId, openFileName: link.workbookName || "", redrawSessionId: sessionId, linkNotice: null },
    }));
  };

  // A redrawn block is linked directly as the batch's data kind: the region
  // gets the template's name as its data kind and the experiment from the
  // file name, so charts treat it as the same kind of data as the applied
  // matches. The template itself is not changed.
  const linkRedrawnRegion = async (region) => {
    const batch = stateRef.current.batch;
    const template = savedTemplates.find((item) => item.id === batch?.template?.id) || batch?.template;
    const dataKind = template?.name || "";
    if (!region?.id || !dataKind || !onLinkRegion) return;
    try {
      const result = await onLinkRegion(region.id, { dataKind });
      const link = result?.link || null;
      updateState((current) => ({
        batch: {
          ...current.batch,
          handLinkedDocs: [...new Set([...asArray(current.batch?.handLinkedDocs), region.sourceDocumentId])],
          redrawSessionId: "",
          linkNotice: {
            kind: "linked",
            text: `Confirmed and linked${link?.experimentLabel && link?.linkedExperimentId ? ` to ${link.experimentLabel}` : ""} as “${link?.dataKind || dataKind}”.${link && !link.linkedExperimentId ? " No experiment matched the file name; pick it in the Experiment Browser later." : ""}`,
          },
        },
      }));
    } catch (error) {
      updateState((current) => ({
        batch: { ...current.batch, linkNotice: { kind: "error", text: `Linking failed: ${error?.message || String(error)}` } },
      }));
    }
  };

  const confirmBatchRegion = async (regionId, request) => {
    const response = await onConfirmRegion?.(regionId, request);
    const region = response?.region || asArray(reviewRegions).find((item) => item.id === regionId) || null;
    const batch = stateRef.current.batch;
    if (!region?.id || !batch) return response;
    if (region.selectionMethod === "template_match") {
      const fileName = batchUploadedItems(batch).find((item) => item.workbookReviewLink?.sourceDocumentId === region.sourceDocumentId)?.fileName || "the file";
      updateState((current) => ({
        batch: {
          ...current.batch,
          apply: current.batch?.apply
            ? {
              ...current.batch.apply,
              items: asArray(current.batch.apply.items).map((row) => (
                row.regionId === region.id || row.sourceDocumentId === region.sourceDocumentId ? { ...row, confirmed: true, error: "" } : row
              )),
            }
            : current.batch?.apply,
          linkNotice: { kind: "confirmed", text: `Confirmed ${fileName}${region.templateMatch?.experimentLabel ? ` · ${region.templateMatch.experimentLabel}` : ""}.` },
        },
      }));
      return response;
    }
    const batchSessions = new Set(batchUploadedItems(batch).map((item) => item.workbookReviewLink?.workbookReviewSessionId));
    if (batch.template && !region.dataKind && onLinkRegion && batchSessions.has(region.workbookReviewSessionId)) {
      const template = savedTemplates.find((item) => item.id === batch.template.id) || batch.template;
      const regionSeriesKeys = asArray(region.currentRevision?.interpretation?.series)
        .map((series) => String(series?.seriesKey || series?.label || "").trim().toLowerCase())
        .filter(Boolean);
      const templateSeriesKeys = asArray(template?.seriesKeys).map((key) => String(key).toLowerCase());
      // Charts read a linked region by series key, so the block must carry at
      // least one series the template defines. Older summaries without keys
      // fall back to comparing counts.
      let mismatchText = "";
      if (templateSeriesKeys.length) {
        if (!templateSeriesKeys.some((key) => regionSeriesKeys.includes(key))) {
          mismatchText = `“${template.name}” expects the series ${templateSeriesKeys.join(", ")} but this block has ${regionSeriesKeys.length ? regionSeriesKeys.join(", ") : "no series"}. Correct the interpretation before linking, or link it anyway.`;
        }
      } else if (Number.isInteger(template?.seriesCount) && regionSeriesKeys.length !== template.seriesCount) {
        mismatchText = `“${template.name}” expects ${template.seriesCount} series but this block has ${regionSeriesKeys.length}. Correct the interpretation before linking, or link it anyway.`;
      }
      if (mismatchText) {
        updateState((current) => ({
          batch: { ...current.batch, linkNotice: { kind: "series_mismatch", regionId: region.id, text: mismatchText } },
        }));
        return response;
      }
      await linkRedrawnRegion(region);
    }
    return response;
  };

  const continueAfterBatchApply = () => {
    const leftovers = batchLeftovers(state.batch);
    updateState((current) => ({
      batch: { ...current.batch, openSessionId: "" },
      step: leftovers.length ? "batch_leftovers" : "batch_repeat",
    }));
  };

  const finishBatch = (option) => {
    respondAfterThinking({ kind: "batch_repeat", text: option.label }, () => {
      if (option.value === "another_result") {
        const canReuse = savedTemplates.length > 0;
        updateState((current) => ({
          batch: {
            ...current.batch,
            match: null,
            apply: null,
            template: null,
            templateSource: "",
            openSessionId: canReuse ? "" : (current.batch?.teach?.sessionId || ""),
          },
          step: canReuse ? "batch_template_choice" : "batch_teach",
        }));
        return;
      }
      updateState((current) => ({
        batchRounds: [...asArray(current.batchRounds), {
          number: asArray(current.batchRounds).length + 1,
          fileCount: batchUploadedItems(current.batch).length,
          linkedCount: batchLinkedCount(current.batch),
          dataKind: current.batch?.template?.name || "",
        }],
        batch: null,
        step: option.value === "different_set" ? "more_workbooks" : "preview",
      }));
    });
  };

  const chooseMoreWorkbooks = (option) => {
    if (option.value === "per_experiment") {
      respondAfterThinking({ kind: "more_workbooks", text: option.label }, () => updateState({ step: "batch_pick" }));
      return;
    }
    if (option.value === "master_table") {
      respondAfterThinking({ kind: "more_workbooks", text: option.label }, () => {
        planRecoveryAttemptedRef.current = false;
        hydratedSessionRef.current = "";
        setUploadError("");
        setAnalysisFlow({ loading: false, error: "", thread: null, revision: null });
        updateState((current) => ({
          ...ROUND_RESET_FIELDS,
          workbookRounds: [...asArray(current.workbookRounds), {
            number: roundNumberOf(current),
            workbookFileName: current.workbookFileName,
            workbookReviewSessionId: current.workbookReviewSessionId,
            publishedCount: Math.max(0, publishedCount - (current.publishedCountAtRoundStart || 0)),
          }],
          publishedCountAtRoundStart: publishedCount,
          step: "upload",
        }));
      });
      return;
    }
    respondAfterThinking({ kind: "more_workbooks", text: option.label }, () => updateState({ step: "preview" }));
  };

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

  const showComposer = contextQuestionOpen || state.step === "correction";
  const placeholder = state.step === "correction"
    ? "Describe what looks wrong and what should be corrected..."
    : "";
  const contextStageVisible = ["context", "waiting_result", "result_review"].includes(state.step);
  const planGenerationWorking = state.step === "plan_generating" && analysisFlow.loading;
  const planGenerationStatusVisible = planGenerationWorking || planRecoveryChecking;
  const planReviewMissing = state.step === "plan_review"
    && (!analysisFlow.thread?.id || !analysisFlow.revision?.id);
  const progressPercent = Math.min(100, PROGRESS_BY_STEP[state.step] || 8);

  const batchDock = (
    <WorkbookReviewDock
      reviewState={reviewState}
      reviewRegions={asArray(reviewRegions)}
      activeRegionId={activeRegionId}
      onActiveRegionChange={onActiveRegionChange}
      onReviseRegion={onReviseRegion}
      onConfirmRegion={confirmBatchRegion}
      onRetryRegion={onRetryRegion}
      onIgnoreRegion={onIgnoreRegion}
      onDeleteRegion={onDeleteRegion}
      onSaveExtractionTemplate={saveBatchTemplate}
      onUpdateExtractionTemplate={updateBatchTemplate}
      onLinkRegion={state.batch?.template?.name && onLinkRegion ? linkRedrawnRegion : undefined}
      linkDataKind={state.batch?.template?.name || ""}
      extractionTemplates={extractionTemplates}
    />
  );
  const batchCardBlock = batchVisible ? (
    <div className="project-onboarding-wide project-onboarding-batch-card">
        <WorkbookBatchCard
          batch={state.batch}
          canRetry={batchActions.hasFiles(state.batch.batchId)}
          retrying={batchActions.retryingBatchId === state.batch.batchId}
          templates={extractionTemplates}
          matching={batchActions.matchingBatchId === state.batch.batchId}
          applying={batchActions.applyingBatchId === state.batch.batchId}
          confirming={batchActions.confirmingBatchId === state.batch.batchId}
          experiments={batchActions.experiments}
          onOpen={openBatchFile}
          onRetry={retryBatchUpload}
          onMatchTemplate={batchActions.matchTemplate}
          onApplyTemplate={batchActions.applyTemplate}
          onConfirmApplied={batchActions.confirmRegions}
        />
      </div>
  ) : null;
  const batchGridBlock = renderWorkbookGrid
    ? <div className="project-onboarding-wide project-onboarding-grid">{renderWorkbookGrid(batchDock)}</div>
    : <div className="project-onboarding-inline-review project-onboarding-wide">{batchDock}</div>;

  return (
    <main className="project-onboarding-page">
      <header className="project-onboarding-header">
        <button type="button" className="project-onboarding-brand" onClick={onExit}>
          <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
          <span>LabRat</span>
        </button>
        <div className="project-onboarding-header-tools">
          {(planGenerationStatusVisible || planReadyPending || ["working", "ready", "error"].includes(state.generationStatus)) && (
            <div className={`project-onboarding-generation-status is-${planGenerationStatusVisible ? "working" : planReadyPending ? "ready" : state.generationStatus}`} role="status" aria-live="polite">
              {(planGenerationStatusVisible || state.generationStatus === "working") && <span className="project-onboarding-status-spinner" aria-hidden="true" />}
              {(planReadyPending || state.generationStatus === "ready") && <span aria-hidden="true">✓</span>}
              {!planGenerationStatusVisible && !planReadyPending && state.generationStatus === "error" && <span aria-hidden="true">!</span>}
              <strong>
                {planRecoveryChecking
                  ? "Checking for your review plan…"
                  : planGenerationWorking
                  ? `Preparing review plan · ${planGenerationElapsed}s`
                  : planReadyPending
                  ? "Plan ready"
                  : state.generationStatus === "working"
                  ? "Generating your Experiment Browser preview…"
                  : state.generationStatus === "ready"
                    ? "Preview ready"
                    : "Generation failed"}
              </strong>
            </div>
          )}
          <span className="project-onboarding-project-name">{projectState?.project?.name || "New project"}</span>
          <button type="button" onClick={skipOnboarding}>Skip onboarding</button>
        </div>
        <div className="project-onboarding-progress" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </header>

      <section className="project-onboarding-stream" aria-label="Project onboarding" ref={messagesRef}>
        <div className="project-onboarding-messages">
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
              {completedRounds.map((round) => (
                <React.Fragment key={`round-${round.number}`}>
                  <OnboardingMessage role="user"><p>Uploaded {round.workbookFileName || "a workbook"}</p></OnboardingMessage>
                  <OnboardingMessage>
                    <p>
                      Published {round.publishedCount} {round.publishedCount === 1 ? "experiment" : "experiments"} from {round.workbookFileName || "that workbook"} to the Experiment Browser.
                    </p>
                  </OnboardingMessage>
                </React.Fragment>
              ))}
              {(!completedRounds.length || state.step === "upload" || state.round) && (
              <OnboardingMessage>
                <p>
                  {completedRounds.length
                    ? "Upload the next master table and I’ll map its structure the same way."
                    : state.masterTableStatus === "no"
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
              )}
            </>
          )}

          {state.workbookFileName && (
            <OnboardingMessage role="user">
              <p>Uploaded {state.workbookFileName}</p>
            </OnboardingMessage>
          )}

          {["region_review", "plan_generating"].includes(state.step) && (
            <OnboardingMessage>
              <p>I found the main sections of {state.workbookFileName || "your workbook"}. Confirm my interpretation of each region, then I’ll draft your Experiment Browser plan.</p>
            </OnboardingMessage>
          )}

          {state.step === "region_review" && (
            <div className="project-onboarding-inline-review project-onboarding-wide">
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
              {contextQuestionsRemain(state) && <p>While I draft, a few quick questions about your project. Skip any you like.</p>}
              <div className="project-onboarding-processing"><span /> Drafting a plan for your Experiment Browser…</div>
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
              <p>Your workbook and confirmed interpretations are safe. LabRat will check the server before starting another plan.</p>
              <button type="button" className="project-onboarding-primary" onClick={createExperimentPlan}>
                Try generating the plan again
              </button>
            </OnboardingMessage>
          )}

          {contextRoundActive && ONBOARDING_CONTEXT_QUESTIONS.map((item, index) => (index < contextSplitIndex ? (
            <ContextQuestionTurn
              key={item.id}
              item={item}
              index={index}
              answers={state.contextAnswers}
              isCurrent={draftingWindowOpen && index === state.contextIndex}
              pendingAnswer={pendingAnswer}
              hint={planReadyPending ? "Your plan is ready. Answer or skip this question to review it." : ""}
            />
          ) : null))}

          {contextRoundActive && planGenerationWorking && !contextQuestionsRemain(state) && Object.keys(state.contextAnswers || {}).length > 0 && (
            <OnboardingMessage>
              <p>Great, I’ll remember these. Your plan is still drafting; give it a bit more time.</p>
              <div className="project-onboarding-processing"><span /> Drafting a plan for your Experiment Browser… {planGenerationElapsed}s</div>
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
            <div className="project-onboarding-analysis project-onboarding-wide">
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
            <div className={`project-onboarding-analysis project-onboarding-wide${["plan_review", "result_review"].includes(state.step) ? "" : " is-background"}`}>
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

          {contextStageVisible && (
            <OnboardingMessage>
              <p>Plan accepted. I’m now creating your Experiment Browser preview, and it may take a little while.</p>
              {contextQuestionsAfterPlan && (
                <p>
                  {contextSplitIndex > 0
                    ? "While I work, let’s finish the quick questions. Skip any you like."
                    : "While I work, a few quick questions about your project. Skip any you like."}
                </p>
              )}
            </OnboardingMessage>
          )}

          {contextStageVisible && contextRoundActive && ONBOARDING_CONTEXT_QUESTIONS.map((item, index) => (index >= contextSplitIndex ? (
            <ContextQuestionTurn
              key={item.id}
              item={item}
              index={index}
              answers={state.contextAnswers}
              isCurrent={state.step === "context" && index === state.contextIndex}
              pendingAnswer={pendingAnswer}
              hint={state.generationStatus === "ready" ? "Your preview is ready. Answer or skip this question to open it." : ""}
            />
          ) : null))}

          {state.step === "waiting_result" && (
            <OnboardingMessage>
              <p>{Object.keys(state.contextAnswers || {}).length ? "Great, I’ll remember these. " : ""}Your preview is still generating; give it a bit more time.</p>
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
              <p>Your workbook, confirmed interpretations, accepted plan, and onboarding answers are still saved.</p>
              <button type="button" className="project-onboarding-secondary" onClick={pauseOnboarding}>Quit for now</button>
            </OnboardingMessage>
          )}

          {completedBatchRounds.map((round) => (
            <React.Fragment key={`batch-round-${round.number}`}>
              <OnboardingMessage role="user"><p>Uploaded {round.fileCount} per-experiment {round.fileCount === 1 ? "workbook" : "workbooks"}</p></OnboardingMessage>
              <OnboardingMessage>
                <p>Linked {round.linkedCount} of {round.fileCount} files to experiments{round.dataKind ? ` as “${round.dataKind}”` : ""}.</p>
              </OnboardingMessage>
            </React.Fragment>
          ))}

          {state.step === "more_workbooks" && (
            <OnboardingMessage>
              <p>
                {completedRounds.length
                  ? `${roundPublishedCount} more ${roundPublishedCount === 1 ? "experiment is" : "experiments are"} in the Experiment Browser, ${publishedCount} in total.`
                  : `Your ${roundPublishedCount} ${roundPublishedCount === 1 ? "experiment is" : "experiments are"} in the Experiment Browser.`}
              </p>
              <p>Do you have other workbooks to upload?</p>
              <ChoiceButtons
                options={[
                  {
                    value: "per_experiment",
                    label: "Per-experiment workbooks",
                    detail: "One file per experiment, such as calculation sheets. I’ll learn the layout from one file and apply it to the rest.",
                  },
                  {
                    value: "master_table",
                    label: "Another master table",
                    detail: "More experiments in the same kind of table.",
                  },
                  {
                    value: "done",
                    label: "No, I’m done",
                  },
                ]}
                onChoose={chooseMoreWorkbooks}
                disabled={assistantThinking}
              />
            </OnboardingMessage>
          )}

          {pendingAnswer?.kind === "more_workbooks" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
          )}

          {state.step === "batch_pick" && (
            <OnboardingMessage>
              <p>Per-experiment workbooks work like this: I learn where the result sits in one file, save that as a template, and apply it to every other file with the same layout.</p>
              <p>Upload all files that share a layout together, and name each file with its experiment number, for example “Calculation Exp31.xlsx”, so I can link it to the right experiment.</p>
              <button type="button" className="project-onboarding-upload" onClick={() => batchInputRef.current?.click()}>
                Choose workbook files
              </button>
            </OnboardingMessage>
          )}

          {batchVisible && (
            <OnboardingMessage role="user">
              <p>Selected {batchItems.length} {batchItems.length === 1 ? "workbook" : "workbooks"}</p>
            </OnboardingMessage>
          )}

          {batchVisible && state.step === "batch_upload" && (
            <OnboardingMessage>
              {batchRunning ? (
                <div className="project-onboarding-processing"><span /> Uploading {batchItems.length} {batchItems.length === 1 ? "file" : "files"}…</div>
              ) : batchSummary.uploaded ? (
                <p>Uploaded {batchSummary.uploaded} of {batchSummary.total} files.{batchSummary.failed ? ` ${batchSummary.failed} failed; retry them below.` : ""}</p>
              ) : (
                <p>None of the files could be uploaded. Retry them below or choose the files again.</p>
              )}
              {batchItems.length > BATCH_SOFT_NOTICE_FILES && (
                <p>That’s {batchItems.length} files. Uploading will take a couple of minutes, and I’ll link them all in one confirmation list.</p>
              )}
              {state.batch?.error && (
                <div className="project-onboarding-error" role="alert"><p>{state.batch.error}</p></div>
              )}
            </OnboardingMessage>
          )}

          {batchVisible && state.step === "batch_upload" && batchCardBlock}

          {batchVisible && state.step !== "batch_upload" && (
            <OnboardingMessage>
              <p>
                Uploaded {batchSummary.uploaded} of {batchSummary.total} files. I linked {batchNameMatches} to experiments from their file names
                {batchNameUnresolved
                  ? `; ${batchNameUnresolved} ${batchNameUnresolved === 1 ? "name has" : "names have"} no matching experiment number and you can pick their experiment later.`
                  : "."}
              </p>
            </OnboardingMessage>
          )}

          {batchVisible && state.step === "batch_template_choice" && (
            <OnboardingMessage>
              <p>These files are indexed. Do you want to apply a saved template or teach a new one?</p>
              <ChoiceButtons
                options={[
                  ...savedTemplates.map((template) => ({
                    value: template.id,
                    label: `Apply “${template.name}”`,
                    detail: template.anchorRange
                      ? `Looks for ${template.sheetName ? `${template.sheetName}!` : ""}${template.anchorRange} in every file.`
                      : "Match this saved layout across the batch.",
                  })),
                  {
                    value: "teach_new",
                    label: "Teach a new template on one file",
                    detail: `Draw the result in ${state.batch.teach?.fileName || "the first file"} and save it as a template.`,
                  },
                ]}
                onChoose={chooseBatchTemplate}
                disabled={assistantThinking}
              />
            </OnboardingMessage>
          )}

          {pendingAnswer?.kind === "batch_template" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
          )}

          {batchVisible && state.step === "batch_teach" && (
            <>
              <OnboardingMessage>
                <p>Let’s start with {state.batch.teach?.fileName || "the first file"}. Draw a box around the result you want me to extract from every file, confirm my interpretation of it, then save it as a template.</p>
              </OnboardingMessage>
              {batchGridBlock}
            </>
          )}

          {batchVisible && state.step === "batch_apply" && (
            <>
              <OnboardingMessage>
                <p>
                  {state.batch.templateSource === "chosen"
                    ? `Using “${state.batch.template?.name || "template"}”. I’ll look for its block in all ${batchSummary.uploaded} ${batchSummary.uploaded === 1 ? "file" : "files"}.`
                    : `Saved as “${state.batch.template?.name || "template"}”. I’ll look for this same block in the other ${Math.max(0, batchSummary.uploaded - 1)} ${batchSummary.uploaded - 1 === 1 ? "file" : "files"}.`}
                </p>
                {state.batch.match && !state.batch.match.error && (
                  batchEligibleMatches > 0 ? (
                    <p>
                      {batchEligibleMatches} {batchEligibleMatches === 1 ? "file matches" : "files match"}. Apply the template, review the list, and confirm them in one click.
                      {batchTypedOverMatches ? ` ${batchTypedOverMatches} of them ${batchTypedOverMatches === 1 ? "has" : "have"} cells that differ from the template (typed values, blank rows, or formulas built differently); ${batchTypedOverMatches === 1 ? "it stays" : "they stay"} unticked until you check ${batchTypedOverMatches === 1 ? "it" : "them"}.` : ""}
                      {batchPrefillableResults.length ? ` ${batchPrefillableResults.length} more ${batchPrefillableResults.length === 1 ? "has" : "have"} typed numbers where the template expects formulas; I can fill those in for individual confirmation.` : ""}
                      {batchUnmatched ? ` ${batchUnmatched} ${batchUnmatched === 1 ? "file has" : "files have"} a different layout; we’ll handle those next.` : ""}
                    </p>
                  ) : batchPrefillableResults.length > 0 ? (
                    <p>
                      {batchPrefillableResults.length} {batchPrefillableResults.length === 1 ? "file has" : "files have"} text where the template expects values. I can still fill in the block; confirm each one after checking those cells.
                      {batchUnmatched ? ` ${batchUnmatched} ${batchUnmatched === 1 ? "file has" : "files have"} a different layout; we’ll handle those next.` : ""}
                    </p>
                  ) : (
                    <p>I couldn’t find this template’s block in these files. Review them, use a different template, or teach a new one.</p>
                  )
                )}
              </OnboardingMessage>
              {batchCardBlock}
              {state.batch.match && !state.batch.match.error && (
                <div className="project-onboarding-actions project-onboarding-batch-actions">
                  {batchEligibleMatches > 0 && (
                    <button type="button" className="project-onboarding-primary" onClick={continueAfterBatchApply}>Continue</button>
                  )}
                  {batchEligibleMatches === 0 && batchPrefillableResults.length > 0 && (
                    <button type="button" className="project-onboarding-primary" disabled={Boolean(batchActions.applyingBatchId)} onClick={() => prefillMismatchedFiles({ thenReview: true })}>
                      Apply and review each file
                    </button>
                  )}
                  {batchEligibleMatches > 0 && batchPrefillPending.length > 0 && (
                    <button type="button" className="project-onboarding-secondary" disabled={Boolean(batchActions.applyingBatchId)} onClick={() => prefillMismatchedFiles()}>
                      Prefill {batchPrefillPending.length} typed-over {batchPrefillPending.length === 1 ? "file" : "files"}
                    </button>
                  )}
                  {batchEligibleMatches === 0 && batchPrefillableResults.length === 0 && (
                    <button type="button" className="project-onboarding-primary" onClick={continueAfterBatchApply}>Review the files</button>
                  )}
                  {savedTemplates.length > 1 && (
                    <button type="button" className="project-onboarding-secondary" onClick={goBackToTemplateChoice}>Use a different template</button>
                  )}
                  {batchTeachLink && (
                    <button type="button" className="project-onboarding-secondary" onClick={() => teachNewTemplateFromFile(batchTeachLink)}>Teach a new template on one file</button>
                  )}
                  <button type="button" className="project-onboarding-link" onClick={goBackToTemplateChoice}>Go back</button>
                </div>
              )}
            </>
          )}

          {batchVisible && state.step === "batch_leftovers" && (
            <>
              <OnboardingMessage>
                {batchLeftoverEntries.length ? (
                  <>
                    <p>
                      {batchLeftoverEntries.length} {batchLeftoverEntries.length === 1 ? "file still needs" : "files still need"} attention.
                      Confirm a prefilled block, redraw the block by hand, or teach a new template from a file.
                    </p>
                    <ul className="project-onboarding-leftovers">
                      {batchLeftoverEntries.map(({ item, result, row }) => {
                        const link = batchLinkFor(item);
                        return (
                          <li key={link?.sourceDocumentId || item.fileName}>
                            <strong>{item.fileName}</strong>
                            <span>
                              {row
                                ? `Needs individual confirmation${row.experimentLabel ? ` · ${row.experimentLabel}` : ""}.${row.warning ? ` ${row.warning}` : ""}`
                                : result
                                  ? templateMatchDetail(result) || result.status
                                  : "not matched"}
                            </span>
                            <div className="project-onboarding-leftover-actions">
                              {row && <button type="button" onClick={() => openBatchFile(link)}>Confirm the prefilled block</button>}
                              <button type="button" onClick={() => redrawBlockInFile(link)}>Redraw the block in this file</button>
                              <button type="button" onClick={() => teachNewTemplateFromFile(link)}>Teach a new template from this file</button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p>Every file in this batch is linked.</p>
                )}
                <div className="project-onboarding-actions">
                  {!batchLeftoverEntries.length && (
                    <button type="button" className="project-onboarding-primary" onClick={() => updateState((current) => ({ batch: { ...current.batch, openSessionId: "", redrawSessionId: "" }, step: "batch_repeat" }))}>Continue</button>
                  )}
                  {batchPrefillPending.length > 0 && (
                    <button type="button" className="project-onboarding-secondary" disabled={Boolean(batchActions.applyingBatchId)} onClick={() => prefillMismatchedFiles()}>
                      Prefill {batchPrefillPending.length} typed-over {batchPrefillPending.length === 1 ? "file" : "files"}
                    </button>
                  )}
                  <button type="button" className="project-onboarding-secondary" onClick={() => rematchBatch()}>Re-match with the current template</button>
                  {savedTemplates.length > 1 && (
                    <button type="button" className="project-onboarding-secondary" onClick={goBackToTemplateChoice}>Use a different template</button>
                  )}
                  {batchLeftoverEntries.length > 0 && (
                    <button type="button" className="project-onboarding-secondary" onClick={() => updateState((current) => ({ batch: { ...current.batch, openSessionId: "", redrawSessionId: "" }, step: "batch_repeat" }))}>Skip the rest</button>
                  )}
                </div>
              </OnboardingMessage>
              {state.batch.redrawSessionId && state.batch.openSessionId === state.batch.redrawSessionId && (
                <OnboardingMessage>
                  <p>Draw a box around the block in {batchOpenFileName}, confirm my interpretation, and I’ll link it as “{state.batch.template?.name || "the template"}”.</p>
                </OnboardingMessage>
              )}
              {state.batch.linkNotice && (
                <OnboardingMessage>
                  <p>{state.batch.linkNotice.text}</p>
                  {state.batch.linkNotice.kind === "series_mismatch" && (
                    <button
                      type="button"
                      className="project-onboarding-secondary"
                      onClick={() => linkRedrawnRegion(asArray(reviewRegions).find((item) => item.id === state.batch.linkNotice.regionId))}
                    >
                      Link anyway
                    </button>
                  )}
                </OnboardingMessage>
              )}
              {batchCardBlock}
              {state.batch.openSessionId && batchGridBlock}
            </>
          )}

          {batchVisible && state.step === "batch_repeat" && (
            <OnboardingMessage>
              <p>{batchLinkedCount(state.batch)} of {batchSummary.uploaded} files are linked to experiments{state.batch.template?.name ? ` as “${state.batch.template.name}”` : ""}.</p>
              <p>Linked workbook data appears as a chip on each experiment and can be charted directly. It does not change the values in your master table.</p>
              <p>Do you want to extract another result from the same files, upload a different set of workbooks, or finish?</p>
              <ChoiceButtons
                options={[
                  { value: "another_result", label: "Extract another result from the same files", detail: "Teach a second template on the same batch." },
                  { value: "different_set", label: "Upload a different set of workbooks" },
                  { value: "done", label: "I’m done" },
                ]}
                onChoose={finishBatch}
                disabled={assistantThinking}
              />
            </OnboardingMessage>
          )}

          {pendingAnswer?.kind === "batch_repeat" && (
            <OnboardingMessage role="user"><p>{pendingAnswer.text}</p></OnboardingMessage>
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
      </section>

      {showComposer && !assistantThinking && (
        <div className="project-onboarding-composer-bar">
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
              aria-label={contextQuestionOpen ? "Your answer" : "Correction request"}
              autoFocus
            />
            <div className="project-onboarding-composer-actions">
              {contextQuestionOpen && (
                <button type="button" className="project-onboarding-skip" onClick={skipContextQuestion}>Skip</button>
              )}
              <button type="button" className="project-onboarding-composer-send" disabled={!input.trim()} onClick={submitTextAnswer} aria-label="Send onboarding answer">↑</button>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={onFileSelected} />
      <input ref={batchInputRef} type="file" accept=".xlsx,.xls" multiple hidden onChange={onBatchFilesSelected} aria-label="Choose per-experiment workbook files" />
    </main>
  );
}
