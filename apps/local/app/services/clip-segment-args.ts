import {
  compositeFiles,
  footageLayers,
  isUntouched,
  type ClipComposite,
  type FootageLayer,
  type Layer,
} from "@/packages/clip-source";
import { sceneFilterGraph } from "@/packages/scene-layout";
import { clipZoomCropFilter } from "@/features/videos/clip-zoom";
import { micEqFilters } from "@/packages/mic-eq";
import { footageScaleFilter } from "./clip-concat-args";
import { BITEXACT_ARGS, LANDSCAPE_VIDEO_ENCODE_ARGS } from "./ffmpeg-error";

/**
 * The ffmpeg command lines of a segmented export: each Clip rendered on its
 * own into a segment file, then the segments joined by stream copy.
 *
 * A Video with a CVM-recorder Clip is exported this way. Its Clips are
 * composites drawn from three files each, and one filter graph across every
 * Clip opens a decoder per file per Clip (about 39 for 13 Clips, 4–5 GB more
 * GPU memory — the composite-cost measurement on #1993). One graph per Clip
 * costs about what today's export does. An OBS-only Video never comes here.
 *
 * Every segment is encoded alike — {@link LANDSCAPE_VIDEO_ENCODE_ARGS} (CFR
 * 60, 8-bit yuv420p), BT.709 tags, 48 kHz stereo PCM in QuickTime — so the
 * concat can copy the picture. The sound is PCM until the concat so no
 * per-segment AAC priming lands between Clips; the concat encodes AAC 48 kHz
 * once, and the audio normalize pass that follows re-encodes it anyway.
 *
 * Two things keep the joined file CFR 60 with the sound on the picture:
 * - Each segment is a whole number of frames, picture and sound alike
 *   ({@link wholeFrameSeconds}). The concat demuxer starts the next segment
 *   where the last one ends; a picture rounded up to its frame over sound cut
 *   at the exact duration opens a gap of a few ms at every join, which the
 *   AAC encode closes by sliding the sound earlier.
 * - The segments carry a 1/15360 video time base (as today's single pass
 *   writes): 60 fps lands on whole ticks, where Matroska's 1 ms ticks give
 *   frame steps of 16 and 17 ms.
 */

/** One Clip as a segmented export renders it. */
export type SegmentClip = {
  /** The Footage file and start an OBS Clip is cut from (a composite reads its own). */
  readonly inputVideo: string;
  readonly startTime: number;
  /** Seconds of output, long Pause included. */
  readonly duration: number;
  readonly zoomType?: string;
  /** The composite to draw, or null for a Clip cut from one Footage file. */
  readonly composite: ClipComposite | null;
  /** Its Layers (`clipLayers`): an untouched Clip renders as it always did. */
  readonly layers: readonly Layer[];
};

/**
 * Whether the export must render these Clips one by one: a composite, or a
 * Clip with Layers of its own. An OBS-only Video of untouched Clips takes the
 * single pass, exactly as before.
 */
export const needsClipSegments = (
  clips: readonly Pick<SegmentClip, "composite" | "layers">[]
): boolean =>
  clips.some((clip) => clip.composite !== null || !isUntouched(clip.layers));

type Dimensions = { readonly width: number; readonly height: number };

const FPS = 60;

/** A duration rounded up to whole 60 fps frames (800 samples at 48 kHz). */
const wholeFrameSeconds = (seconds: number): number =>
  Math.ceil(seconds * FPS - 1e-6) / FPS;

/** The extension of a segment file: QuickTime, which carries PCM. */
export const SEGMENT_EXTENSION = ".mov";

/** BT.709 tags on every segment: the concat copies them through. */
const BT709_ARGS = [
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-colorspace",
  "bt709",
];

const SEGMENT_AUDIO_ARGS = ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"];

/**
 * Scale (after any Clip Zoom crop) to the export frame: a composite is
 * already drawn on its Video's canvas; a Footage file covers a Short's frame
 * ({@link footageScaleFilter}).
 */
