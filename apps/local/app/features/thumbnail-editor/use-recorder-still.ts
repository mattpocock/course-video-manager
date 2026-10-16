import { useEffectReducer } from "use-effect-reducer";
import { useRecorderEvents } from "@/features/video-editor/use-cvm-recorder";
import {
  canCapture,
  createInitialRecorderStillState,
  recorderStillReducer,
} from "./recorder-still-reducer";

/** The size of a captured photo: the recorder service's still. */
export const STILL_WIDTH = 1280;
export const STILL_HEIGHT = 720;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Draws an image crop-to-cover onto a 1280x720 canvas, as a PNG data URL. */
const toPhoto = (image: ImageBitmap) => {
  const canvas = document.createElement("canvas");
  canvas.width = STILL_WIDTH;
  canvas.height = STILL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas to draw the still on.");
  const target = STILL_WIDTH / STILL_HEIGHT;
  const { width, height } = image;
  const sw = width / height > target ? height * target : width;
  const sh = width / height > target ? height : width / target;
  ctx.drawImage(
    image,
    (width - sw) / 2,
    (height - sh) / 2,
    sw,
    sh,
    0,
    0,
    STILL_WIDTH,
    STILL_HEIGHT
  );
  return canvas.toDataURL("image/png");
};

/**
 * The effect runner for `recorderStillReducer`: while mounted (the modal is
 * open) it hears the Video's recorder events, which keeps the recorder and
 * the Cam Link open, and it fetches stills straight from the recorder
 * service.
 */
export const useRecorderStill = (videoId: string) => {
  const [state, dispatch] = useEffectReducer(
    recorderStillReducer,
    createInitialRecorderStillState,
    {
      "take-still": (_state, effect, dispatch) => {
        fetch(effect.url, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            const image = await createImageBitmap(await response.blob());
            dispatch({ type: "still-taken", dataUrl: toPhoto(image) });
          })
          .catch((error: unknown) =>
            dispatch({
              type: "still-failed",
              message:
                error instanceof TypeError
                  ? `Could not reach the recorder service: ${error.message}`
                  : messageOf(error),
            })
          );
      },
      "retry-camera": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/retry-camera`, {
          method: "POST",
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
          })
          .catch((error: unknown) =>
            dispatch({ type: "retry-camera-failed", message: messageOf(error) })
          );
      },
    }
  );

  useRecorderEvents(videoId, true, (message) =>
    dispatch({ type: "recorder-message-heard", message })
  );

  return { state, dispatch, canCapture: canCapture(state) };
};
