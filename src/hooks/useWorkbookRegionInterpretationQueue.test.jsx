import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkbookRegionInterpretationQueue } from "./useWorkbookRegionInterpretationQueue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pendingRegion(id, reviewStatus = "interpreting") {
  return {
    id,
    disposition: "active",
    reviewStatus,
    version: 1,
  };
}

function QueueHarness(props) {
  const { retryRegion } = useWorkbookRegionInterpretationQueue(props);
  return <button type="button" onClick={() => retryRegion(props.retryRegionId)}>Retry</button>;
}

describe("useWorkbookRegionInterpretationQueue", () => {
  it("prioritizes the active region and keeps at most three interpretations in flight", async () => {
    const gates = new Map();
    const interpretRegion = vi.fn(({ region }) => {
      const gate = deferred();
      gates.set(region.id, gate);
      return gate.promise;
    });
    const onRegionResult = vi.fn();
    render(
      <QueueHarness
        sessionId="session_1"
        regions={[
          pendingRegion("region_1"),
          pendingRegion("region_2"),
          pendingRegion("region_3"),
          pendingRegion("region_4"),
          pendingRegion("region_5"),
        ]}
        activeRegionId="region_4"
        interpretRegion={interpretRegion}
        onRegionResult={onRegionResult}
      />,
    );

    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(3));
    expect(interpretRegion.mock.calls.map(([request]) => request.region.id)).toEqual([
      "region_4",
      "region_1",
      "region_2",
    ]);

    await act(async () => {
      gates.get("region_4").resolve({ region: { id: "region_4", reviewStatus: "awaiting_review" } });
      await gates.get("region_4").promise;
    });
    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(4));
    expect(interpretRegion.mock.calls[3][0].region.id).toBe("region_3");
    expect(onRegionResult).toHaveBeenCalledTimes(1);
  });

  it("isolates late responses and resumes pending regions when a workbook is reopened", async () => {
    const gates = [];
    const interpretRegion = vi.fn(({ sessionId, region }) => {
      const gate = deferred();
      gates.push({ sessionId, regionId: region.id, gate });
      return gate.promise;
    });
    const onRegionResult = vi.fn();
    const { rerender } = render(
      <QueueHarness
        sessionId="session_a"
        regions={[pendingRegion("region_a")]}
        activeRegionId="region_a"
        interpretRegion={interpretRegion}
        onRegionResult={onRegionResult}
      />,
    );
    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(1));

    rerender(
      <QueueHarness
        sessionId="session_b"
        regions={[pendingRegion("region_b")]}
        activeRegionId="region_b"
        interpretRegion={interpretRegion}
        onRegionResult={onRegionResult}
      />,
    );
    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(2));

    await act(async () => {
      gates[0].gate.resolve({ region: { id: "region_a", reviewStatus: "awaiting_review" } });
      await gates[0].gate.promise;
    });
    expect(onRegionResult).not.toHaveBeenCalled();

    rerender(
      <QueueHarness
        sessionId="session_a"
        regions={[pendingRegion("region_a")]}
        activeRegionId="region_a"
        interpretRegion={interpretRegion}
        onRegionResult={onRegionResult}
      />,
    );
    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(3));
    expect(interpretRegion.mock.calls[2][0]).toMatchObject({
      sessionId: "session_a",
      region: { id: "region_a" },
    });
  });

  it("aborts requests from the previous workbook without surfacing an error", async () => {
    const signals = [];
    const interpretRegion = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }));
    const onRegionError = vi.fn();
    const { rerender } = render(
      <QueueHarness
        sessionId="session_a"
        regions={[pendingRegion("region_a")]}
        activeRegionId="region_a"
        interpretRegion={interpretRegion}
        onRegionError={onRegionError}
      />,
    );
    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(1));

    rerender(
      <QueueHarness
        sessionId="session_b"
        regions={[]}
        interpretRegion={interpretRegion}
        onRegionError={onRegionError}
      />,
    );

    await waitFor(() => expect(signals[0].aborted).toBe(true));
    expect(onRegionError).not.toHaveBeenCalled();
  });

  it("retries only the requested failed region", async () => {
    const interpretRegion = vi.fn().mockResolvedValue({
      region: { id: "region_failed", reviewStatus: "awaiting_review" },
    });
    render(
      <QueueHarness
        sessionId="session_1"
        regions={[
          pendingRegion("region_failed", "interpretation_failed"),
          pendingRegion("region_ready", "awaiting_review"),
        ]}
        retryRegionId="region_failed"
        interpretRegion={interpretRegion}
      />,
    );

    expect(interpretRegion).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Retry" }).click());
    await waitFor(() => expect(interpretRegion).toHaveBeenCalledTimes(1));
    expect(interpretRegion.mock.calls[0][0].region.id).toBe("region_failed");
  });
});
