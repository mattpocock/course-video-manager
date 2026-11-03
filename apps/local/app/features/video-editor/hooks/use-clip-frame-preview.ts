import { useEffect } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialClipFramePreviewState,
  clipFramePreview,
  clipFramePreviewReducer,
  type ClipFramePreview,
  type ClipFrameRequest,
} from "../clip-frame-preview-reducer";

/** HTTP's "Service Unavailable": the Still Gate held the frame. */
const STILL_HELD = 503;

/** The message a refused frame's response carries (a route's `data(text)`). */
const refusal = async (response: Response): Promise<string> => {
  const text = (await response.text()).trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Not JSON: the text is the message.
  }
  return text || `The frame could not be drawn (${response.status})`;
};

/**
 * The editor's effect runner (the Portrait Studio's and the Landscape
 * player's) for `clipFramePreviewReducer`: each
 * frame is one fetch of its route, shown from an object URL. `request` is
 * what the editor's playhead asks for (`clipFrameRequest`); a new one is
 * bridged to the reducer, which decides what to draw.
 */
export function useClipFramePreview(
  request: ClipFrameRequest | null
): ClipFramePreview {
  const [state, dispatch] = useEffectReducer<
    clipFramePreviewReducer.State,
    clipFramePreviewReducer.Action,
    clipFramePreviewReducer.Effect
  >(clipFramePreviewReducer, createInitialClipFramePreviewState(), {
    "draw-frame": (_state, { request }, dispatch) => {
      const { url } = request;
      void fetch(`/clips/${request.clipId}/frame?${request.search}`)
        .then(async (response) => {
          if (response.status === STILL_HELD) {
            dispatch({ type: "frame-held", url });
          } else if (!response.ok) {
            dispatch({
              type: "frame-failed",
              url,
              message: await refusal(response),
            });
          } else {
            const image = URL.createObjectURL(await response.blob());
            dispatch({ type: "frame-drawn", url, image });
          }
        })
        .catch((error: unknown) =>
          dispatch({
            type: "frame-failed",
            url,
            message: error instanceof Error ? error.message : String(error),
          })
        );
    },
    "release-frame-image": (_state, { image }) => URL.revokeObjectURL(image),
  });

  // Bridges the playhead's request to the reducer; it decides nothing.
  useEffect(() => {
    dispatch({ type: "frame-wanted", request });
  }, [dispatch, request]);

  return clipFramePreview(state);
}
