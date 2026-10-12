import { asc } from "drizzle-orm";
import { recordingSessionSceneEvents } from "../db/schema.js";

/**
 * The `recordingSession` relation a Clip is loaded with wherever its picture
 * is shown: a new-recorder Clip's Recording Session files, mic offset and
 * scene timeline — what the Clip Source module (`@/packages/clip-source`,
 * `ClipRecordingSession`) composites it from. Null on an OBS Clip.
 */
export const clipRecordingSessionRelation = {
  columns: {
    id: true,
    cameraFilePath: true,
    screenFilePath: true,
    micFilePath: true,
    micOffsetMs: true,
  },
  with: {
    sceneEvents: {
      columns: { fileTime: true, scene: true },
      orderBy: asc(recordingSessionSceneEvents.fileTime),
    },
  },
} as const;
