import {
  sceneFilterGraph,
  sceneSegments,
  type Scene,
  type SceneSegment,
} from "@/packages/scene-layout";

/**
 * The persisted columns a Clip's picture and sound are read from. Every Clip
 * row carries them; nothing outside this package should read them for picture
 * or sound — it asks a {@link ClipSource} instead.
 */
export type ClipSourceColumns = {
  readonly videoFilename: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
};

/**
 * A new-recorder Clip's Recording Session, as loaded with the Clip (the
 * `recordingSession` relation with its `sceneEvents`). Scene event times are
 * the picture's file time.
 */
export type ClipRecordingSession = {
  readonly id: string;
  readonly cameraFilePath: string;
  readonly screenFilePath: string;
  readonly micFilePath: string;
  readonly micOffsetMs: number;
  readonly sceneEvents: readonly {
    readonly fileTime: number;
    readonly scene: Scene;
  }[];
};

/**
 * Everything `clipSource` reads off a Clip row. A row loaded without its
 * Recording Session (or an OBS Clip, whose relation is null) answers as a
 * single Footage file.
 */
export type ClipSourceRow = ClipSourceColumns & {
  readonly recordingSession?: ClipRecordingSession | null;
  readonly sceneOverride?: Scene | null;
};

/**
 * Where a Clip's picture and sound come from. The variants are this package's
 * business; readers hand a ClipSource back to the functions below and never
 * look inside it.
 *
 * - `footage`: an OBS Clip — one Footage file cut between a start and an end.
 * - `recording-session`: a new-recorder Clip — camera, screen and mic files
 *   of one Recording Session. `start`/`end` and the segments are in the
 *   picture's clock; the mic is read `micOffsetSeconds` earlier.
 */
export type ClipSource =
  | {
      readonly kind: "footage";
      readonly footagePath: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: "recording-session";
      readonly recordingSessionId: string;
      readonly files: {
        readonly camera: string;
        readonly screen: string;
        readonly mic: string;
      };
      readonly micOffsetSeconds: number;
      readonly segments: readonly SceneSegment[];
      readonly start: number;
      readonly end: number;
    };

/**
 * One still of a Clip's picture: a frame of a Footage file, or the composite
 * drawn from a Recording Session's screen and camera in one scene.
 */
export type ClipFrame =
  | {
      readonly kind: "footage";
      readonly inputVideo: string;
      readonly time: number;
    }
  | {
      readonly kind: "composite";
      readonly screen: string;
      readonly camera: string;
      readonly scene: Scene;
      readonly time: number;
    };

/** One Clip as an input to the ffmpeg encode/transcribe pipelines. */
export type ClipFfmpegInput = {
  readonly inputVideo: string;
  readonly startTime: number;
  readonly duration: number;
};

/**
 * How far before the end of a Clip its last-frame still is taken: the very
 * last frame of a cut is often already the next take.
 */
const LAST_FRAME_INSET_SECONDS = 0.1;

export const clipSourceColumns = (
  row: ClipSourceColumns
): ClipSourceColumns => ({
  videoFilename: row.videoFilename,
  sourceStartTime: row.sourceStartTime,
  sourceEndTime: row.sourceEndTime,
});

export const clipSource = (row: ClipSourceRow): ClipSource => {
  const start = row.sourceStartTime;
  const end = row.sourceEndTime;
  const session = row.recordingSession;
  if (!session) {
    return { kind: "footage", footagePath: row.videoFilename, start, end };
  }
  return {
    kind: "recording-session",
    recordingSessionId: session.id,
    files: {
      camera: session.cameraFilePath,
      screen: session.screenFilePath,
      mic: session.micFilePath,
    },
    micOffsetSeconds: session.micOffsetMs / 1000,
    segments: sceneSegments({
      events: session.sceneEvents.map((e) => ({
        scene: e.scene,
        atSeconds: e.fileTime,
      })),
      clip: { startSeconds: start, endSeconds: end },
      override: row.sceneOverride ?? null,
    }),
    start,
    end,
  };
};

/** Rounds away float noise from subtracting the mic offset (9.850000001). */
const tidy = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/**
 * The media element that clocks playback, and how its time maps to the
 * Clip's: source time = clock `currentTime` + `offsetSeconds`. An OBS Clip's
 * clock is its Footage (offset 0); a new-recorder Clip's is its mic, which is
 * read `micOffsetSeconds` earlier than the picture.
 */
export const clipPlaybackClock = (
  source: ClipSource
): { offsetSeconds: number } => ({
  offsetSeconds: source.kind === "footage" ? 0 : source.micOffsetSeconds,
});

/**
 * The URL the playback clock (a `<video>`) plays, cued to `from`–`to` (source
 * time, as a media fragment in the clock's own time).
 */
