import { DEFAULT_MIC_EQ, type MicEq } from "@cvm/core/features/videos/recorder";
import type { VideoFormat } from "@cvm/core/features/videos/video-format";
import {
  LAYOUT_VERSIONS,
  sceneFilterGraph,
  sceneSegments,
  type Scene,
  type SceneSegment,
} from "@/packages/scene-layout";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import { compositeFiles, compositeSources } from "./composite-files";
import {
  footageLayers,
  footageLayerTime,
  drawsScene,
  isUntouched,
  layersHashPayload,
  resolveLayers,
  sceneLayerFormat,
  type Layer,
} from "./layers";
import { clampCrop, cropFilter, type ScreenCrop } from "./screen-crop";

/**
 * A CVM-recorder Clip's Recording Session, as loaded with the Clip (the
 * `recordingSession` relation with its `sceneEvents` and `micEq`). Scene
 * event times are the picture's file time. `micEq` is the saved Mic EQ
 * Setting, null until it is first saved ({@link DEFAULT_MIC_EQ}).
 *
 * `format` is the Video Format it was filmed in: on a Landscape Video its
 * picture is drawn in that format's layout; a Short draws it in the Short
 * layout ({@link sceneLayerFormat}). `screenCaptured` is false for a
 * camera-only Short session, whose `screenFilePath` names no file.
 */
export type ClipRecordingSession = {
  readonly id: string;
  readonly cameraFilePath: string;
  readonly screenFilePath: string;
  readonly micFilePath: string;
  readonly micOffsetMs: number;
  readonly format: VideoFormat;
  readonly screenCaptured: boolean;
  readonly micEq: MicEq | null;
  readonly sceneEvents: readonly {
    readonly fileTime: number;
    readonly scene: Scene;
  }[];
};

/**
 * A Recording Session as a reader that only shows the Clip loads it: the EQ
 * may be left off, since only the export hears it.
 */
type ShownRecordingSession = Omit<ClipRecordingSession, "micEq"> &
  Partial<Pick<ClipRecordingSession, "micEq">>;

/**
 * The persisted columns a Clip's picture and sound are read from — what the
 * export carries (`toExportClips` demands every one). Nothing outside this
 * package should read them for picture or sound — it asks a
 * {@link ClipSource} instead.
 *
 * `recordingSession` is the joined Recording Session row (with its scene
 * events) — null for an OBS Clip. A query that feeds the Export Hash must
 * load it, or a CVM-recorder Clip would be addressed as a single file.
 */
export type ClipSourceColumns = {
  readonly videoFilename: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly recordingSessionId: string | null;
  readonly sceneOverride: Scene | null;
  readonly recordingSession: ClipRecordingSession | null;
  /** Its stored Layers (none: one Scene Layer); `clipLayersRelation` in core. */
  readonly layers: readonly ClipLayerRow[];
};

/**
 * Everything `clipSource` reads off a Clip row. The CVM-recorder columns are
 * optional: a row loaded without its Recording Session (or an OBS Clip, whose
 * relation is null) answers as a single Footage file.
 */
export type ClipSourceRow = Pick<
  ClipSourceColumns,
  "videoFilename" | "sourceStartTime" | "sourceEndTime"
> &
  Partial<
    Pick<ClipSourceColumns, "recordingSessionId" | "sceneOverride" | "layers">
  > & {
    readonly recordingSession?: ShownRecordingSession | null;
  };

/**
 * Where a Clip's picture and sound come from. The variants are this package's
 * business; readers hand a ClipSource back to the functions below and never
 * look inside it.
 *
 * - `footage`: an OBS Clip — one Footage file cut between a start and an end.
 * - `recording-session`: a CVM-recorder Clip — camera, screen and mic files
 *   of one Recording Session, drawn in `format`'s layout. `start`/
 *   `end` and the segments are in the picture's clock; the mic is read
 *   `micOffsetSeconds` earlier. The export also needs its scene events (to
 *   draw past the Clip's end, over a long Pause), its Scene Override and the
 *   mic EQ it is exported with. `files.screen` is null when the session
 *   captured no screen (a camera-only Short).
 */
export type ClipSource =
  | {
      readonly kind: "footage";
      readonly footagePath: string;
      readonly start: number;
      readonly end: number;
      readonly layers: readonly Layer[];
    }
  | {
      readonly kind: "recording-session";
      readonly recordingSessionId: string;
      readonly format: VideoFormat;
      readonly files: {
        readonly camera: string;
        readonly screen: string | null;
        readonly mic: string;
      };
      readonly micOffsetSeconds: number;
      readonly micOffsetMs: number;
      readonly micEq: MicEq;
      readonly sceneEvents: readonly {
        readonly scene: Scene;
        readonly atSeconds: number;
      }[];
      readonly sceneOverride: Scene | null;
      readonly segments: readonly SceneSegment[];
      readonly start: number;
      readonly end: number;
      readonly layers: readonly Layer[];
    };

