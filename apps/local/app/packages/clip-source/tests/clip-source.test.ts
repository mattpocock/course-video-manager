import { describe, expect, it } from "vitest";
import {
  drawInstructions,
  LAYOUT_VERSION,
  LAYOUT_VERSIONS,
} from "@/packages/scene-layout";
import {
  clipComposite,
  clipFrameFfmpegArgs,
  clipCompositePicture,
  clipFfmpegInput,
  clipFrame,
  clipLayers,
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
  recordingSessionId: null,
  sceneOverride: null,
  recordingSession: null,
  layers: [],
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
      leadingSilenceSeconds: 0,
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
      recordingSessionId: null,
      sceneOverride: null,
      recordingSession: null,
      layers: [],
    });
  });

  it("has no composite", () => {
    expect(clipComposite(source)).toBeNull();
  });

  it("is pictured by one Scene Layer", () => {
    expect(clipLayers(source)).toEqual([{ kind: "scene", volume: 1 }]);
  });
});

const SESSION_DIR = "/mnt/d/obs-recordings/2026-10-11T09-00-00 abcd1234";

const cvmRecorderClip = {
  ...obsClip,
  // A CVM-recorder Clip's Footage path is its mic file; its range is in the
  // picture's clock.
  videoFilename: `${SESSION_DIR}/mic.mkv`,
  sourceStartTime: 10,
  sourceEndTime: 14,
  recordingSessionId: "session-1",
  sceneOverride: null,
  recordingSession: {
    id: "session-1",
    cameraFilePath: `${SESSION_DIR}/camera.mkv`,
    screenFilePath: `${SESSION_DIR}/screen.mkv`,
    micFilePath: `${SESSION_DIR}/mic.mkv`,
    micOffsetMs: 150,
    format: "landscape" as const,
    screenCaptured: true,
    sceneEvents: [
      { fileTime: 0, scene: "Code" as const },
      { fileTime: 12, scene: "Camera" as const },
      { fileTime: 20, scene: "No Face" as const },
    ],
  },
};

