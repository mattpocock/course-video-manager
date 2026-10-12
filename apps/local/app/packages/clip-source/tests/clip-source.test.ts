import { describe, expect, it } from "vitest";
import {
  clipCompositePicture,
  clipFfmpegInput,
  clipFrame,
  clipPlaybackClock,
  clipPlaybackUrl,
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
} from "../index";

const OBS_FILE = "/mnt/d/obs-recordings/2026-10-01 09-14-02.mkv";

const obsClip = {
  id: "clip-1",
  videoFilename: OBS_FILE,
  sourceStartTime: 12.5,
  sourceEndTime: 19.75,
  text: "Hello there",
};

describe("an OBS Clip's source", () => {
  const source = clipSource(obsClip);

  it("plays its own range of its Footage file", () => {
    expect(clipPlaybackUrl(source, { from: 12.4, to: 19.69 })).toBe(
      `/view-video?videoPath=${encodeURIComponent(OBS_FILE)}#t=12.4,19.69`
    );
  });

  it("takes its stills from its Footage file", () => {
    expect(clipFrame(source, "first")).toEqual({
      kind: "footage",
      inputVideo: OBS_FILE,
      time: 12.5,
    });
    // A tenth of a second short of the end: the very last frame of a cut is
    // often the next take's first.
    expect(clipFrame(source, "last")).toEqual({
      kind: "footage",
      inputVideo: OBS_FILE,
      time: 19.65,
    });
    expect(clipFrame(source, 15)).toEqual({
      kind: "footage",
      inputVideo: OBS_FILE,
      time: 15,
    });
  });

  it("hands ffmpeg its Footage file, start and duration", () => {
    expect(clipFfmpegInput(source)).toEqual({
      inputVideo: OBS_FILE,
      startTime: 12.5,
      duration: 7.25,
    });
  });

  it("contributes its file and range to the Export Hash, in that order", () => {
    expect(JSON.stringify(clipSourceHashFields(source))).toBe(
      JSON.stringify({ f: OBS_FILE, s: 12.5, e: 19.75 })
    );
  });

  it("is read from exactly the columns that define it", () => {
    expect(clipSourceColumns(obsClip)).toEqual({
      videoFilename: OBS_FILE,
      sourceStartTime: 12.5,
      sourceEndTime: 19.75,
    });
  });
});

const SESSION_DIR = "/mnt/d/obs-recordings/2026-10-11T09-00-00 abcd1234";

const newRecorderClip = {
  ...obsClip,
  // A new-recorder Clip's Footage path is its mic file; its range is in the
  // picture's clock.
  videoFilename: `${SESSION_DIR}/mic.mkv`,
  sourceStartTime: 10,
  sourceEndTime: 14,
  sceneOverride: null,
  recordingSession: {
    id: "session-1",
    cameraFilePath: `${SESSION_DIR}/camera.mkv`,
    screenFilePath: `${SESSION_DIR}/screen.mkv`,
    micFilePath: `${SESSION_DIR}/mic.mkv`,
    micOffsetMs: 150,
    sceneEvents: [
      { fileTime: 0, scene: "Code" as const },
      { fileTime: 12, scene: "Camera" as const },
      { fileTime: 20, scene: "No Face" as const },
    ],
  },
};

describe("a new-recorder Clip's source", () => {
  const source = clipSource(newRecorderClip);

  it("is its Recording Session's files, scene segments and mic offset", () => {
    expect(source).toEqual({
      kind: "recording-session",
      recordingSessionId: "session-1",
      files: {
        camera: `${SESSION_DIR}/camera.mkv`,
        screen: `${SESSION_DIR}/screen.mkv`,
        mic: `${SESSION_DIR}/mic.mkv`,
      },
      micOffsetSeconds: 0.15,
      segments: [
        { scene: "Code", startSeconds: 10, endSeconds: 12 },
        { scene: "Camera", startSeconds: 12, endSeconds: 14 },
      ],
      start: 10,
      end: 14,
    });
  });

  it("is drawn in its Scene Override for its whole length", () => {
    const overridden = clipSource({
      ...newRecorderClip,
      sceneOverride: "No Face",
    });
    expect(
      overridden.kind === "recording-session" && overridden.segments
    ).toEqual([{ scene: "No Face", startSeconds: 10, endSeconds: 14 }]);
  });

  it("plays its mic as the clock, read the mic offset earlier", () => {
    expect(clipPlaybackUrl(source, { from: 10, to: 14 })).toBe(
      `/view-video?videoPath=${encodeURIComponent(`${SESSION_DIR}/mic.mkv`)}#t=9.85,13.85`
    );
    expect(clipPlaybackClock(source)).toEqual({ offsetSeconds: 0.15 });
  });

  it("draws its picture from its camera and screen, in the picture's clock", () => {
    expect(clipCompositePicture(source, { from: 10, to: 14 })).toEqual({
      camera: `/view-video?videoPath=${encodeURIComponent(`${SESSION_DIR}/camera.mkv`)}#t=10,14`,
      screen: `/view-video?videoPath=${encodeURIComponent(`${SESSION_DIR}/screen.mkv`)}#t=10,14`,
      segments: source.kind === "recording-session" ? source.segments : [],
    });
  });

  it("takes composited stills in the scene drawn at that moment", () => {
    const files = {
      screen: `${SESSION_DIR}/screen.mkv`,
      camera: `${SESSION_DIR}/camera.mkv`,
    };
    expect(clipFrame(source, "first")).toEqual({
      kind: "composite",
      ...files,
      scene: "Code",
      time: 10,
    });
    expect(clipFrame(source, "last")).toEqual({
      kind: "composite",
      ...files,
      scene: "Camera",
      time: 13.9,
    });
    expect(clipFrame(source, 11.5)).toMatchObject({
      scene: "Code",
      time: 11.5,
    });
  });
});

describe("an OBS Clip that has no Recording Session", () => {
  it("is still its Footage file, played and stilled as before", () => {
    const source = clipSource({ ...obsClip, recordingSession: null });
    expect(source.kind).toBe("footage");
    expect(clipPlaybackClock(source)).toEqual({ offsetSeconds: 0 });
    expect(clipCompositePicture(source, { from: 12, to: 19 })).toBeNull();
  });
});
