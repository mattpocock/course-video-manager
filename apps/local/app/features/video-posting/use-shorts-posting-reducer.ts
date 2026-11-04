import { useEffect } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { toast } from "@/components/ui/toast";
import type { PostedPlatforms } from "@/lib/short-status";
import { createShortLinks, generateText } from "./posting-requests";
import {
  createInitialShortsPostingState,
  shortsPostingReducer,
} from "./shorts-posting-reducer";

/** The Shorts modal's Posting Queue route: same origin, a quick call. */
const postToQueueRoute = (videoId: string, body: object) =>
  fetch(`/api/videos/${videoId}/posting-queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** The Shorts posting modal's effect runner for `shortsPostingReducer`. */
export function useShortsPostingReducer({
  open,
  onOpenChange,
  onQueued,
  videoId,
  videoTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQueued?: (videoId: string) => void;
  videoId: string;
  videoTitle: string;
}) {
  const [state, dispatch] = useEffectReducer<
    shortsPostingReducer.State,
    shortsPostingReducer.Action,
    shortsPostingReducer.Effect
  >(shortsPostingReducer, () => createInitialShortsPostingState(videoTitle), {
    "generate-text": (_state, effect, dispatch) => {
      generateText(effect.request)
        .then((text) =>
          dispatch({ type: "text-generated", field: effect.field, text })
        )
        .catch(() =>
          dispatch({ type: "text-generation-failed", field: effect.field })
        );
    },
    "load-posted-status": (_state, effect, dispatch) => {
      let cancelled = false;
      fetch(`/api/videos/${effect.videoId}/posted-status`)
        .then((res) => (res.ok ? res.json() : null))
        .then((postedStatus: PostedPlatforms | null) => {
          if (!cancelled && postedStatus) {
            dispatch({
              type: "posted-status-loaded",
              videoId: effect.videoId,
              postedStatus,
            });
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    },
    "load-queue-preview": (_state, effect, dispatch) => {
      fetch(`/api/videos/${effect.videoId}/posting-queue`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load the Posting Queue");
          const preview = (await res.json()) as {
            description: string;
            verdict: shortsPostingReducer.Verdict;
          };
          dispatch({
            type: "queue-preview-loaded",
            videoId: effect.videoId,
            ...preview,
          });
        })
        .catch(() =>
          dispatch({ type: "queue-preview-failed", videoId: effect.videoId })
        );
    },
    "rename-short": (_state, effect, dispatch) => {
      const formData = new FormData();
      formData.set("name", effect.name);
      fetch(`/api/videos/${effect.videoId}/rename`, {
        method: "POST",
        body: formData,
      })
        .then((res) => {
          if (res.ok) {
            dispatch({ type: "short-renamed", videoId: effect.videoId });
            return;
          }
          dispatch({
            type: "rename-refused",
            reason: res.status === 409 ? "name-taken" : "failed",
          });
        })
        .catch(() => dispatch({ type: "rename-refused", reason: "failed" }));
    },
    "save-description": (_state, effect, dispatch) => {
      postToQueueRoute(effect.videoId, {
        intent: "save-description",
        description: effect.description,
      })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to save the description");
          dispatch({
            type: "description-saved",
            videoId: effect.videoId,
            description: effect.description,
          });
        })
        .catch(() => dispatch({ type: "description-save-failed" }));
    },
    "add-to-posting-queue": (_state, effect, dispatch) => {
      postToQueueRoute(effect.videoId, {
        intent: "add",
        title: effect.title,
        description: effect.description,
      })
        .then(async (res) => {
          if (!res.ok) {
            dispatch({
              type: "add-to-queue-failed",
              reason: res.status === 409 ? "name-taken" : "failed",
            });
            return;
          }
          const { verdict } = (await res.json()) as {
            verdict: shortsPostingReducer.Verdict;
          };
          dispatch({
            type: "add-to-queue-answered",
            videoId: effect.videoId,
            verdict,
          });
        })
        .catch(() =>
          dispatch({ type: "add-to-queue-failed", reason: "failed" })
        );
    },
    "close-modal": () => {
      onOpenChange(false);
    },
    "report-queued": (_state, effect) => {
      onQueued?.(effect.videoId);
    },
    "create-short-links": (_state, effect, dispatch) => {
      createShortLinks(effect.urls, effect.linkDescription)
        .then((links) => dispatch({ type: "short-links-created", links }))
        .catch(() => dispatch({ type: "short-links-failed" }));
    },
    "show-toast": (_state, effect) => {
      toast(effect.title, { description: effect.description });
    },
    "show-error": (_state, effect) => {
      toast.error(effect.title);
    },
  });

  // Bridges: the modal opening, and the Short's title as the page has it.
  useEffect(() => {
    if (open) dispatch({ type: "modal-opened", videoId });
    else dispatch({ type: "modal-closed" });
  }, [dispatch, open, videoId]);

  useEffect(() => {
    dispatch({ type: "video-title-loaded", videoTitle });
  }, [dispatch, videoTitle]);

  return { state, dispatch };
}