describe("a CVM-recorder Clip's source", () => {
  const source = clipSource(cvmRecorderClip);

  it("is its Recording Session's files, scene segments and mic offset", () => {
    expect(source).toEqual({
      kind: "recording-session",
      recordingSessionId: "session-1",
      format: "landscape",
      files: {
        camera: `${SESSION_DIR}/camera.mkv`,
        screen: `${SESSION_DIR}/screen.mkv`,
        mic: `${SESSION_DIR}/mic.mkv`,
      },
      micOffsetSeconds: 0.15,
      micOffsetMs: 150,
      micEq: { lowDb: 0, midDb: 0, highDb: -6.1 },
      sceneEvents: [
        { scene: "Code", atSeconds: 0 },
        { scene: "Camera", atSeconds: 12 },
        { scene: "No Face", atSeconds: 20 },
      ],
      sceneOverride: null,
      segments: [
        { scene: "Code", startSeconds: 10, endSeconds: 12 },
        { scene: "Camera", startSeconds: 12, endSeconds: 14 },
      ],
      start: 10,
      end: 14,
      layers: [{ kind: "scene", volume: 1 }],
    });
  });

  it("is pictured by one Scene Layer", () => {
    expect(clipLayers(source)).toEqual([{ kind: "scene", volume: 1 }]);
  });

  it("is exported as the composite of its Session's files, mic EQ applied", () => {
    expect(clipComposite(source)).toEqual({
      format: "landscape",
      start: 10,
      screen: `${SESSION_DIR}/screen.mkv`,
      camera: `${SESSION_DIR}/camera.mkv`,
      mic: `${SESSION_DIR}/mic.mkv`,
      micOffsetSeconds: 0.15,
      eq: { lowDb: 0, midDb: 0, highDb: -6.1 },
      segments: [
        { scene: "Code", startSeconds: 10, endSeconds: 12 },
        { scene: "Camera", startSeconds: 12, endSeconds: 14 },
      ],
    });
    const micEq = { lowDb: 1, midDb: 0, highDb: 0 };
    const saved = clipSource({
      ...cvmRecorderClip,
      recordingSession: { ...cvmRecorderClip.recordingSession, micEq },
    });
    expect(clipComposite(saved)?.eq).toEqual(micEq);
  });

  it("composites past its end when its output runs longer (a long Pause)", () => {
    const composite = clipComposite(source, { durationSeconds: 12 });
    expect(composite?.segments.map((s) => s.scene)).toEqual([
      "Code",
      "Camera",
      "No Face",
    ]);
  });

  it("adds its composite's inputs to the Export Hash after the OBS keys", () => {
    expect(JSON.stringify(clipSourceHashFields(source))).toBe(
      JSON.stringify({
        f: `${SESSION_DIR}/mic.mkv`,
        s: 10,
        e: 14,
        rs: "session-1",
        sg: [
          ["Code", 10, 12],
          ["Camera", 12, 14],
        ],
        mo: 150,
        eq: [0, 0, -6.1],
        lv: LAYOUT_VERSION,
      })
    );
  });

  it("is drawn in its Scene Override for its whole length", () => {
    const overridden = clipSource({
      ...cvmRecorderClip,
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

  it("hands ffmpeg its mic, read the mic offset earlier", () => {
    expect(clipFfmpegInput(source)).toEqual({
      inputVideo: `${SESSION_DIR}/mic.mkv`,
      startTime: 9.85,
      duration: 4,
      leadingSilenceSeconds: 0,
    });
  });

  it("never asks ffmpeg to read the mic before it starts", () => {
    // Picture 0.05–4.05 is mic −0.1–3.95: the mic is silent for its first
    // 0.1 s, so it is read from 0 and the Clip's 4 s still stand.
    const early = clipSource({
      ...cvmRecorderClip,
      sourceStartTime: 0.05,
      sourceEndTime: 4.05,
    });
    expect(clipFfmpegInput(early)).toEqual({
      inputVideo: `${SESSION_DIR}/mic.mkv`,
      startTime: 0,
      duration: 4,
      leadingSilenceSeconds: 0.1,
    });
  });

  it("draws its picture from its camera and screen, in the picture's clock", () => {
    expect(clipCompositePicture(source, { from: 10, to: 14 })).toEqual({
      format: "landscape",
      camera: `/view-video?videoPath=${encodeURIComponent(`${SESSION_DIR}/camera.mkv`)}#t=10,14`,
      screen: `/view-video?videoPath=${encodeURIComponent(`${SESSION_DIR}/screen.mkv`)}#t=10,14`,
      segments: source.kind === "recording-session" ? source.segments : [],
    });
  });

  it("takes composited stills in the scene drawn at that moment", () => {
    const files = {
      format: "landscape",
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

const shortClip = {
  ...cvmRecorderClip,
  recordingSession: {
    ...cvmRecorderClip.recordingSession,
    format: "short" as const,
  },
};

const cameraOnlyShortClip = {
  ...shortClip,
  recordingSession: {
    ...shortClip.recordingSession,
    screenCaptured: false,
    sceneEvents: [{ fileTime: 0, scene: "Camera" as const }],
  },
};

describe("a CVM-recorder Short Clip's source", () => {
  it("adds its format after the Short layout's version to the Export Hash", () => {
    expect(JSON.stringify(clipSourceHashFields(clipSource(shortClip)))).toBe(
      JSON.stringify({
        f: `${SESSION_DIR}/mic.mkv`,
        s: 10,
        e: 14,
        rs: "session-1",
        sg: [
          ["Code", 10, 12],
          ["Camera", 12, 14],
        ],
        mo: 150,
        eq: [0, 0, -6.1],
        lv: LAYOUT_VERSIONS.short,
        vf: "short",
      })
    );
  });

  it("is composited in the Short layout", () => {
    expect(clipComposite(clipSource(shortClip))?.format).toBe("short");
    expect(clipFrame(clipSource(shortClip), "first")).toMatchObject({
      kind: "composite",
      format: "short",
      scene: "Code",
    });
  });

  it("never opens a screen that a camera-only session did not capture", () => {
    const source = clipSource(cameraOnlyShortClip);
    expect(clipComposite(source)?.screen).toBeNull();
    expect(clipCompositePicture(source, { from: 10, to: 14 })).toMatchObject({
      format: "short",
      screen: null,
    });
    const args = clipFrameFfmpegArgs(clipFrame(source, "first"), {
      seek: "10",
    });
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).toContain(`${SESSION_DIR}/camera.mkv`);
    expect(args).not.toContain(`${SESSION_DIR}/screen.mkv`);
  });

  it("leaves the screen out of a Camera-only Short picture it captured", () => {
    const source = clipSource({ ...shortClip, sceneOverride: "Camera" });
    expect(
      clipCompositePicture(source, { from: 10, to: 14 })?.screen
    ).toBeNull();
  });

  it("refuses to draw a screen scene on a camera-only session", () => {
    const source = clipSource({
      ...cameraOnlyShortClip,
      sceneOverride: "Code",
    });
    expect(() =>
      clipFrameFfmpegArgs(clipFrame(source, "first"), { seek: "10" })
    ).toThrow(/captured no screen/);
  });
});

/** The Export Hash fields as the address sees them (key order included). */
const hashOf = (...args: Parameters<typeof clipSource>) =>
  JSON.stringify(clipSourceHashFields(clipSource(...args)));

describe("a Clip's Scene Layer, drawn in its Video's format", () => {
  const onAShort = clipSource(cvmRecorderClip, { videoFormat: "short" });

  it("draws a Landscape session's Clip on a Short in the Short layout", () => {
    expect(clipComposite(onAShort)?.format).toBe("short");
    expect(clipFrame(onAShort, "first")).toMatchObject({
      kind: "composite",
      format: "short",
    });
    const picture = clipCompositePicture(onAShort, { from: 10, to: 14 })!;
    expect(picture.format).toBe("short");
    // Its 1920x1080 screen's left square on top, the camera band below,
    // the camera's crop carried over as fractions of its 2560x1440 frame.
    expect(
      drawInstructions(
        "Code",
        {
          screen: { width: 1920, height: 1080 },
          camera: { width: 2560, height: 1440 },
        },
        picture.format
      )
    ).toEqual([
      expect.objectContaining({
        source: "screen",
        sx: 0,
        sy: 0,
        sw: 1080,
        sh: 1080,
        dx: 0,
        dy: 0,
        dw: 1080,
        dh: 1080,
      }),
      expect.objectContaining({
        source: "camera",
        sx: 526,
        sy: 61,
        sw: 1445,
        sh: 1124,
        dx: 0,
        dy: 1080,
        dw: 1080,
        dh: 840,
      }),
    ]);
    const still = clipFrameFfmpegArgs(clipFrame(onAShort, "first"), {
      seek: "10",
    });
    expect(still.join(" ")).toContain("s=1080x1920");
  });

  it("re-addresses only the Clip it draws differently", () => {
    expect(hashOf(cvmRecorderClip, { videoFormat: "short" })).toBe(
      JSON.stringify({
        ...clipSourceHashFields(clipSource(cvmRecorderClip)),
        lv: LAYOUT_VERSIONS.short,
        vf: "short",
      })
    );
    // Landscape on Landscape, Short on Short: as before the Video's format.
    expect(hashOf(cvmRecorderClip, { videoFormat: "landscape" })).toBe(
      hashOf(cvmRecorderClip)
    );
    expect(hashOf(shortClip, { videoFormat: "short" })).toBe(hashOf(shortClip));
  });

  it("leaves a Short session's Clip on a Landscape Video as it is", () => {
    const onLandscape = clipSource(shortClip, { videoFormat: "landscape" });
    expect(clipComposite(onLandscape)?.format).toBe("short");
    expect(hashOf(shortClip, { videoFormat: "landscape" })).toBe(
      hashOf(shortClip)
    );
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
