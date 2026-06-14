import { describe, expect, it } from "vitest";
import {
  blockReviewDecision,
  createBlockReviewState,
  scanBlockIds,
  setBlockReviewDecision,
} from "./importBlockReviewState.js";

function scanResult() {
  return {
    sheets: [
      { blocks: [{ blockId: "block_1" }, { blockId: "block_2" }] },
      { blocks: [{ blockId: "block_3" }] },
    ],
  };
}

describe("importBlockReviewState", () => {
  it("collects block ids from a scan result", () => {
    expect(scanBlockIds(scanResult())).toEqual(["block_1", "block_2", "block_3"]);
  });

  it("creates pending review state and preserves still-available decisions", () => {
    const state = createBlockReviewState(scanResult(), {
      approvedBlockIds: ["block_1", "missing"],
      ignoredBlockIds: ["block_2"],
    });

    expect(state).toEqual({
      blockIds: ["block_1", "block_2", "block_3"],
      approvedBlockIds: ["block_1"],
      ignoredBlockIds: ["block_2"],
    });
    expect(blockReviewDecision(state, "block_3")).toBe("pending");
  });

  it("sets approved and ignored decisions exclusively", () => {
    let state = createBlockReviewState(scanResult());
    state = setBlockReviewDecision(state, "block_1", "approved");
    state = setBlockReviewDecision(state, "block_2", "ignored");
    state = setBlockReviewDecision(state, "block_1", "ignored");

    expect(state.approvedBlockIds).toEqual([]);
    expect(state.ignoredBlockIds).toEqual(["block_1", "block_2"]);
    expect(blockReviewDecision(state, "block_1")).toBe("ignored");
  });

  it("clears a decision back to pending", () => {
    let state = createBlockReviewState(scanResult());
    state = setBlockReviewDecision(state, "block_1", "approved");
    state = setBlockReviewDecision(state, "block_1", "pending");

    expect(state.approvedBlockIds).toEqual([]);
    expect(state.ignoredBlockIds).toEqual([]);
    expect(blockReviewDecision(state, "block_1")).toBe("pending");
  });
});
