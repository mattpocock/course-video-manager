import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  planStorageAction,
  startStorageAction,
} from "./storage-action-effects";
import { storageCache } from "./storage-cache";
import { hiddenRootsOf } from "./root-filter";
import { useWindowRefocus } from "./use-window-refocus";
import {
  STORAGE_SCAN_MESSAGE_TYPES,
  type StorageScanMessage,
} from "@/packages/storage/client";
import {
  createInitialStoragePageState,
  storagePageReducer,
} from "./storage-page-reducer";
import { nowMs } from "@/packages/clock";

/**
 * The `listen-to-scan` effect: listens to `GET /api/storage/scan` while the
 * page is open. Closing the stream (leaving the page, or the reducer stopping
 * the effect once the scan is over) is what stops the walk on the server.
 * The completion is stamped with the time, for the cache.
 */
const listenToScan = (
  dispatch: (action: storagePageReducer.Action) => void
) => {
  const source = new EventSource("/api/storage/scan");
  for (const type of STORAGE_SCAN_MESSAGE_TYPES) {
    source.addEventListener(type, (event) => {
      const message = JSON.parse(event.data) as StorageScanMessage;
      dispatch(
        message.type === "scan-completed"
          ? { type: "scan-completed", at: nowMs() }
          : message
      );
    });
  }
  // The server's own failure carries a message; a dropped connection does not.
  source.addEventListener("error", (event) => {
    const data = (event as MessageEvent).data;
    const message =
      typeof data === "string"
        ? (JSON.parse(data) as { message: string }).message
        : "The connection to the scan was lost";
    dispatch({ type: "scan-failed", message });
  });
  // A page kept in the back/forward cache would keep its stream (and the
  // walk) going: close it on the way out.
  const close = () => source.close();
  window.addEventListener("pagehide", close);
  return () => {
    window.removeEventListener("pagehide", close);
    source.close();
  };
};

/**
 * The effect runner for `storagePageReducer`, and the bridges that tell it
 * the page has opened (with what the Storage cache holds) and the window
 * has come back into focus.
 */
export const useStoragePage = () => {
  const [searchParams] = useSearchParams();
  const hiddenRoots = hiddenRootsOf(searchParams);
  const [state, dispatch] = useEffectReducer(
    storagePageReducer,
    createInitialStoragePageState(hiddenRoots),
    {
      "listen-to-scan": (_state, _effect, dispatch) => listenToScan(dispatch),
      "save-scan": (_state, effect) => storageCache.saveScan(effect.scan),
      "forget-listing": (_state, effect) =>
        storageCache.forgetListing(effect.bucketId),
      "plan-storage-action": (_state, effect, dispatch) =>
        planStorageAction(effect, dispatch),
      "start-storage-action": (_state, effect, dispatch) =>
        startStorageAction(effect, dispatch),
    }
  );
  useEffect(() => {
    dispatch({
      type: "page-opened",
      now: nowMs(),
      cached: storageCache.scan(),
    });
  }, [dispatch]);
  // The URL is where the Storage Root filter lives (#2431).
  const hiddenKey = hiddenRoots.join("\0");
  useEffect(() => {
    dispatch({
      type: "root-filter-changed",
      hidden: hiddenKey === "" ? [] : hiddenKey.split("\0"),
    });
  }, [dispatch, hiddenKey]);
  useWindowRefocus(dispatch);
  return [state, dispatch] as const;
};