const frameFilter = (zoomType: string | undefined, scale: string) => {
  const crop = clipZoomCropFilter(zoomType ?? "none");
  return `${crop ? `${crop},` : ""}${scale},setsar=1,format=yuv420p`;
};

/** Stereo 48 kHz, exactly `duration` long, starting at 0. */
const audioTail = (duration: number) =>
  `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=0:${duration},asetpts=PTS-STARTPTS`;

/**
 * Render one Clip to a segment file: the composite for a CVM-recorder Clip,
 * the Footage cut for any other.
 *
 * The composite reads screen and camera from the Clip's picture time and the
 * mic from `start - micOffset` (the mic is behind the picture by the offset);
 * a mic read that would start before the file does is padded with silence.
 */
export const clipSegmentArgs = (
  clip: SegmentClip,
  dims: Dimensions,
  outputFile: string
): string[] => {
  const duration = wholeFrameSeconds(clip.duration);
  const { inputs, graph } = segmentGraph(clip, dims, duration);
  return [
    "-y",
    "-hide_banner",
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    ...LANDSCAPE_VIDEO_ENCODE_ARGS,
    ...BT709_ARGS,
    ...SEGMENT_AUDIO_ARGS,
    "-video_track_timescale",
    String(FPS * 256),
    "-t",
    String(duration),
    ...BITEXACT_ARGS,
    outputFile,
  ];
};

/** How many frames a Clip's segment holds: its duration in whole 60 fps frames. */
export const segmentFrameCount = (duration: number): number =>
  Math.round(wholeFrameSeconds(duration) * FPS);

/**
 * One frame of a Clip's segment, `frame` frames in, as a PNG: the very filter
 * graph {@link clipSegmentArgs} encodes, so `cvm clip frame` shows what the
 * export draws (#2578). The graph's picture is 60 fps from frame 0.
 */
export const clipSegmentFrameArgs = (
  clip: SegmentClip,
  dims: Dimensions,
  frame: number,
  outputFile: string
): string[] => {
  const { inputs, graph } = segmentGraph(
    clip,
    dims,
    wholeFrameSeconds(clip.duration)
  );
  return [
    "-y",
    "-hide_banner",
    "-v",
    "error",
    ...inputs,
    "-filter_complex",
    `${graph};[outv]select=eq(n\\,${frame})[still];[outa]anullsink`,
    "-map",
    "[still]",
    "-frames:v",
    "1",
    outputFile,
  ];
};

/** A Clip's segment as ffmpeg inputs and one filter graph ending in `[outv]` and `[outa]`. */
const segmentGraph = (
  clip: SegmentClip,
  dims: Dimensions,
  duration: number
): { inputs: string[]; graph: string } => {
  if (!isUntouched(clip.layers)) return layeredSegment(clip, dims, duration);
  const { composite } = clip;
  if (!composite) {
    return {
      inputs: [
        "-ss",
        String(clip.startTime),
        "-t",
        String(duration),
        "-i",
        clip.inputVideo,
      ],
      graph: [
        `[0:v]setpts=PTS-STARTPTS,fps=60,${frameFilter(clip.zoomType, footageScaleFilter(dims))}[outv]`,
        `[0:a]asetpts=PTS-STARTPTS,${audioTail(duration)}[outa]`,
      ].join(";"),
    };
  }

  const start = composite.start;
  // Draw the last scene on to the end of the last frame.
  const segments = segmentsToEnd(composite, duration);
  const micStart = start - composite.micOffsetSeconds;
  const silenceMs = Math.max(0, Math.round(-micStart * 1000));
  // Read a little past the end, so the 29.97 camera has a frame to hold.
  const pictureRead = String(duration + 1);
  const audioFilters = [
    "asetpts=PTS-STARTPTS",
    ...(silenceMs > 0 ? [`adelay=${silenceMs}:all=1`] : []),
    ...micEqFilters(composite.eq),
    audioTail(duration),
  ];
  // Landscape opens screen then camera; a Short only what its segments draw.
  const pictures = compositeFiles(composite, segments);
  const micInput = pictures.length;
  return {
    inputs: [
      ...pictures.flatMap(({ file }) => [
        "-ss",
        String(start),
        "-t",
        pictureRead,
        "-i",
        file,
      ]),
      "-ss",
      String(Math.max(0, micStart)),
      "-t",
      String(duration),
      "-i",
      composite.mic,
    ],
    graph: [
      sceneFilterGraph({
        segments,
        inputs: Object.fromEntries(
          pictures.map(({ source }, i) => [source, `${i}:v`])
        ),
        inputStartSeconds: start,
        output: "composite",
        format: composite.format,
      }),
      `[composite]${frameFilter(clip.zoomType, `scale=${dims.width}:${dims.height}`)}[outv]`,
      `[${micInput}:a]${audioFilters.join(",")}[outa]`,
    ].join(";"),
  };
};