/**
 * What the export draws for a CVM-recorder Clip over a stretch of picture
 * time: the files, the scene segments, and the mic's offset and EQ.
 */
export type ClipComposite = {
  /** The layout (and canvas) it is drawn in. */
  readonly format: VideoFormat;
  /** Picture file time the composite starts at (the Clip's start). */
  readonly start: number;
  /** Null when the Recording Session captured no screen. */
  readonly screen: string | null;
  readonly camera: string;
  readonly mic: string;
  /** The mic is read from `start - micOffsetSeconds`. */
  readonly micOffsetSeconds: number;
  readonly eq: MicEq;
  readonly segments: readonly SceneSegment[];
};

/**
 * One still of a Clip's picture: a frame of a Footage file, the composite
 * drawn from a Recording Session's screen and camera in one scene, or a
 * Recording Session's screen frame alone (no face), at its native size,
 * optionally cut to a `crop` of it.
 */
export type ClipFrame =
  | {
      readonly kind: "footage";
      readonly inputVideo: string;
      readonly time: number;
    }
  | {
      readonly kind: "screen";
      readonly screen: string;
      readonly time: number;
      readonly crop?: ScreenCrop;
    }
  | {
      readonly kind: "composite";
      readonly format: VideoFormat;
      readonly screen: string | null;
      readonly camera: string;
      readonly scene: Scene;
      readonly time: number;
    };

/**
 * One Clip as an input to the ffmpeg encode/transcribe pipelines.
 *
 * `startTime` is never negative. When a CVM-recorder Clip starts within the
 * mic offset of its Recording Session's start, the mic is read from 0 and
 * `leadingSilenceSeconds` says how much of the Clip's start it has no sound
 * for; `duration` stays the Clip's own, in the picture's clock.
 */
export type ClipFfmpegInput = {
  readonly inputVideo: string;
  readonly startTime: number;
  readonly duration: number;
  readonly leadingSilenceSeconds: number;
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
  recordingSessionId: row.recordingSessionId,
  sceneOverride: row.sceneOverride,
  layers: row.layers,
  recordingSession: row.recordingSession && {
    id: row.recordingSession.id,
    cameraFilePath: row.recordingSession.cameraFilePath,
    screenFilePath: row.recordingSession.screenFilePath,
    micFilePath: row.recordingSession.micFilePath,
    micOffsetMs: row.recordingSession.micOffsetMs,
    format: row.recordingSession.format,
    screenCaptured: row.recordingSession.screenCaptured,
    micEq: row.recordingSession.micEq && {
      lowDb: row.recordingSession.micEq.lowDb,
      midDb: row.recordingSession.micEq.midDb,
      highDb: row.recordingSession.micEq.highDb,
    },
    sceneEvents: row.recordingSession.sceneEvents.map((e) => ({
      fileTime: e.fileTime,
      scene: e.scene,
    })),
  },
});

/**
 * The Clip's source. A CVM-recorder Clip is exported with its Recording
 * Session's saved mic EQ, or Matt's OBS EQ ({@link DEFAULT_MIC_EQ}) until one
 * is saved. Its Scene Layer is drawn in `videoFormat`'s layout, the Video the
 * Clip is on ({@link sceneLayerFormat}); a reader that draws no Video (sound,
 * file checks) may leave it out, and gets the session's own.
 */
export const clipSource = (
  row: ClipSourceRow,
  opts?: { readonly videoFormat?: VideoFormat }
): ClipSource => {
  const start = row.sourceStartTime;
  const end = row.sourceEndTime;
  const session = row.recordingSession;
  if (!session) {
    const layers = resolveLayers(row.layers, { start, session: null });
    return {
      kind: "footage",
      footagePath: row.videoFilename,
      start,
      end,
      layers,
    };
  }
  const sceneEvents = session.sceneEvents.map((e) => ({
    scene: e.scene,
    atSeconds: e.fileTime,
  }));
  const sceneOverride = row.sceneOverride ?? null;
  return {
    kind: "recording-session",
    recordingSessionId: session.id,
    format: sceneLayerFormat(session.format, opts?.videoFormat),
    files: {
      camera: session.cameraFilePath,
      screen: session.screenCaptured ? session.screenFilePath : null,
      mic: session.micFilePath,
    },
    micOffsetSeconds: session.micOffsetMs / 1000,
    micOffsetMs: session.micOffsetMs,
    micEq: session.micEq ?? DEFAULT_MIC_EQ,
    sceneEvents,
    sceneOverride,
    segments: sceneSegments({
      events: sceneEvents,
      clip: { startSeconds: start, endSeconds: end },
      override: sceneOverride,
    }),
    start,
    end,
    layers: resolveLayers(row.layers, { start, session }),
  };
};

