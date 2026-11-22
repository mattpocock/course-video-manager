import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialVideoFilePasteState,
  videoFilePasteReducer,
} from "./video-file-paste-reducer";
import { after } from "@/packages/clock";

/** Long enough for the dialog's content to be rendered before focusing it. */
const FOCUS_DELAY_MS = 100;

/**
 * The Paste from Clipboard dialog's effect runner for
 * `videoFilePasteReducer`. The file is created through a fetcher, so the
 * page's loaders revalidate and list it before the dialog reports it.
 */
export function useVideoFilePasteReducer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileCreated?: (path: string) => void;
}) {
  const fetcher = useFetcher<{ success: boolean; path: string }>();
  const pasteAreaRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  const [state, dispatch] = useEffectReducer<
    videoFilePasteReducer.State,
    videoFilePasteReducer.Action,
    videoFilePasteReducer.Effect
  >(videoFilePasteReducer, createInitialVideoFilePasteState(), {
    "focus-paste-area": () => {
      const timer = after(FOCUS_DELAY_MS, () => pasteAreaRef.current?.focus());
      return () => timer();
    },
    "focus-path-input": () => {
      const timer = after(FOCUS_DELAY_MS, () => {
        pathInputRef.current?.focus();
        pathInputRef.current?.select();
      });
      return () => timer();
    },
    "create-file": (_state, effect) => {
      const formData = new FormData();
      formData.append("videoId", effect.videoId);
      formData.append("path", effect.path);
      formData.append("content", effect.content);
      void fetcher.submit(formData, {
        method: "post",
        action: "/api/video-files/create",
        encType: "multipart/form-data",
      });
    },
    "close-modal": () => {
      props.onOpenChange(false);
    },
    "report-file-created": (_state, effect) => {
      props.onFileCreated?.(effect.path);
    },
  });

  // Bridges: the dialog opening, and the create request settling.
  useEffect(() => {
    if (props.open) dispatch({ type: "modal-opened" });
  }, [dispatch, props.open]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    dispatch(
      fetcher.data.success
        ? { type: "file-created", path: fetcher.data.path }
        : { type: "file-create-failed" }
    );
  }, [dispatch, fetcher.state, fetcher.data]);

  return { state, dispatch, pasteAreaRef, pathInputRef };
}
