import { useContext, useEffect } from "react";
import { useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { UploadContext } from "@/features/upload-manager/upload-context";
import {
  createInitialImportedFootageState,
  importedFootageReducer,
  liveTranscriptions,
} from "./imported-footage-reducer";

type Dispatch = (action: importedFootageReducer.Action) => void;

/** The `reveal-file` effect: Explorer with the file selected. Only a failure is news. */
const revealFile = (
  effect: { location: string; path: string },
  dispatch: Dispatch
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
        message: error instanceof Error ? error.message : String(error),
      })
    );
};

/**
 * The effect runner for `importedFootageReducer`, and the bridge that tells
 * it which files the tab's Job Events say are being transcribed, only when
 * that (or what the page lists) changes.
 */
export const useImportedFootage = (listed: readonly string[]) => {
  const revalidator = useRevalidator();
  const [state, dispatch] = useEffectReducer(
    importedFootageReducer,
    createInitialImportedFootageState(),
    {
      "reload-footage": () => {
        void revalidator.revalidate();
      },
      "copy-path": (_state, effect, dispatch) => {
        navigator.clipboard.writeText(effect.path).then(
          () => dispatch({ type: "path-copied" }),
          () => dispatch({ type: "copy-path-failed" })
        );
      },
      "reveal-file": (_state, effect, dispatch) => revealFile(effect, dispatch),
      "show-toast": (_state, effect) => {
        if (effect.tone === "error") toast.error(effect.message);
        else toast(effect.message);
      },
    }
  );

  const { jobs } = useContext(UploadContext);
  const live = liveTranscriptions(Object.values(jobs.jobs));
  const key = JSON.stringify([live, listed]);
  useEffect(() => {
    dispatch({ type: "transcriptions-observed", live, listed });
    // Only when the live transcriptions or the listed files change: `key`
    // says exactly that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dispatch]);

  return [state, dispatch] as const;
};