/**
 * The Clip's picture: its Layers, drawn bottom to top. Every reader of the
 * picture (the export, editor playback, stills and the Export Hash) asks the
 * functions below, which draw it from these (ADR 0056).
 */
export const clipLayers = (source: ClipSource): readonly Layer[] =>
  source.layers;

/**
 * What the export composites for a CVM-recorder Clip from its start, for
 * `durationSeconds` of output (default: the Clip's own length; longer over a
 * long Pause), or null for an OBS Clip, whose single Footage file is cut as
 * it always was. Its mic is the Clip's sound even with no Scene Layer.
 */
export const clipComposite = (
  source: ClipSource,
  opts?: { readonly durationSeconds: number }
): ClipComposite | null => {
  if (source.kind === "footage") return null;
  return {
    format: source.format,
    start: source.start,
    screen: source.files.screen,
    camera: source.files.camera,
    mic: source.files.mic,
    micOffsetSeconds: source.micOffsetSeconds,
    eq: source.micEq,
    segments: opts
      ? sceneSegments({
          events: source.sceneEvents,
          clip: {
            startSeconds: source.start,
            endSeconds: source.start + opts.durationSeconds,
          },
          override: source.sceneOverride,
        })
      : source.segments,
  };
};

/** Rounds away float noise from subtracting the mic offset (9.850000001). */
const tidy = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/**
 * The media element that clocks playback, and how its time maps to the
 * Clip's: source time = clock `currentTime` + `offsetSeconds`. An OBS Clip's
 * clock is its Footage (offset 0); a CVM-recorder Clip's is its mic, which is
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
 * A CVM-recorder Clip's picture, for the composite playback canvas: its
 * camera and screen cued to `from`–`to` (source time; they share the
 * picture's clock), the scene segments to draw them in and the format whose
 * layout draws them. `screen` is null when the picture never draws it (a
 * Short's Camera-only run, a camera-only session). Null for an OBS Clip,
 * whose clock is its picture.
 */
