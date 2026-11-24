import type { SourceClipDuration } from "@/services/export-duration-check";

export const obsClipRow = (seconds: number): SourceClipDuration => ({
  videoFilename: "obs.mp4",
  sourceStartTime: 0,
  sourceEndTime: seconds,
  pauseType: "none",
  recordingSessionId: null,
  recordingSession: null,
  layers: [],
});

export const recorderClipRow = (seconds: number): SourceClipDuration => ({
  ...obsClipRow(seconds),
  videoFilename: "camera.mkv",
  recordingSessionId: "s1",
  recordingSession: {
    id: "s1",
    cameraFilePath: "camera.mkv",
    screenFilePath: "screen.mkv",
    micFilePath: "mic.mkv",
    micOffsetMs: 0,
    micEq: null,
    format: "landscape",
    screenCaptured: true,
    sceneEvents: [{ fileTime: 0, scene: "Camera" }],
  },
});
