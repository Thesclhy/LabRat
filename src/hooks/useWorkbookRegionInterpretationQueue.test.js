import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkbookRegionInterpretationQueue } from "./useWorkbookRegionInterpretationQueue.js";

function pendingRegion(id, version = 1) {
  return { id, disposition: "active", reviewStatus: "interpreting", version };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWorkbookRegionInterpretationQueue", () => {
  it("interprets background session regions with one shared limit, active session first", async () => {
    const pending = new Map();
    const interpretRegion = vi.fn(({ sessionId, region }) => {
      const task = deferred();
      pending.set(`${sessionId}:${region.id}`, task);
      return task.promise;
    });
    const onRegionResult = vi.fn();
    const onBackgroundRegionResult = vi.fn();

    const props = {
      sessionId: "session_active",
      regions: [pendingRegion("a1"), pendingRegion("a2")],
      backgroundSessions: [
        { sessionId: "session_b", regions: [pendingRegion("b1"), pendingRegion("b2")] },
        { sessionId: "session_c", regions: [pendingRegion("c1")] },
      ],
      concurrency: 3,
      interpretRegion,
      onRegionResult,
      onBackgroundRegionResult,
    };
    const { rerender } = renderHook((hookProps) => useWorkbookRegionInterpretationQueue(hookProps), { initialProps: props });

    expect(interpretRegion).toHaveBeenCalledTimes(3);
    expect(interpretRegion.mock.calls.map(([call]) => `${call.sessionId}:${call.region.id}`)).toEqual([
      "session_active:a1",
      "session_active:a2",
      "session_b:b1",
    ]);

    pending.get("session_active:a1").resolve({ region: { id: "a1", reviewStatus: "needs_user_review" } });
    await flush();
    expect(onRegionResult).toHaveBeenCalledWith(
      { region: { id: "a1", reviewStatus: "needs_user_review" } },
      { sessionId: "session_active", regionId: "a1" },
    );
    expect(interpretRegion).toHaveBeenCalledTimes(4);
    expect(interpretRegion.mock.calls[3][0]).toMatchObject({ sessionId: "session_b", region: { id: "b2" } });

    pending.get("session_b:b1").resolve({ region: { id: "b1", reviewStatus: "needs_user_review" } });
    await flush();
    expect(onBackgroundRegionResult).toHaveBeenCalledWith(
      { region: { id: "b1", reviewStatus: "needs_user_review" } },
      { sessionId: "session_b", regionId: "b1" },
    );
    expect(onRegionResult).toHaveBeenCalledTimes(1);
    expect(interpretRegion).toHaveBeenCalledTimes(5);
    expect(interpretRegion.mock.calls[4][0]).toMatchObject({ sessionId: "session_c", region: { id: "c1" } });

    rerender({ ...props, regions: [pendingRegion("a2")] });
    expect(interpretRegion).toHaveBeenCalledTimes(5);
  });

  it("keeps background tasks alive when the active session changes and hands results to the new active session", async () => {
    const pending = new Map();
    const interpretRegion = vi.fn(({ sessionId, region }) => {
      const task = deferred();
      pending.set(`${sessionId}:${region.id}`, task);
      return task.promise;
    });
    const onRegionResult = vi.fn();
    const onBackgroundRegionResult = vi.fn();
    const onBackgroundRegionError = vi.fn();

    const props = {
      sessionId: "session_other",
      regions: [pendingRegion("o1")],
      backgroundSessions: [{ sessionId: "session_b", regions: [pendingRegion("b1"), pendingRegion("b2")] }],
      concurrency: 3,
      interpretRegion,
      onRegionResult,
      onBackgroundRegionResult,
      onBackgroundRegionError,
    };
    const { rerender } = renderHook((hookProps) => useWorkbookRegionInterpretationQueue(hookProps), { initialProps: props });
    expect(interpretRegion).toHaveBeenCalledTimes(3);
    const otherSignal = interpretRegion.mock.calls[0][0].signal;
    const backgroundSignal = interpretRegion.mock.calls[1][0].signal;

    rerender({ ...props, sessionId: "session_b", regions: [pendingRegion("b1"), pendingRegion("b2")] });

    expect(otherSignal.aborted).toBe(true);
    expect(backgroundSignal.aborted).toBe(false);
    expect(interpretRegion).toHaveBeenCalledTimes(3);

    pending.get("session_b:b1").resolve({ region: { id: "b1", reviewStatus: "needs_user_review" } });
    await flush();
    expect(onRegionResult).toHaveBeenCalledWith(
      { region: { id: "b1", reviewStatus: "needs_user_review" } },
      { sessionId: "session_b", regionId: "b1" },
    );
    expect(onBackgroundRegionResult).not.toHaveBeenCalled();

    rerender({ ...props, sessionId: "session_other", regions: [] });
    pending.get("session_b:b2").reject(Object.assign(new Error("boom"), { code: "region_interpretation_failed" }));
    await flush();
    expect(onBackgroundRegionError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b2" }),
      expect.objectContaining({ message: "boom" }),
      { sessionId: "session_b", regionId: "b2" },
    );
  });
});
