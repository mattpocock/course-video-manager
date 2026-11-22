import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendId,
  SessionId,
} from "./clip-state-reducer";
import { getRetranscribableClipIds } from "./video-editor-selectors";
import { now } from "@/packages/clock";

const onDatabase = (frontendId: string): ClipOnDatabase => ({
  type: "on-database",
  frontendId: frontendId as FrontendId,
  databaseId: `db-${frontendId}` as ClipOnDatabase["databaseId"],
  videoFilename: "video.mp4",
  sourceStartTime: 0,
  sourceEndTime: 5,
  text: "hello world",
  transcribedAt: now(),
  transcriptionStatus: "done",
  scene: null,
  profile: null,
  insertionOrder: null,
  pauseType: "none",
  zoomType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  webLinks: [],
});

const optimistic = (frontendId: string): ClipOptimisticallyAdded => ({
  type: "optimistically-added",
  frontendId: frontendId as FrontendId,
  scene: "Camera",
  profile: "Default",
  insertionOrder: 0,
  pauseType: "none",
  soundDetectionId: "sd-1",
  sessionId: "test-session" as SessionId,
});

describe("getRetranscribableClipIds", () => {
  it("skips a clip still being written, which has no id to transcribe by", () => {
    expect(
      getRetranscribableClipIds([
        onDatabase("a"),
        optimistic("pending"),
        onDatabase("b"),
      ])
    ).toEqual(["a", "b"]);
  });
});
