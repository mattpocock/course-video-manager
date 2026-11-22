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
  STORAGE_BUCKET_FILES_MESSAGE_TYPES,
  type StorageBucketFilesMessage,
} from "@/packages/storage/client";
import {
  bucketPageReducer,
  createInitialBucketPageState,
} from "./bucket-page-reducer";
import { nowMs } from "@/packages/clock";

/**
 * The `listen-to-listing` effect: listens to the bucket's listing while the
 * page is open. Closing the stream (leaving the page, or the reducer stopping
 * the effect once the listing is over) is what stops the walk on the server.
 * The completion is stamped with the time, for the cache.
 */
const listenToListing = (
  bucketId: string,
  dispatch: (action: bucketPageReducer.Action) => void
) => {
  const source = new EventSource(
    `/api/storage/buckets/${encodeURIComponent(bucketId)}/files`
  );
  for (const type of STORAGE_BUCKET_FILES_MESSAGE_TYPES) {
    source.addEventListener(type, (event) => {
      const message = JSON.parse(event.data) as StorageBucketFilesMessage;
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
        : "The connection to the listing was lost";
    dispatch({ type: "listing-failed", message });
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
 * The `reveal-file` effect: Show in Explorer. Only a failure is news.
 */
const revealFile = (
  effect: { location: string; path: string },
  dispatch: (action: bucketPageReducer.Action) => void
) => {
  fetch("/api/storage/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: effect.location, path: effect.path }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
    })
    .catch((error: unknown) =>
      dispatch({
        type: "reveal-failed",
        message: `Could not show it in Explorer: ${error instanceof Error ? error.message : String(error)}`,
      })
    );
};

/**
 * The effect runner for `bucketPageReducer`, and the bridges that tell it
 * the page has opened (with what the Storage cache holds for the bucket)
 * and the window has come back into focus. Remount it for another bucket.
 */
export const useBucketPage = (bucketId: string) => {
  const [searchParams] = useSearchParams();
  const hiddenRoots = hiddenRootsOf(searchParams);
  const [state, dispatch] = useEffectReducer(
    bucketPageReducer,
    createInitialBucketPageState(bucketId, hiddenRoots),
    {
      "listen-to-listing": (_state, effect, dispatch) =>
        listenToListing(effect.bucketId, dispatch),
      "save-listing": (_state, effect) =>
        storageCache.saveListing(effect.bucketId, effect.listing),
      "forget-from-scan": (_state, effect) =>
        storageCache.forgetFromScan(effect.bucketId, effect.removed),
      "forget-scan": () => storageCache.forgetScan(),
      "reveal-file": (_state, effect, dispatch) => revealFile(effect, dispatch),
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
      cached: storageCache.listing(bucketId),
    });
  }, [dispatch, bucketId]);
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
