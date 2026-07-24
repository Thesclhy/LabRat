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

export function useWorkbookRegionInterpretationQueue({
  sessionId = "",
  regions = [],
  activeRegionId = "",
  concurrency = WORKBOOK_REGION_INTERPRETATION_CONCURRENCY,
  interpretRegion,
  onRegionResult,
  onRegionError,
} = {}) {
  const [queueRevision, setQueueRevision] = useState(0);
  const currentSessionIdRef = useRef(sessionId);
  const regionsRef = useRef(regions);
  const callbacksRef = useRef({ interpretRegion, onRegionResult, onRegionError });
  const inFlightRef = useRef(new Map());
  const attemptedBySessionRef = useRef(new Map());
  const mountedRef = useRef(true);

  currentSessionIdRef.current = sessionId;
  regionsRef.current = regions;
  callbacksRef.current = { interpretRegion, onRegionResult, onRegionError };

  const wakeQueue = useCallback(() => {
    if (!mountedRef.current) return;
    setQueueRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    for (const [taskKey, task] of inFlightRef.current) {
      if (task.sessionId === sessionId) continue;
      task.controller?.abort();
      inFlightRef.current.delete(taskKey);
    }
    if (sessionId) attemptedBySessionRef.current.set(sessionId, new Set());
    wakeQueue();
  }, [sessionId, wakeQueue]);

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
    Promise.resolve(callbacksRef.current.interpretRegion({
      sessionId: targetSessionId,
      region,
      signal: controller?.signal,
    }))
      .then((response) => {
        if (currentSessionIdRef.current === targetSessionId) {
          callbacksRef.current.onRegionResult?.(response, {
            sessionId: targetSessionId,
            regionId: region.id,
          });
        }
      })
      .catch((error) => {
        if (controller?.signal.aborted || error?.name === "AbortError") return;
        if (currentSessionIdRef.current === targetSessionId) {
          callbacksRef.current.onRegionError?.(region, error, {
            sessionId: targetSessionId,
          });
        }
      })
      .finally(() => {
        inFlightRef.current.delete(taskKey);
        wakeQueue();
      });
    return true;
  }, [wakeQueue]);

  useEffect(() => {
    if (!sessionId) return;
    const limit = Math.max(1, Number(concurrency) || WORKBOOK_REGION_INTERPRETATION_CONCURRENCY);
    const currentInFlight = [...inFlightRef.current.values()]
      .filter((task) => task.sessionId === sessionId).length;
    let availableSlots = Math.max(0, limit - currentInFlight);
    if (!availableSlots) return;
    for (const region of prioritizedPendingWorkbookRegions(regions, activeRegionId)) {
      if (!availableSlots) break;
      if (startRegion(sessionId, region)) availableSlots -= 1;
    }
  }, [activeRegionId, concurrency, queueRevision, regions, sessionId, startRegion]);

  const retryRegion = useCallback((regionId) => {
    const region = asArray(regionsRef.current).find((candidate) => (
      candidate?.id === regionId && candidate.disposition === "active"
    ));
    if (!currentSessionIdRef.current || !region) return false;
    return startRegion(currentSessionIdRef.current, region, { retry: true });
  }, [startRegion]);

  return { retryRegion };
}