export const clipCompositePicture = (
  source: ClipSource,
  range: { readonly from: number; readonly to: number }
): {
  readonly format: VideoFormat;
  readonly camera: string;
  readonly screen: string | null;
  readonly segments: readonly SceneSegment[];
} | null => {
  if (source.kind === "footage" || !drawsScene(clipLayers(source))) {
    return null;
  }
  const opensScreen = compositeSources(source.format, source.segments).includes(
    "screen"
  );
  return {
    format: source.format,
    camera: viewVideoUrl(source.files.camera, range.from, range.to),
    screen:
      opensScreen && source.files.screen !== null
        ? viewVideoUrl(source.files.screen, range.from, range.to)
        : null,
    segments: source.segments,
  };
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

/**
 * The Clip's screen frame alone as a picture for playback, cued to
 * `from`–`to` (source time: it shares the picture's clock), with the Video
 * Format its Recording Session was filmed in. Null when there
 * is no screen to show without the face: an OBS Clip (its face is baked into
 * its Footage) or a camera-only Short session.
 */
export const clipScreenPicture = (
  source: ClipSource,
  range: { readonly from: number; readonly to: number }
): { readonly screen: string; readonly format: VideoFormat } | null =>
  source.kind === "recording-session" && source.files.screen !== null
    ? {
        screen: viewVideoUrl(source.files.screen, range.from, range.to),
        format: source.format,
      }
    : null;

/**
 * The first frame, the last frame, or the frame at a source time. With
 * `screenOnly`, a CVM-recorder Clip that captured a screen gives its screen
 * frame alone (no face), cut to `crop` when given; any other Clip ignores
 * both.
 */
export const clipFrame = (
  source: ClipSource,
  at: "first" | "last" | number,
  opts?: { readonly screenOnly?: boolean; readonly crop?: ScreenCrop }
): ClipFrame => {
  const time =
    at === "first"
      ? source.start
      : at === "last"
        ? tidy(source.end - LAST_FRAME_INSET_SECONDS)
        : at;
  const bottom = footageLayers(source.layers)[0];
  if (!drawsScene(source.layers) && bottom) {
    // No Scene Layer: its bottom Footage Layer's frame, uncropped.
    const elapsed = time - source.start - bottom.span.at;
    const at = tidy(footageLayerTime(bottom.start, elapsed));
    return { kind: "footage", inputVideo: bottom.file, time: at };
  }
  if (source.kind === "footage") {
    return { kind: "footage", inputVideo: source.footagePath, time };
  }
  if (opts?.screenOnly && source.files.screen !== null) {
    return {
      kind: "screen",
      screen: source.files.screen,
      time,
      ...(opts.crop ? { crop: clampCrop(opts.crop) } : {}),
    };
  }
  return {
    kind: "composite",
    format: source.format,
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
  if (frame.kind === "footage" || frame.kind === "screen") {
    const filters = [
      frame.kind === "screen" && frame.crop ? cropFilter(frame.crop) : null,
      opts.filter ?? null,
    ].filter((f) => f !== null);
    return [
      "-ss",
      opts.seek,
      "-i",
      frame.kind === "footage" ? frame.inputVideo : frame.screen,
      ...(filters.length > 0 ? ["-vf", filters.join(",")] : []),
    ];
  }
  const at = Number(opts.seek);
  const segments = [
    { scene: frame.scene, startSeconds: at, endSeconds: at + STILL_SECONDS },
  ];
  const files = compositeFiles(frame, segments);
  const graph = sceneFilterGraph({
    segments,
    inputs: Object.fromEntries(
      files.map(({ source }, i) => [source, `${i}:v`])
    ),
    inputStartSeconds: at,
    output: opts.filter ? "composite" : "v",
    format: frame.format,
  });
  return [
    ...files.flatMap(({ file }) => ["-ss", opts.seek, "-i", file]),
    "-filter_complex",
    opts.filter ? `${graph};[composite]${opts.filter}[v]` : graph,
    "-map",
    "[v]",
  ];
};

/**
 * A Clip's sound as an ffmpeg input: its Footage file, or a CVM-recorder
 * Clip's mic, read the mic offset earlier (compositing its picture is the
 * export's business). A mic read that would start before the file does
 * starts at 0 instead, the gap stated as `leadingSilenceSeconds`.
 */
export const clipFfmpegInput = (source: ClipSource): ClipFfmpegInput => {
  if (source.kind === "footage") {
    return {
      inputVideo: source.footagePath,
      startTime: source.start,
      duration: source.end - source.start,
      leadingSilenceSeconds: 0,
    };
  }
  const micStart = tidy(source.start - source.micOffsetSeconds);
  return {
    inputVideo: source.files.mic,
    startTime: Math.max(0, micStart),
    duration: source.end - source.start,
    leadingSilenceSeconds: Math.max(0, -micStart),
  };
};

/**
 * What the source contributes to the Export Hash payload. The keys and their
 * order are load-bearing: every existing export is addressed by them, so an
 * OBS Clip must keep hashing as `{ f, s, e }` for ever.
 *
 * A CVM-recorder Clip adds, after those: its Recording Session (`rs`), the
 * scene segments in its range (`sg`), its Scene Override (`so`, only when
 * set), the mic offset (`mo`), the mic EQ (`eq`) and its format's layout
 * version (`lv`) — everything else its composite is drawn from, in the
 * format its Scene Layer is drawn in. A Short adds that format (`vf`) last,
 * so a Short layout version never addresses the same export as the Landscape
 * one; a Landscape Clip has no `vf`, so every Landscape export keeps its
 * hash. A Landscape session's Clip on a Short is drawn, so hashed, as a Short.
 *
 * Only a Clip whose Layers are not an untouched Clip's (one Scene Layer)
 * adds them (`ly`, last), so no export made before Layers is re-addressed.
 */
export const clipSourceHashFields = (
  source: ClipSource
):
  | { f: string; s: number; e: number; ly?: LayersHash }
  | {
      f: string;
      s: number;
      e: number;
      rs: string;
      sg: [Scene, number, number][];
      so?: Scene;
      mo: number;
      eq: [number, number, number];
      lv: number;
      vf?: VideoFormat;
      ly?: LayersHash;
    } => {
  const ly = isUntouched(source.layers)
    ? {}
    : { ly: layersHashPayload(source.layers) };
  if (source.kind === "footage") {
    return { f: source.footagePath, s: source.start, e: source.end, ...ly };
  }
  return {
    f: source.files.mic,
    s: source.start,
    e: source.end,
    rs: source.recordingSessionId,
    sg: source.segments.map((g) => [g.scene, g.startSeconds, g.endSeconds]),
    ...(source.sceneOverride ? { so: source.sceneOverride } : {}),
    mo: source.micOffsetMs,
    eq: [source.micEq.lowDb, source.micEq.midDb, source.micEq.highDb],
    lv: LAYOUT_VERSIONS[source.format],
    ...(source.format === "landscape" ? {} : { vf: source.format }),
    ...ly,
  };
};

type LayersHash = ReturnType<typeof layersHashPayload>;
