import {
  CANVASES,
  drawInstructions,
  type DrawInstruction,
  type SourceSize,
} from "./scene-drawing";
import { SCENES, type LayoutSource, type Scene } from "./layout-definition";

export interface LiveSceneFilterGraphInput {
  /**
   * Each source's size as the Live Stream reads it: the screen recorder's
   * 1920x1080 packets, decoded on NVDEC (so on CUDA), and the camera writer's
   * raw 2560x1440 frames (in system memory).
   */
  readonly sources: Readonly<Record<LayoutSource, SourceSize>>;
  /** ffmpeg stream specifiers of the two inputs, e.g. `0:v` and `1:v`. */
  readonly inputs: Readonly<Record<LayoutSource, string>>;
  /** The scene shown from the start: `streamselect`'s first `map`. */
  readonly scene: Scene;
  /** The output label. Default `v`. */
  readonly output?: string;
}

/** The Live Stream's frame rate: true 60, never 30 (spec #2445). */
const LIVE_FPS = 60;

/**
 * Tags a frame BT.709 limited range, as the recorder writes every file
 * (`recorder-service/colour.ts`): ffmpeg 8 negotiates colour, and an untagged
 * frame cannot meet the decoded screen's tags.
 */
const BT709_LIMITED =
  "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709";

/** Even, as 4:2:0 needs, rounded down. */
const even = (n: number) => Math.floor(n / 2) * 2;

/** A size: even, and never none. */
const evenSize = (n: number) => Math.max(2, even(n));

/**
 * An item as far as it is on the canvas: `overlay_cuda` draws whatever it is
 * given at x,y, so an item that runs off the canvas is cut to the part that
 * shows, with its source crop cut by the same fraction. Sizes and source
 * offsets are made even for 4:2:0.
 */
const onCanvas = (i: DrawInstruction): DrawInstruction => {
  const canvas = CANVASES.landscape;
  const left = Math.max(i.dx, 0);
  const top = Math.max(i.dy, 0);
  const right = Math.min(i.dx + i.dw, canvas.width);
  const bottom = Math.min(i.dy + i.dh, canvas.height);
  const xScale = i.sw / i.dw;
  const yScale = i.sh / i.dh;
  return {
    source: i.source,
    sx: even(i.sx + (left - i.dx) * xScale),
    sy: even(i.sy + (top - i.dy) * yScale),
    sw: evenSize((right - left) * xScale),
    sh: evenSize((bottom - top) * yScale),
    dx: left,
    dy: top,
    dw: evenSize(right - left),
    dh: evenSize(bottom - top),
  };
};

/** Whether the item is the whole canvas, so it can be the scene's base. */
const fillsCanvas = (i: DrawInstruction) => {
  const canvas = CANVASES.landscape;
  return (
    i.dx === 0 && i.dy === 0 && i.dw === canvas.width && i.dh === canvas.height
  );
};

/**
 * The screen comes in on CUDA, where it is never cropped: in Landscape every
 * scene draws it whole or not at all.
 */
const screenItem = (i: DrawInstruction, size: SourceSize) => {
  if (i.sx !== 0 || i.sy !== 0 || i.sw !== size.width || i.sh !== size.height)
    throw new Error(
      "The Live Stream draws the screen whole: a scene that crops it needs a crop on CUDA first."
    );
  return `scale_cuda=${i.dw}:${i.dh}:format=yuv420p`;
};

/** The camera comes in raw in system memory: cropped there, then put on CUDA. */
const cameraItem = (i: DrawInstruction) =>
  `crop=w=${i.sw}:h=${i.sh}:x=${i.sx}:y=${i.sy},${BT709_LIMITED},hwupload_cuda,scale_cuda=${i.dw}:${i.dh}:format=yuv420p`;

/**
 * THE LIVE STREAM'S PICTURE (spec #2445): every Landscape scene drawn on
 * CUDA from `drawInstructions`, side by side, and one picked with
 * `streamselect`, whose `map` a scene switch changes at runtime (#2457), so
 * the stream is never restarted. Each scene is drawn bottom to top with
 * `overlay_cuda` on a black canvas, or on its bottom item when that fills the
 * canvas (the screen, in Code and No Face). Everything is yuv420p, which
 * `overlay_cuda` needs to blend a card (`yuva420p`) on top later (#2461).
 * The output is `[output]`, CUDA frames at the 60 fps of the screen, which
 * clocks every scene (`overlay_cuda`'s main input).
 */
export const liveSceneFilterGraph = ({
  sources,
  inputs,
  scene,
  output = "v",
}: LiveSceneFilterGraphInput): string => {
  const canvas = CANVASES.landscape;
  const chains: string[] = [];
  const branches: Record<LayoutSource, string[]> = { screen: [], camera: [] };
  const take = (source: LayoutSource) => {
    const label = `live_${source}${branches[source].length}`;
    branches[source].push(label);
    return label;
  };
  const item = (i: DrawInstruction, label: string) => {
    const filter =
      i.source === "screen" ? screenItem(i, sources.screen) : cameraItem(i);
    chains.push(`[${take(i.source)}]${filter}[${label}]`);
  };

  SCENES.forEach((s, k) => {
    const drawn = drawInstructions(s, sources, "landscape").map(onCanvas);
    const [bottom, ...rest] = drawn;
    let base = `live_base${k}`;
    let above = drawn;
    if (bottom && fillsCanvas(bottom)) {
      item(bottom, base);
      above = rest;
    } else {
      chains.push(
        `color=c=black:s=${canvas.width}x${canvas.height}:r=${LIVE_FPS},format=yuv420p,${BT709_LIMITED},hwupload_cuda[${base}]`
      );
    }
    above.forEach((i, j) => {
      const label = `live_item${k}_${j}`;
      item(i, label);
      const next = `live_scene${k}_${j}`;
      chains.push(
        `[${base}][${label}]overlay_cuda=x=${i.dx}:y=${i.dy}:repeatlast=1[${next}]`
      );
      base = next;
    });
    chains.push(`[${base}]null[live_scene${k}]`);
  });

  const splits = (["screen", "camera"] as const).map((source) => {
    const labels = branches[source];
    return labels.length === 0
      ? `[${inputs[source]}]nullsink`
      : `[${inputs[source]}]split=${labels.length}${labels.map((l) => `[${l}]`).join("")}`;
  });

  const scenes = SCENES.map((_, k) => `[live_scene${k}]`).join("");
  const select = `${scenes}streamselect=inputs=${SCENES.length}:map=${SCENES.indexOf(scene)}[${output}]`;
  return [...splits, ...chains, select].join(";");
};
