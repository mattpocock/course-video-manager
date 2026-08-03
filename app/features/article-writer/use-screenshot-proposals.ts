import { useCallback, useReducer, type RefObject } from "react";
import { chooseScreenshotKey } from "./choose-screenshot-md";
import { extractSurroundingText } from "./screenshot-surrounding-text";
import type { IndexedClip, ScreenshotProposal } from "./types";

/** What one ChooseScreenshot block has been offered, and what was chosen. */
interface BlockProposal {
  proposal: ScreenshotProposal;
  /** Index into `proposal.candidates`, or null before anything is picked. */
  selected: number | null;
}

export interface ProposalsState {
  /** Keyed by `doc-<clipIndex>-<alt>`. */
  blocks: Record<string, BlockProposal>;
  /**
   * Every block with a search in flight, keyed the same way.
   *
   * A set rather than a single key because nothing stops Matt starting one
   * block's search and then another's, and a single slot would drop the first
   * block back to an idle button while its request was still running. That is
   * worse than a missing spinner: the button being live again allows a second
   * request for the same block, and the two would then race over that block's
   * preview directory — the later one wiping it while the earlier one is still
   * capturing into it. Keeping the button disabled is what rules that out.
   */
  searching: Record<string, true>;
}

export type ProposalsAction =
  | { type: "search-started"; key: string }
  | { type: "search-settled"; key: string; proposal: ScreenshotProposal }
  | { type: "dismissed"; key: string }
  | { type: "candidate-selected"; key: string; index: number };

export const initialProposalsState: ProposalsState = {
  blocks: {},
  searching: {},
};

export function proposalsReducer(
  state: ProposalsState,
  action: ProposalsAction
): ProposalsState {
  switch (action.type) {
    case "search-started":
      return {
        ...state,
        searching: { ...state.searching, [action.key]: true },
      };

    // The candidates and the choice are one record, so a new set of candidates
    // cannot inherit the last set's choice — replacing the record is what
    // clears it. Only this block stops searching; any other block's search is
    // still running and keeps its spinner.
    case "search-settled": {
      const { [action.key]: _done, ...searching } = state.searching;
      return {
        blocks: {
          ...state.blocks,
          [action.key]: { proposal: action.proposal, selected: null },
        },
        searching,
      };
    }

    case "dismissed": {
      const { [action.key]: _removed, ...rest } = state.blocks;
      return { ...state, blocks: rest };
    }

    case "candidate-selected": {
      const block = state.blocks[action.key];
      if (!block) return state;
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [action.key]: { ...block, selected: action.index },
        },
      };
    }
  }
}

export interface UseScreenshotProposalsProps {
  videoId: string;
  indexedClips: IndexedClip[];
  documentRef: RefObject<string | undefined>;
}

/**
 * Screenshot candidates for the document's ChooseScreenshot blocks.
 *
 * Nothing here touches the document. Candidates are held in state, previewed
 * from a scratch directory, and applied through the block's ordinary capture
 * path — so pressing "Find it" and walking away changes nothing, and a
 * candidate sitting in a neighbouring clip needs no rewrite of the tag to be
 * previewed. They are also deliberately not persisted: a reload just means
 * asking again.
 *
 * State is keyed by block rather than held inside it, so that a document edit
 * which re-parses the preview and remounts the block does not throw away the
 * grid or the choice just made. Entries for tags that have since been applied,
 * deleted or rewritten are simply never read again — a block only asks for its
 * own key, so a tag that no longer exists cannot ask — and they die with the
 * page. The preview files behind them are keyed per block for the same reason.
 */
export function useScreenshotProposals({
  videoId,
  indexedClips,
  documentRef,
}: UseScreenshotProposalsProps) {
  const [state, dispatch] = useReducer(proposalsReducer, initialProposalsState);

  const findScreenshot = useCallback(
    async (clipIndex: number, alt: string) => {
      const key = chooseScreenshotKey(clipIndex, alt);
      dispatch({ type: "search-started", key });
      try {
        const res = await fetch(`/api/videos/${videoId}/propose-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alt,
            clipIndex,
            clips: indexedClips,
            surroundingText: extractSurroundingText(
              documentRef.current ?? "",
              clipIndex,
              alt
            ),
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to propose screenshot");
        }
        const proposal: ScreenshotProposal = await res.json();
        dispatch({ type: "search-settled", key, proposal });
      } catch (err) {
        console.error("Screenshot proposal failed:", err);
        dispatch({
          type: "search-settled",
          key,
          proposal: {
            found: false,
            reason: err instanceof Error ? err.message : "Unknown error",
          },
        });
      }
    },
    [videoId, indexedClips, documentRef]
  );

  const dismissProposal = useCallback((clipIndex: number, alt: string) => {
    dispatch({ type: "dismissed", key: chooseScreenshotKey(clipIndex, alt) });
  }, []);

  const selectCandidate = useCallback(
    (clipIndex: number, alt: string, index: number) => {
      dispatch({
        type: "candidate-selected",
        key: chooseScreenshotKey(clipIndex, alt),
        index,
      });
    },
    []
  );

  const proposalFor = useCallback(
    (clipIndex: number, alt: string) =>
      state.blocks[chooseScreenshotKey(clipIndex, alt)]?.proposal,
    [state.blocks]
  );

  const selectionFor = useCallback(
    (clipIndex: number, alt: string) =>
      state.blocks[chooseScreenshotKey(clipIndex, alt)]?.selected ?? null,
    [state.blocks]
  );

  const isProposingFor = useCallback(
    (clipIndex: number, alt: string) =>
      state.searching[chooseScreenshotKey(clipIndex, alt)] === true,
    [state.searching]
  );

  return {
    findScreenshot,
    dismissProposal,
    proposalFor,
    isProposingFor,
    selectionFor,
    selectCandidate,
  };
}
