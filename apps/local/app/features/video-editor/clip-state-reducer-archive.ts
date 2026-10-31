import type { clipStateReducer } from "./clip-state-reducer";
import type {
  FrontendId,
  FrontendInsertionPoint,
} from "./clip-state-reducer.types";
import { archiveClips } from "./clip-state-reducer.helpers";
import { DELETED_CLIPS_SESSION_ID } from "./video-editor-selectors";

type State = clipStateReducer.State;
type Action = clipStateReducer.Action;
type Exec = Parameters<typeof clipStateReducer>[2];
type Item = State["items"][number];

type ClipsDeleted = Extract<Action, { type: "clips-deleted" }>;
type PermanentlyRemoveArchived = Extract<
  Action,
  { type: "permanently-remove-archived" }
>;

/** Archive these items, firing the archive effects for whatever it marked. */
const archiveAndExec = (state: State, ids: FrontendId[], exec: Exec): State => {
  const { items, clipsToArchive, chaptersToArchive, insertionPoint } =
    archiveClips(state.items, ids, state.insertionPoint);

  if (clipsToArchive.size > 0) {
    exec({ type: "archive-clips", clipIds: Array.from(clipsToArchive) });
  }
  if (chaptersToArchive.size > 0) {
    exec({
      type: "archive-chapters",
      chapterIds: Array.from(chaptersToArchive),
    });
  }
  return { ...state, items, insertionPoint };
};

export const handleClipsDeleted = (
  state: State,
  action: ClipsDeleted,
  exec: Exec
): State => archiveAndExec(state, action.clipIds, exec);

/** The item the insertion point sits after, when the point is mid-timeline. */
const idAfterInsertionPoint = (
  insertionPoint: Extract<
    FrontendInsertionPoint,
    { type: "after-clip" | "after-chapter" }
  >
): FrontendId =>
  insertionPoint.type === "after-clip"
    ? insertionPoint.frontendClipId
    : insertionPoint.frontendChapterId;

export const handleDeleteLatestInsertedClip = (
  state: State,
  exec: Exec
): State => {
  if (state.insertionPoint.type === "start") {
    return state;
  }

  if (state.insertionPoint.type === "end") {
    // Skip clips already marked for archive so repeated stream deck
    // presses continue deleting backwards through the timeline
    const lastClip = state.items.findLast(
      (c) => !("shouldArchive" in c && c.shouldArchive)
    );

    if (!lastClip) {
      return state;
    }
    return archiveAndExec(state, [lastClip.frontendId], exec);
  }

  return archiveAndExec(
    state,
    [idAfterInsertionPoint(state.insertionPoint)],
    exec
  );
};

const removeItems = (state: State, itemsToRemove: Item[]): State => {
  if (itemsToRemove.length === 0) {
    return state;
  }

  const idsToRemove = new Set(itemsToRemove.map((i) => i.frontendId));

  return {
    ...state,
    items: state.items.filter((item) => !idsToRemove.has(item.frontendId)),
  };
};

const isRemovableFromSession = (
  item: Item,
  sessionId: PermanentlyRemoveArchived["sessionId"],
  isDeletedClipsPanel: boolean
): boolean => {
  if (
    item.type === "optimistically-added" &&
    (item.shouldArchive || item.isOrphaned) &&
    !isDeletedClipsPanel &&
    item.sessionId === sessionId
  ) {
    return true;
  }
  if (item.type === "on-database" && item.shouldArchive) {
    if (isDeletedClipsPanel) {
      return !item.sessionId;
    }
    return item.sessionId === sessionId;
  }
  return false;
};

export const handlePermanentlyRemoveArchived = (
  state: State,
  action: PermanentlyRemoveArchived
): State => {
  const isDeletedClipsPanel = action.sessionId === DELETED_CLIPS_SESSION_ID;
  return removeItems(
    state,
    state.items.filter((item) =>
      isRemovableFromSession(item, action.sessionId, isDeletedClipsPanel)
    )
  );
};

const isRemovable = (item: Item): boolean => {
  if (
    item.type === "optimistically-added" &&
    (item.shouldArchive || item.isOrphaned)
  ) {
    return true;
  }
  if (item.type === "on-database" && item.shouldArchive) {
    return true;
  }
  return false;
};

export const handlePermanentlyRemoveAllArchived = (state: State): State =>
  removeItems(state, state.items.filter(isRemovable));
