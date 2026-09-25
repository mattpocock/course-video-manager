"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  ClipMockupEditorEvent,
  ClipMockupListData,
  ClipMockupListRow,
  ClipMockupWriteResult,
} from "@/routes/api.clip-mockup-editor";

const ACTION = "/api/clip-mockup-editor";

/** What a row is currently waiting on, so it can say so. */
export type ClipMockupPending = {
  kind: "line" | "move" | "delete";
  clipMockupId: string;
};

/** A write that came back refused, pinned to the row it was aimed at. */
export type ClipMockupFailure = {
  clipMockupId: string;
  message: string;
};

/**
 * The video editor's Clip Mockup list, loaded and written without threading
 * anything through the editor — the same self-contained shape
 * {@link useVideoScript} uses for the Script tab, and for the same reason: an
 * Animatic is sixty rows of prose that the timeline has no use for.
 *
 * Every write is submitted to `/api/clip-mockup-editor` and the list is
 * reloaded when it lands. No optimistic applier, exactly like the Beats tab:
 * plain revalidation is enough, and a re-synthesis takes long enough that a
 * guessed duration would be a lie on screen for seconds.
 *
 * A REFUSED WRITE IS NOT AN EXCEPTION. It comes back as data and is kept
 * here against the row it was aimed at, so a failed synthesis shows on that
 * line instead of replacing the editor with an error page.
 */
export function useClipMockups(videoId: string, enabled = true) {
  const list = useFetcher<ClipMockupListData>();
  const write = useFetcher<ClipMockupWriteResult>();

  const [pending, setPending] = useState<ClipMockupPending | null>(null);
  const [failure, setFailure] = useState<ClipMockupFailure | null>(null);

  const pendingRef = useRef<ClipMockupPending | null>(null);
  const handledRef = useRef<unknown>(null);

  const url = `${ACTION}?videoId=${encodeURIComponent(videoId)}`;

  const load = list.load;
  useEffect(() => {
    if (enabled && list.state === "idle" && !list.data) load(url);
  }, [enabled, url, list.state, list.data, load]);

  useEffect(() => {
    if (write.state !== "idle" || !write.data) return;
    // The same response object stays on the fetcher after it settles; handle
    // each one exactly once or the reload below loops.
    if (handledRef.current === write.data) return;
    handledRef.current = write.data;

    const aimedAt = pendingRef.current;
    pendingRef.current = null;
    setPending(null);

    if (write.data.ok) {
      setFailure(null);
      load(url);
      return;
    }
    setFailure({
      clipMockupId: aimedAt?.clipMockupId ?? "",
      message: write.data.message,
    });
  }, [write.state, write.data, load, url]);

  const submitEvent = useCallback(
    (event: ClipMockupEditorEvent, kind: ClipMockupPending["kind"]) => {
      const next = { kind, clipMockupId: event.clipMockupId };
      pendingRef.current = next;
      setPending(next);
      setFailure(null);
      write.submit(event, {
        method: "post",
        encType: "application/json",
        action: ACTION,
      });
    },
    [write]
  );

  const setLine = useCallback(
    (clipMockupId: string, line: string) =>
      submitEvent(
        { type: "update-clip-mockup-line", clipMockupId, line },
        "line"
      ),
    [submitEvent]
  );

  const moveClipMockup = useCallback(
    (clipMockupId: string, beforeClipMockupId: string | null) =>
      submitEvent(
        { type: "move-clip-mockup", clipMockupId, beforeClipMockupId },
        "move"
      ),
    [submitEvent]
  );

  const deleteClipMockup = useCallback(
    (clipMockupId: string) =>
      submitEvent({ type: "delete-clip-mockup", clipMockupId }, "delete"),
    [submitEvent]
  );

  const clipMockups: ClipMockupListRow[] = list.data?.clipMockups ?? [];

  return {
    /** False until the first load lands — an empty list is a real answer. */
    loaded: list.data != null,
    clipMockups,
    pending,
    failure,
    setLine,
    moveClipMockup,
    deleteClipMockup,
  };
}
