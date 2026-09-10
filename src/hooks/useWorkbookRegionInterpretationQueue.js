import { useCallback, useEffect, useRef, useState } from "react";

export const WORKBOOK_REGION_INTERPRETATION_CONCURRENCY = 3;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function prioritizedPendingWorkbookRegions(regions, activeRegionId = "") {
  const pending = asArray(regions).filter((region) => (
    region?.id
    && region.disposition === "active"
    && region.reviewStatus === "interpreting"
  ));
  if (!activeRegionId) return pending;
  return [
    ...pending.filter((region) => region.id === activeRegionId),
    ...pending.filter((region) => region.id !== activeRegionId),
  ];
}

function normalizeBackgroundSessions(backgroundSessions) {
  return asArray(backgroundSessions)
    .map((entry) => ({
      sessionId: String(entry?.sessionId || "").trim(),
      regions: asArray(entry?.regions),
    }))
    .filter((entry) => entry.sessionId);
}

/**
 * Runs bounded region interpretation for the active Workbook Review session
 * and, optionally, for background sessions (for example every workbook of a
 * batch upload). One project-wide concurrency limit covers both; the active
 * session always fills free slots first. Results for background sessions are
 * delivered through onBackgroundRegionResult / onBackgroundRegionError, and a
 * background session that becomes active hands its still-running tasks to the
 * active callbacks instead of restarting them.
 */
export function useWorkbookRegionInterpretationQueue({
  sessionId = "",
  regions = [],
  activeRegionId = "",
  backgroundSessions = [],
  concurrency = WORKBOOK_REGION_INTERPRETATION_CONCURRENCY,
  interpretRegion,
  onRegionResult,
  onRegionError,
  onBackgroundRegionResult,
  onBackgroundRegionError,
} = {}) {
  const [queueRevision, setQueueRevision] = useState(0);
  const currentSessionIdRef = useRef(sessionId);
  const regionsRef = useRef(regions);
  const backgroundSessionsRef = useRef(normalizeBackgroundSessions(backgroundSessions));
  const callbacksRef = useRef({ interpretRegion, onRegionResult, onRegionError, onBackgroundRegionResult, onBackgroundRegionError });
  const inFlightRef = useRef(new Map());
  const attemptedBySessionRef = useRef(new Map());
  const mountedRef = useRef(true);

  currentSessionIdRef.current = sessionId;
  regionsRef.current = regions;
  backgroundSessionsRef.current = normalizeBackgroundSessions(backgroundSessions);
  callbacksRef.current = { interpretRegion, onRegionResult, onRegionError, onBackgroundRegionResult, onBackgroundRegionError };

  const wakeQueue = useCallback(() => {
    if (!mountedRef.current) return;
    setQueueRevision((value) => value + 1);
  }, []);

  const isBackgroundSession = useCallback((targetSessionId) => (
    backgroundSessionsRef.current.some((entry) => entry.sessionId === targetSessionId)
  ), []);

  useEffect(() => {
    for (const [taskKey, task] of inFlightRef.current) {
      if (task.sessionId === sessionId || isBackgroundSession(task.sessionId)) continue;
      task.controller?.abort();
      inFlightRef.current.delete(taskKey);
    }
    if (sessionId) attemptedBySessionRef.current.set(sessionId, new Set());
    wakeQueue();
  }, [isBackgroundSession, sessionId, wakeQueue]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const task of inFlightRef.current.values()) task.controller?.abort();
      inFlightRef.current.clear();
    };
  }, []);

  const startRegion = useCallback((targetSessionId, region, { retry = false } = {}) => {
    if (!targetSessionId || !region?.id || typeof callbacksRef.current.interpretRegion !== "function") {
      return false;
    }
    const taskKey = `${targetSessionId}:${region.id}`;
    if (inFlightRef.current.has(taskKey)) return false;
    const attempted = attemptedBySessionRef.current.get(targetSessionId) || new Set();
    attemptedBySessionRef.current.set(targetSessionId, attempted);
    if (retry) attempted.delete(region.id);
    if (attempted.has(region.id)) return false;

    attempted.add(region.id);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    inFlightRef.current.set(taskKey, {
      sessionId: targetSessionId,
      regionId: region.id,
      controller,
    });
    wakeQueue();
    const context = { sessionId: targetSessionId, regionId: region.id };
    Promise.resolve(callbacksRef.current.interpretRegion({
      sessionId: targetSessionId,
      region,
      signal: controller?.signal,
    }))
      .then((response) => {
        if (currentSessionIdRef.current === targetSessionId) {
          callbacksRef.current.onRegionResult?.(response, context);
        } else if (isBackgroundSession(targetSessionId)) {
          callbacksRef.current.onBackgroundRegionResult?.(response, context);
        }
      })
      .catch((error) => {
        if (controller?.signal.aborted || error?.name === "AbortError") return;
        if (currentSessionIdRef.current === targetSessionId) {
          callbacksRef.current.onRegionError?.(region, error, context);
        } else if (isBackgroundSession(targetSessionId)) {
          callbacksRef.current.onBackgroundRegionError?.(region, error, context);
        }
      })
      .finally(() => {
        inFlightRef.current.delete(taskKey);
        wakeQueue();
      });
    return true;
  }, [isBackgroundSession, wakeQueue]);

  const backgroundQueueKey = backgroundSessionsRef.current
    .map((entry) => `${entry.sessionId}:${prioritizedPendingWorkbookRegions(entry.regions).map((region) => region.id).join(",")}`)
    .join("|");

  useEffect(() => {
    const limit = Math.max(1, Number(concurrency) || WORKBOOK_REGION_INTERPRETATION_CONCURRENCY);
    let availableSlots = Math.max(0, limit - inFlightRef.current.size);
    if (!availableSlots) return;
    if (sessionId) {
      for (const region of prioritizedPendingWorkbookRegions(regions, activeRegionId)) {
        if (!availableSlots) break;
        if (startRegion(sessionId, region)) availableSlots -= 1;
      }
    }
    for (const entry of backgroundSessionsRef.current) {
      if (!availableSlots) break;
      if (entry.sessionId === sessionId) continue;
      for (const region of prioritizedPendingWorkbookRegions(entry.regions)) {
        if (!availableSlots) break;
        if (startRegion(entry.sessionId, region)) availableSlots -= 1;
      }
    }
  }, [activeRegionId, backgroundQueueKey, concurrency, queueRevision, regions, sessionId, startRegion]);

  const retryRegion = useCallback((regionId) => {
    const region = asArray(regionsRef.current).find((candidate) => (
      candidate?.id === regionId && candidate.disposition === "active"
    ));
    if (!currentSessionIdRef.current || !region) return false;
    return startRegion(currentSessionIdRef.current, region, { retry: true });
  }, [startRegion]);

  return { retryRegion };
}
