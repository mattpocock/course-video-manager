import { describe, expect, it } from "vitest";
import {
  initialProposalsState,
  proposalsReducer,
  type ProposalsState,
} from "./use-screenshot-proposals";
import type { ScreenshotProposal } from "./types";

const found = (timestamps: number[]): ScreenshotProposal => ({
  found: true,
  candidates: timestamps.map((timestamp, i) => ({
    timestamp,
    clipIndex: 6,
    previewPath: `/tmp/candidate-${i}.png`,
  })),
});

const withBlock = (
  key: string,
  proposal: ScreenshotProposal,
  selected: number | null = null
): ProposalsState => ({
  blocks: { [key]: { proposal, selected } },
  searching: {},
});

describe("proposalsReducer", () => {
  it("marks the searching block, and only that block", () => {
    const state = proposalsReducer(initialProposalsState, {
      type: "search-started",
      key: "doc-6-a",
    });
    expect(state.searching).toEqual({ "doc-6-a": true });
    expect(state.blocks).toEqual({});
  });

  it("stores the candidates and clears the searching flag", () => {
    const proposal = found([1, 2, 3, 4]);
    const state = proposalsReducer(
      { blocks: {}, searching: { "doc-6-a": true } },
      { type: "search-settled", key: "doc-6-a", proposal }
    );
    expect(state.searching).toEqual({});
    expect(state.blocks["doc-6-a"]).toEqual({ proposal, selected: null });
  });

  it("stores a decline like any other outcome", () => {
    const proposal: ScreenshotProposal = {
      found: false,
      reason: "no dashboard",
    };
    const state = proposalsReducer(
      { blocks: {}, searching: { "doc-6-a": true } },
      { type: "search-settled", key: "doc-6-a", proposal }
    );
    expect(state.blocks["doc-6-a"]?.proposal).toEqual(proposal);
  });

  it("does not let a fresh set of candidates inherit the last choice", () => {
    const before = withBlock("doc-6-a", found([1, 2, 3, 4]), 2);
    const after = proposalsReducer(before, {
      type: "search-settled",
      key: "doc-6-a",
      proposal: found([9, 10, 11, 12]),
    });
    expect(after.blocks["doc-6-a"]?.selected).toBeNull();
  });

  it("tracks two blocks searching at once", () => {
    const started = proposalsReducer(
      proposalsReducer(initialProposalsState, {
        type: "search-started",
        key: "doc-6-a",
      }),
      { type: "search-started", key: "doc-7-b" }
    );
    expect(started.searching).toEqual({ "doc-6-a": true, "doc-7-b": true });
  });

  // The second block's button must stay disabled while its own request runs,
  // or a second request for it would race the first over its preview files.
  it("leaves another block's search running when one settles", () => {
    const state = proposalsReducer(
      { blocks: {}, searching: { "doc-6-a": true, "doc-7-b": true } },
      { type: "search-settled", key: "doc-6-a", proposal: found([1]) }
    );
    expect(state.searching).toEqual({ "doc-7-b": true });
  });

  it("settles two concurrent searches independently, in either order", () => {
    const both: ProposalsState = {
      blocks: {},
      searching: { "doc-6-a": true, "doc-7-b": true },
    };
    const bFirst = proposalsReducer(
      proposalsReducer(both, {
        type: "search-settled",
        key: "doc-7-b",
        proposal: found([2]),
      }),
      { type: "search-settled", key: "doc-6-a", proposal: found([1]) }
    );
    expect(bFirst.searching).toEqual({});
    expect(Object.keys(bFirst.blocks).sort()).toEqual(["doc-6-a", "doc-7-b"]);
  });

  // Deleting or applying a block mid-search leaves an entry no tag can ask
  // for again, which is harmless — but the spinner must still be cleared.
  it("clears the spinner even if the block was dismissed mid-search", () => {
    const state = proposalsReducer(
      { blocks: {}, searching: { "doc-6-a": true } },
      { type: "search-settled", key: "doc-6-a", proposal: found([1]) }
    );
    expect(state.searching).toEqual({});
  });

  it("records the chosen candidate", () => {
    const state = proposalsReducer(withBlock("doc-6-a", found([1, 2, 3, 4])), {
      type: "candidate-selected",
      key: "doc-6-a",
      index: 3,
    });
    expect(state.blocks["doc-6-a"]?.selected).toBe(3);
  });

  it("keeps the candidates when one is chosen", () => {
    const proposal = found([1, 2, 3, 4]);
    const state = proposalsReducer(withBlock("doc-6-a", proposal), {
      type: "candidate-selected",
      key: "doc-6-a",
      index: 1,
    });
    expect(state.blocks["doc-6-a"]?.proposal).toEqual(proposal);
  });

  // A block that has no candidates has nothing to choose between, so a stray
  // selection must not conjure a record the grid would then try to render.
  it("ignores a choice for a block with no candidates", () => {
    const state = proposalsReducer(initialProposalsState, {
      type: "candidate-selected",
      key: "doc-6-a",
      index: 0,
    });
    expect(state).toBe(initialProposalsState);
  });

  it("drops the candidates and the choice together on dismiss", () => {
    const state = proposalsReducer(withBlock("doc-6-a", found([1, 2]), 1), {
      type: "dismissed",
      key: "doc-6-a",
    });
    expect(state.blocks["doc-6-a"]).toBeUndefined();
  });

  it("dismisses only the named block", () => {
    const before: ProposalsState = {
      blocks: {
        "doc-6-a": { proposal: found([1]), selected: 0 },
        "doc-7-b": { proposal: found([2]), selected: null },
      },
      searching: {},
    };
    const after = proposalsReducer(before, {
      type: "dismissed",
      key: "doc-6-a",
    });
    expect(Object.keys(after.blocks)).toEqual(["doc-7-b"]);
  });

  it("never mutates the state it is given", () => {
    const before = withBlock("doc-6-a", found([1, 2, 3, 4]), 1);
    const snapshot = structuredClone(before);
    proposalsReducer(before, {
      type: "candidate-selected",
      key: "doc-6-a",
      index: 3,
    });
    proposalsReducer(before, { type: "dismissed", key: "doc-6-a" });
    expect(before).toEqual(snapshot);
  });
});
