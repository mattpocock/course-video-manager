/**
 * The app-wide Offline Storage Roots banner's X (#2558). A dismissal holds
 * until the page reloads, or until a Storage Root not dismissed goes
 * offline: one that comes back online is forgotten, so dropping offline
 * again brings the banner back.
 */
export namespace offlineRootsBannerReducer {
  export type State = {
    /** The Storage Roots offline when Matt dismissed the banner, still offline. */
    dismissed: readonly string[];
  };

  export type Action =
    | { type: "banner-dismissed"; roots: readonly string[] }
    /** The app layout's loader said which Storage Roots are offline now. */
    | { type: "offline-roots-heard"; roots: readonly string[] };
}

type State = offlineRootsBannerReducer.State;
type Action = offlineRootsBannerReducer.Action;

export const createInitialOfflineRootsBannerState = (): State => ({
  dismissed: [],
});

export const offlineRootsBannerReducer = (
  state: State,
  action: Action
): State => {
  switch (action.type) {
    case "banner-dismissed":
      return { dismissed: action.roots };
    case "offline-roots-heard": {
      const dismissed = state.dismissed.filter((root) =>
        action.roots.includes(root)
      );
      return dismissed.length === state.dismissed.length
        ? state
        : { dismissed };
    }
  }
};

/** The Offline Storage Roots the banner shows: all of them, or none once dismissed. */
export const offlineRootsShown = <T extends { root: string }>(
  state: State,
  offline: readonly T[]
): readonly T[] =>
  offline.every(({ root }) => state.dismissed.includes(root)) ? [] : offline;