export const clipPlaybackUrl = (
  source: ClipSource,
  range: { readonly from: number; readonly to: number }
): string => {
  if (source.kind === "footage") {
    return viewVideoUrl(source.footagePath, range.from, range.to);
  }
  const offset = source.micOffsetSeconds;
  return viewVideoUrl(
    source.files.mic,
    tidy(range.from - offset),
    tidy(range.to - offset)
  );
};

const viewVideoUrl = (file: string, from: number, to: number) =>
  `/view-video?videoPath=${encodeURIComponent(file)}#t=${from},${to}`;

/**
 * A new-recorder Clip's picture, for the composite playback canvas: its
 * camera and screen cued to `from`–`to` (source time; they share the
 * picture's clock) and the scene segments to draw them in. Null for an OBS
 * Clip, whose clock is its picture.
 */
export const clipCompositePicture = (
  source: ClipSource,
  range: { readonly from: number; readonly to: number }
): {
  readonly camera: string;
  readonly screen: string;
  readonly segments: readonly SceneSegment[];
} | null =>
  source.kind === "footage"
    ? null
    : {
        camera: viewVideoUrl(source.files.camera, range.from, range.to),
        screen: viewVideoUrl(source.files.screen, range.from, range.to),
        segments: source.segments,
      };

/**
 * The scene a run of segments draws at a source time: before the first
 * segment its scene, after the last segment its scene.
 */
export const sceneAt = (
  segments: readonly SceneSegment[],
  time: number
): Scene =>
  (
    segments.find((s) => time >= s.startSeconds && time < s.endSeconds) ??
    (time < segments[0]!.startSeconds ? segments[0]! : segments.at(-1)!)
  ).scene;

/** The first frame, the last frame, or the frame at a source time. */
export const clipFrame = (
  source: ClipSource,
  at: "first" | "last" | number
): ClipFrame => {
  const time =
    at === "first"
      ? source.start
      : at === "last"
        ? tidy(source.end - LAST_FRAME_INSET_SECONDS)
        : at;
  if (source.kind === "footage") {
    return { kind: "footage", inputVideo: source.footagePath, time };
  }
  return {
    kind: "composite",
    screen: source.files.screen,
    camera: source.files.camera,
    scene: sceneAt(source.segments, time),
    time,
  };
};

/** How much picture the composite still's graph draws (it keeps the first). */
const STILL_SECONDS = 0.05;

/**
 * The ffmpeg input and picture arguments that make `frame` the first output
 * frame; the caller adds the frame count and the output. `seek` is the `-ss`
 * value as the caller formats `frame.time`. `filter` is an extra video filter
 * (a scale) applied to the picture.
 */
export const clipFrameFfmpegArgs = (
  frame: ClipFrame,
  opts: { readonly seek: string; readonly filter?: string }
): string[] => {
  if (frame.kind === "footage") {
    return [
      "-ss",
      opts.seek,
      "-i",
      frame.inputVideo,
      ...(opts.filter ? ["-vf", opts.filter] : []),
    ];
  }
  const at = Number(opts.seek);
  const graph = sceneFilterGraph({
    segments: [
      { scene: frame.scene, startSeconds: at, endSeconds: at + STILL_SECONDS },
    ],
    inputStartSeconds: at,
    output: opts.filter ? "composite" : "v",
  });
  return [
    "-ss",
    opts.seek,
    "-i",
    frame.screen,
    "-ss",
    opts.seek,
    "-i",
    frame.camera,
    "-filter_complex",
    opts.filter ? `${graph};[composite]${opts.filter}[v]` : graph,
    "-map",
    "[v]",
  ];
};

/**
 * A Clip's sound as an ffmpeg input: its Footage file, or a new-recorder
 * Clip's mic, read the mic offset earlier (compositing its picture is the
 * export's business).
 */
export const clipFfmpegInput = (source: ClipSource): ClipFfmpegInput =>
  source.kind === "footage"
    ? {
        inputVideo: source.footagePath,
        startTime: source.start,
        duration: source.end - source.start,
      }
    : {
        inputVideo: source.files.mic,
        startTime: tidy(source.start - source.micOffsetSeconds),
        duration: source.end - source.start,
      };

/**
 * What the source contributes to the Export Hash payload. The keys and their
 * order are load-bearing: every existing export is addressed by them, so an
 * OBS Clip must keep hashing as `{ f, s, e }` for ever.
 */
export const clipSourceHashFields = (
  source: ClipSource
): { f: string; s: number; e: number } => ({
  f: source.kind === "footage" ? source.footagePath : source.files.mic,
  s: source.start,
  e: source.end,
});
