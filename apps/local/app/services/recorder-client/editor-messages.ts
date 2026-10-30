import {
  previewPath,
  STILL_PATH,
  type RecorderState,
} from "recorder-service/protocol";
import {
  BUSY_STREAMING_ANOTHER_VIDEO,
  isStreamOn,
} from "recorder-service/stream-protocol";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";

/**
 * What an editor on `videoId` hears of the recorder's state, as the recorder
 * client (`client.server.ts`) passes it on: the camera, the scene and a
 * Short's screen. Each is undefined when there is nothing to say.
 */

/**
 * The recorder's status, as an editor on `videoId` hears it: what records
 * for it, and whether that is a streamed Recording Session. While another
 * Video is live, the recorder is busy streaming: this editor can neither
 * open nor stop it, and is told so (ADR 0055).
 */
export const recorderStatus = (
  videoId: string,
  o: {
    reachable: boolean;
    problem: string | null;
    starting: boolean;
    state: RecorderState;
    previews: { camera: string; screen: string };
    still: string;
  }
): CvmRecorderMessage => {
  const { state } = o;
  const ours = state.kind !== "closed" && state.videoId === videoId;
  const liveElsewhere =
    o.reachable && state.kind !== "closed" && !ours && isStreamOn(state.stream);
  return {
    type: "recorder-status",
    reachable: o.reachable,
    problem: o.problem ?? (liveElsewhere ? BUSY_STREAMING_ANOTHER_VIDEO : null),
    starting: o.starting,
    recordingSessionId:
      ours && state.kind === "recording" ? state.recordingSessionId : null,
    streamed: ours && state.kind === "recording" && isStreamOn(state.stream),
    previews: o.previews,
    still: o.still,
  };
};

/** The camera, as an editor on `videoId` hears it, from the recorder's state. */
export const cameraMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined => {
  if (state.kind === "recording" && state.videoId === videoId) return undefined;
  if (state.kind !== "open" || state.videoId !== videoId)
    return { type: "camera-closed" };
  const camera = state.camera;
  switch (camera.kind) {
    case "opening":
      return { type: "camera-opening", attempt: camera.attempt };
    case "live":
      return { type: "camera-went-live" };
    case "not-starting":
      return { type: "cam-link-not-starting", message: camera.message };
    case "busy":
      return { type: "cam-link-busy", message: camera.message };
  }
};

/** The scene, as an editor on `videoId` hears it, while the recorder is its. */
export const sceneMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined =>
  state.kind !== "closed" && state.videoId === videoId
    ? { type: "scene-changed", scene: state.scene }
    : undefined;

/** A Short's screen, as an editor on `videoId` hears it, while the recorder is its. */
export const screenMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined =>
  state.kind !== "closed" && state.videoId === videoId && state.screen
    ? { type: "screen-changed", screen: state.screen }
    : undefined;

/**
 * The Live Stream, as an editor on `videoId` hears it, while the recorder is
 * its: sent when the editor starts listening and whenever it changes.
 */
export const streamMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined =>
  state.kind !== "closed" && state.videoId === videoId
    ? { type: "stream-changed", stream: state.stream }
    : undefined;

/**
 * What an editor hears only while the recorder is its Video's, by kind,
 * each sent again whenever it changes.
 */
export const WHILE_OPEN_MESSAGES = {
  scene: sceneMessage,
  screen: screenMessage,
  stream: streamMessage,
} as const;

export type WhileOpenKind = keyof typeof WHILE_OPEN_MESSAGES;

/** Where an editor's browser finds the recorder service's previews and still. */
export const serviceUrls = (url: string) => {
  const http = url.replace(/^ws/, "http");
  return {
    previews: {
      camera: `${http}${previewPath("camera")}`,
      screen: `${http}${previewPath("screen")}`,
    },
    still: `${http}${STILL_PATH}`,
  };
};
