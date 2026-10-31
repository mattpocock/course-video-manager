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
   * raw frames, already scaled to `liveCameraSize` (in system memory).
   */
  readonly sources: Readonly<Record<LayoutSource, SourceSize>>;
  /** ffmpeg stream specifiers of the two inputs, e.g. `0:v` and `1:v`. */
  readonly inputs: Readonly<Record<LayoutSource, string>>;
  /** The scene shown from the start: `streamselect`'s first `map`. */
  readonly scene: Scene;
  /** The output label. Default `v`. */
  readonly output?: string;
  /**
   * Where the canvas's clock starts, in the inputs' time (s). Default 0. The
   * canvas clocks every scene, so one that starts behind its inputs makes
   * frames as fast as it can until it catches up with them. The output is
   * moved back by it, so it starts at 0 (#2482).
   */
  readonly canvasStartSeconds?: number;
  /**
   * The Chat Highlight card (#2461): a `yuva420p` input, in system memory,
   * drawn over whichever scene shows, at a fixed place, on the CPU (#2462):
   * the picture comes back from CUDA once a frame, takes the card, and goes
   * up again for the encoder. The card never goes up itself: `overlay_cuda`
   * over an uploaded card showed its state 2 frames early on the rig
   * (ffmpeg 8.0.1), because the card's upload pool held 2 frames and the
   * next upload overwrote the one the blend had still to read. Its frames are
   * stamped on the same 1/60 grid as the canvas, from the same start
   * (`canvasStartSeconds`), so each picture frame pairs with the card frame of
   * its own slot. A card that ends leaves the picture as it is
   * (`eof_action=pass`).
   */
  readonly card?: {
    readonly input: string;
    readonly x: number;
    readonly y: number;
  };
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
 * THE CAMERA AS THE LIVE STREAM NEEDS IT (#2502): `camera` scaled down to
 * the most any Landscape scene draws of it, never up. The Camera scene draws
 * the whole 2560x1440 frame at 1920x1080, so that is the size: every other
 * scene draws its crop smaller. The camera writer scales its feed to this
 * on the GPU, so the stream gets 44% fewer bytes a frame and loses nothing
 * it draws.
 */
export const liveCameraSize = (camera: SourceSize): SourceSize => {
  const scales = SCENES.flatMap((s) =>
    drawInstructions(s, { screen: camera, camera }, "landscape")
      .filter((i) => i.source === "camera")
      .flatMap((i) => [i.dw / i.sw, i.dh / i.sh])
  );
  const scale = Math.min(1, Math.max(...scales));
  return {
    width: evenSize(Math.round(camera.width * scale)),
    height: evenSize(Math.round(camera.height * scale)),
  };
};

/**
 * A SCENE SWITCH on the running Live Stream (#2457): the filter command that
 * makes the graph's one `streamselect` show `scene`, changing nothing else.
 */
export const liveSceneSwitch = (scene: Scene) => ({
  target: "streamselect",
  command: "map",
  arg: String(SCENES.indexOf(scene)),
});

/**
 * THE LIVE STREAM'S PICTURE (spec #2445): every Landscape scene drawn on
 * CUDA from `drawInstructions`, side by side, and one picked with
 * `streamselect`, whose `map` a scene switch changes at runtime (#2457), so
 * the stream is never restarted. Each scene is drawn bottom to top with
 * `overlay_cuda` on one black canvas, uploaded once a frame. The canvas is
 * always the base, never the screen: `overlay_cuda` copies its base into a
 * frame from the base's pool, and `scale_cuda`'s pool is 32-row aligned, so
 * a screen base came out 1920x1088 with 8 rows of garbage (ffmpeg 8.0.1,
 * measured). The canvas ticks at exactly 60 fps and clocks every scene; the
 * screen's stamps (Matroska's whole ms) are put on the same 1/60 grid, so
 * each slot pairs with its own screen frame, never the one before. A screen
 * or camera that ends ends the picture (#2502). Everything is yuv420p,
 * so the picture comes back as it is for the card's CPU blend (#2462).
 */
export const liveSceneFilterGraph = ({
  sources,
  inputs,
  scene,
  output = "v",
  canvasStartSeconds = 0,
  card,
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
    let base = `live_base${k}`;
    drawInstructions(s, sources, "landscape")
      .map(onCanvas)
      .forEach((i, j) => {
        const label = `live_item${k}_${j}`;
        item(i, label);
        const next = `live_scene${k}_${j}`;
        // Either feed ending ends the picture: a frozen frame would hide a
        // dead feed, which the stream side hears only as no new frame (#2502).
        chains.push(
          `[${base}][${label}]overlay_cuda=x=${i.dx}:y=${i.dy}:eof_action=endall[${next}]`
        );
        base = next;
      });
    chains.push(`[${base}]null[live_scene${k}]`);
  });

  /** Each source's head: the screen onto the canvas's 1/60 grid, tagged. */
  const head: Record<LayoutSource, string> = {
    screen: `fps=${LIVE_FPS}:round=near,${BT709_LIMITED},`,
    camera: "",
  };
  const splits = (["screen", "camera"] as const).map((source) => {
    const labels = branches[source];
    return labels.length === 0
      ? `[${inputs[source]}]nullsink`
      : `[${inputs[source]}]${head[source]}split=${labels.length}${labels.map((l) => `[${l}]`).join("")}`;
  });
  const bases = SCENES.map((_, k) => `[live_base${k}]`).join("");
  const canvasStart =
    canvasStartSeconds > 0
      ? `setpts=PTS+${canvasStartSeconds.toFixed(3)}/TB,`
      : "";
  const canvasChain = `color=c=black:s=${canvas.width}x${canvas.height}:r=${LIVE_FPS},${canvasStart}format=yuv420p,${BT709_LIMITED},hwupload_cuda,split=${SCENES.length}${bases}`;

  // Its output from 0: under -copyts, CFR fills every slot before a first
  // frame stamped later with a duplicate, encoded as fast as it can (#2482).
  const shifted = canvasStartSeconds > 0;
  const picture = shifted ? "live_unshifted" : output;
  const outputChain = shifted
    ? [`[${picture}]setpts=PTS-${canvasStartSeconds.toFixed(3)}/TB[${output}]`]
    : [];

  const scenes = SCENES.map((_, k) => `[live_scene${k}]`).join("");
  const selected = card ? "live_selected" : picture;
  const select = `${scenes}streamselect=inputs=${SCENES.length}:map=${liveSceneSwitch(scene).arg}[${selected}]`;
  const cardChains = card
    ? [
        `[${card.input}]${canvasStart}${BT709_LIMITED}[live_card]`,
        `[live_selected]hwdownload,format=yuv420p[live_picture]`,
        `[live_picture][live_card]overlay=x=${card.x}:y=${card.y}:eof_action=pass:repeatlast=1:format=yuv420,hwupload_cuda[${picture}]`,
      ]
    : [];
  return [
    ...splits,
    canvasChain,
    ...chains,
    select,
    ...cardChains,
    ...outputChain,
  ].join(";");
};