/**
 * The ffmpeg inputs and audio filters of a composite's sound: the mic, read
 * from `start - micOffset`, padded with silence where that is before the
 * file starts, through the Mic EQ.
 */
const compositeMic = (composite: ClipComposite, duration: number) => {
  const micStart = composite.start - composite.micOffsetSeconds;
  const silenceMs = Math.max(0, Math.round(-micStart * 1000));
  return {
    args: [
      "-ss",
      String(Math.max(0, micStart)),
      "-t",
      String(duration),
      "-i",
      composite.mic,
    ],
    filters: [
      "asetpts=PTS-STARTPTS",
      ...(silenceMs > 0 ? [`adelay=${silenceMs}:all=1`] : []),
      ...micEqFilters(composite.eq),
    ],
  };
};

const seconds = (n: number) => n.toFixed(3);

/** The composite's segments, the last drawn on to the end of the last frame. */
const segmentsToEnd = (composite: ClipComposite, duration: number) =>
  composite.segments.map((segment, i, all) =>
    i === all.length - 1
      ? {
          ...segment,
          endSeconds: Math.max(segment.endSeconds, composite.start + duration),
        }
      : segment
  );

/**
 * One Footage Layer's picture, from input `index`: sought (not accurately,
 * so the frame at or before an off-grid start is kept below 0, as B-roll's
 * export does) to its start, trimmed to its span, shifted onto it, cut to its
 * Source Crop and scaled to its Placement's size.
 */
const footageLayerNode = (
  layer: FootageLayer,
  index: number,
  length: number,
  label: string
) => {
  const { x, y, w, h } = layer.sourceCrop;
  const { w: pw, h: ph } = layer.placement;
  return (
    `[${index}:v]trim=end=${seconds(length)},` +
    `setpts=PTS+${seconds(layer.span.at)}/TB,` +
    `crop=w=iw*${w}:h=ih*${h}:x=iw*${x}:y=ih*${y},` +
    `scale=${pw}:${ph},setsar=1[${label}]`
  );
};

/**
 * A Clip with Layers of its own, as one segment: its Scene Layer (or a black
 * frame when it has none), each Footage Layer drawn over it bottom to top
 * within its span, and its sound. The Clip's own sound (the mic, or its
 * file's) plays at the Scene Layer's volume, at full with no Scene Layer; a
 * Footage Layer above 0 volume mixes its file's sound in over its span.
 */
