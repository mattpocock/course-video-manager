import { CANVASES, type Scene } from "@/packages/scene-layout";
import type { VideoFormat } from "@/features/videos/video-format";
import { holdsStillsOf, type cvmRecorderReducer } from "./cvm-recorder-reducer";

/**
 * The editor's live frame: the CVM recorder's composite drawn from its H.264
 * preview feeds, with the capture badge, ring, recording signal and centre
 * line (fed by `recorder-capture.ts`), and the previous Clip's last frame
 * over it.
 */

/** The CVM recorder's composite, as the live frame draws it. */
export type CvmRecorderLivePreview = {
  previews: { camera: string; screen: string };
  scene: Scene;
  /** The layout drawn: a Short's is 9:16, in a portrait frame. */
  format: VideoFormat;
  canvas: { width: number; height: number };
  /** Whether the camera feed has anything to show (the Cam Link is live or recording). */
  cameraShowing: boolean;
  /** Changes when the camera comes back, so its stream reconnects. */
  cameraKey: string;
  /** The Camera scene gets a framing guide. */
  showCenterLine: boolean;
};

/**
 * The composite the live frame draws, or null while the recorder has nothing
 * to show for this Video (not reachable, not open, scene not yet known).
 */
export const getCvmRecorderLivePreview = (
  state: cvmRecorderReducer.State
): CvmRecorderLivePreview | null => {
  if (state.reachable !== true || !state.previews || !state.scene) return null;
  return {
    previews: state.previews,
    scene: state.scene,
    format: state.format,
    canvas: CANVASES[state.format],
    cameraShowing: state.camera.kind === "live" || state.phase !== "idle",
    cameraKey: state.camera.kind,
    showCenterLine: state.scene === "Camera",
  };
};

/**
 * Is there a live picture? While there is, a paused editor shows it instead
 * of the Clip player.
 */
export const getHasLivePreview = (
  cvmRecorder: cvmRecorderReducer.State
): boolean => getCvmRecorderLivePreview(cvmRecorder) !== null;

/**
 * Where the live preview's last-frame overlay (the previous Clip's last
 * frame at half opacity, to match position between takes) comes from:
 * - `still`: the Clip's saved last-frame still, decoded by the app server.
 * - `take-end`: its Recording Session is still recording, so its still is
 *   held (`holdsStillsOf`, #2560: decoding the growing take cost the
 *   camera frames). The editor shows the live preview's own picture from
 *   the moment that take's speech ended instead: the browser already has
 *   it, so the capture pays nothing (Matt, 2026-11-04).
 * - `none`: a Live Stream (a streamed Recording Session) shows no overlay.
 */
export const lastFrameSource = (
  state: cvmRecorderReducer.State,
  clip: { recordingSession?: { id: string } | null }
): "still" | "take-end" | "none" => {
  if (state.streamed) return "none";
  return holdsStillsOf(state, clip) ? "take-end" : "still";
};