const layeredSegment = (
  clip: SegmentClip,
  dims: Dimensions,
  duration: number
): { inputs: string[]; graph: string } => {
  const { composite } = clip;
  const scene = clip.layers.find((layer) => layer.kind === "scene");
  const inputs: string[] = [];
  const graph: string[] = [];
  let mainAudio: string;
  let audioFilters: string[];
  if (composite) {
    const segments = segmentsToEnd(composite, duration);
    const pictures = scene ? compositeFiles(composite, segments) : [];
    for (const { file } of pictures) {
      inputs.push(
        "-ss",
        String(composite.start),
        "-t",
        String(duration + 1),
        "-i",
        file
      );
    }
    if (scene) {
      graph.push(
        sceneFilterGraph({
          segments,
          inputs: Object.fromEntries(
            pictures.map(({ source }, i) => [source, `${i}:v`])
          ),
          inputStartSeconds: composite.start,
          output: "composite",
          format: composite.format,
        }),
        `[composite]${frameFilter(clip.zoomType, `scale=${dims.width}:${dims.height}`)}[base]`
      );
    }
    const mic = compositeMic(composite, duration);
    mainAudio = `[${pictures.length}:a]`;
    audioFilters = mic.filters;
    inputs.push(...mic.args);
  } else {
    inputs.push(
      "-ss",
      String(clip.startTime),
      "-t",
      String(duration),
      "-i",
      clip.inputVideo
    );
    if (scene) {
      graph.push(
        `[0:v]setpts=PTS-STARTPTS,fps=60,${frameFilter(clip.zoomType, footageScaleFilter(dims))}[base]`
      );
    }
    mainAudio = "[0:a]";
    audioFilters = ["asetpts=PTS-STARTPTS"];
  }
  if (!scene) {
    graph.push(
      `color=c=black:s=${dims.width}x${dims.height}:r=${FPS}:d=${seconds(duration)},format=yuv420p,setsar=1[base]`
    );
  } else if (scene.volume !== 1) {
    audioFilters.push(`volume=${scene.volume}`);
  }

  let picture = "[base]";
  const mixed: string[] = [];
  for (const [i, layer] of footageLayers(clip.layers).entries()) {
    const { at } = layer.span;
    const length = layer.span.duration ?? duration - at;
    const index = inputs.filter((arg) => arg === "-i").length;
    inputs.push(
      "-noaccurate_seek",
      "-ss",
      seconds(layer.start),
      "-i",
      layer.file
    );
    graph.push(
      footageLayerNode(layer, index, length, `fl${i}`),
      `${picture}[fl${i}]overlay=x=${layer.placement.x}:y=${layer.placement.y}:eof_action=pass:repeatlast=0` +
        `:enable='between(t,${seconds(at)},${seconds(at + length)})'[over${i}]`
    );
    picture = `[over${i}]`;
    if (layer.volume > 0) {
      inputs.push(
        "-ss",
        seconds(layer.start),
        "-t",
        seconds(length),
        "-i",
        layer.file
      );
      graph.push(
        `[${index + 1}:a]asetpts=PTS-STARTPTS,volume=${layer.volume},` +
          `adelay=${Math.round(at * 1000)}:all=1,aresample=48000[la${i}]`
      );
      mixed.push(`[la${i}]`);
    }
  }
  graph.push(`${picture}format=yuv420p,setsar=1[outv]`);
  if (mixed.length === 0) {
    graph.push(
      `${mainAudio}${[...audioFilters, audioTail(duration)].join(",")}[outa]`
    );
  } else {
    graph.push(
      `${mainAudio}${[...audioFilters, "aresample=48000"].join(",")}[main]`,
      `[main]${mixed.join("")}amix=inputs=${mixed.length + 1}:duration=first:dropout_transition=0:normalize=0,${audioTail(duration)}[outa]`
    );
  }
  return { inputs, graph: graph.join(";") };
};

/**
 * Join the segment files listed in `listFile` (concat demuxer syntax) by
 * stream copy, encoding the PCM sound to the export's AAC 48 kHz.
 */
export const concatSegmentsArgs = (
  listFile: string,
  outputFile: string
): string[] => [
  "-y",
  "-hide_banner",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  listFile,
  "-map",
  "0:v",
  "-map",
  "0:a",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-ar",
  "48000",
  "-b:a",
  "320k",
  "-movflags",
  "+faststart",
  ...BITEXACT_ARGS,
  outputFile,
];

/** A concat demuxer list naming each segment file. */
export const concatList = (segmentFiles: readonly string[]): string =>
  segmentFiles.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n") +
  "\n";
