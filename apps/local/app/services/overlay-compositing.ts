/**
 * Where each Overlay lands on the flattened Video timeline, and the ffmpeg
 * filter graph that puts it there.
 *
 * Everything here is pure: Clips and Overlays in, seconds and a filter string
 * out. The pass that runs ffmpeg lives in the export step; this file is the
 * part worth reading, and the only part that can be wrong in a way a test can
 * catch — no test in this repo drives real ffmpeg.
 */

import type { ExportClipDuration } from "./export-duration-check";
import { placeOnTimeline } from "./overlay-timeline";
import type { OverlayContent } from "./overlay-render-cache";
import { resolveOverlayKind } from "@/features/videos/overlay-kind";
import type { ExportOverlay } from "./export-hash";
import { overlayTransformVideoFilter } from "@/features/videos/overlay-transform";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";
import { OVERLAY_RENDER_FPS } from "./overlay-render-cache";
import { overlayRenderProps } from "./overlay-content-props";

/**
 * One Overlay placed on the Video's own timeline: the seconds at which it
 * appears and disappears in the finished export.
 *
 * `content` is what the Overlay Render Cache is asked for — a Definition Card
 * or a Bullet Panel, discriminated by the Overlay's own Kind. It carries the
 * Overlay's OWN `durationInSeconds`, not `endInSeconds - startInSeconds`: a
 * card truncated by the end of the Video is still rendered at full length, so
 * the same card at the end of one Video and the middle of another shares one
 * cached render.
 */
export type PlacedOverlay = {
  content: OverlayContent;
  startInSeconds: number;
  /** Never past the end of the Video — a card that runs off the end is cut. */
  endInSeconds: number;
} & OverlayCameraMove;

/**
 * What the footage underneath an Overlay does while it is on screen.
 *
 * `kind` is carried, not the Transform itself, because the move is DERIVED
 * from the kind (`features/videos/overlay-transform.ts`) and never authored —
 * so there is nothing here for a caller to get wrong or to hold stale.
 */
export type OverlayCameraMove = {
  kind: string;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
};

/**
 * A {@link PlacedOverlay} once its content has actually been rendered: the span
 * it occupies, and the `.mov` to composite over that span. This is everything
 * the ffmpeg pass needs and nothing it does not — the content has already done
 * its job by naming the file.
 *
 * `inputPath` is the ffmpeg input drawn over the span: the rendered `.mov`.
 */
export type RenderedOverlay = {
  inputPath: string;
  startInSeconds: number;
  endInSeconds: number;
} & OverlayCameraMove;

/**
 * Pair a placed Overlay with the render the Overlay Render Cache handed back.
 *
 * It sits here, next to the type it reads, so the export step never has to
 * unpick a `PlacedOverlay`'s fields itself: adding a field to a placement is
 * this file's business, not the caller's.
 */
export const withRenderedContent = (
  placed: PlacedOverlay,
  inputPath: string
): RenderedOverlay => ({
  inputPath,
  startInSeconds: placed.startInSeconds,
  endInSeconds: placed.endInSeconds,
  kind: placed.kind,
  disableEnterAnimation: placed.disableEnterAnimation,
  disableExitAnimation: placed.disableExitAnimation,
});

/**
 * The Overlays the export composites, placed by {@link placeOnTimeline}. A
 * Chat Card and a Call to Action are not among them: they are drawn only in a
 * Short's render (`vertical-overlay-props.ts`).
 */
export const placeOverlaysOnTimeline = (
  clips: ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>,
  clipDurations: ReadonlyArray<ExportClipDuration>
): PlacedOverlay[] =>
  placeOnTimeline(clips, clipDurations).flatMap(
    ({ overlay, startInSeconds, endInSeconds }) => {
      const content = overlayContent(overlay);
      return content === null
        ? []
        : [
            {
              content,
              startInSeconds,
              endInSeconds,
              kind: overlay.kind,
              disableEnterAnimation: overlay.disableEnterAnimation,
              disableExitAnimation: overlay.disableExitAnimation,
            },
          ];
    }
  );

/**
 * What the Overlay Render Cache is asked to render for this Overlay.
 *
 * The Kind decides the branch, and each branch takes ONLY the columns its own
 * render depends on: a Bullet Panel's `description` is always empty and a
 * Definition Card's `bullets` always `null`, so folding the other kind's
 * columns in would put a field in the content address that can never change it.
 * A Bullet Panel with no bullets at all is still a panel — its heading renders
 * — so the empty array is passed through rather than treated as absent.
 */
const overlayContent = (overlay: ExportOverlay): OverlayContent | null => {
  switch (resolveOverlayKind(overlay.kind)) {
    case "chatCard":
    case "callToAction":
      // Shorts only: never composited by the export.
      return null;
    case "bulletPanel":
      return {
        kind: "bulletPanel",
        title: overlay.title,
        bullets: overlay.bullets ?? [],
        durationInSeconds: overlay.durationInSeconds,
        // The Animation Toggles reach the render as well as the camera: they
        // cut the panel's own enter/exit, so they are part of what is drawn.
        disableEnterAnimation: overlay.disableEnterAnimation,
        disableExitAnimation: overlay.disableExitAnimation,
      };
    case "definitionCard":
      return {
        kind: "definitionCard",
        title: overlay.title,
        description: overlay.description,
        durationInSeconds: overlay.durationInSeconds,
      };
  }
};

/**
 * Seconds as the filter graph spells them.
 *
 * Fixed notation, because ffmpeg's expression parser reads `1e-7` as an
 * identifier followed by a subtraction, and millisecond resolution because
 * nothing finer than a frame can be seen.
 */
const formatSeconds = (seconds: number): string => seconds.toFixed(3);

/**
 * What puts the frame at the size the rest of the graph expects.
 *
 * A rendered Overlay is drawn at the export's own resolution, so the footage
 * it lands on has to be at that resolution too — and the source seldom is.
 * The camera move itself no longer changes the frame size (its `pad` and
 * `crop` cancel), so this is the plain resize it always was underneath.
 * Landscape, because this pass IS the landscape course export: it encodes
 * with LANDSCAPE_VIDEO_ENCODE_ARGS, and Overlays exist only on course videos.
 */
const NORMALIZE_FILTER = `scale=${VIDEO_FORMAT_DIMENSIONS.landscape.width}:${VIDEO_FORMAT_DIMENSIONS.landscape.height}`;

/** How a rendered Overlay is drawn over the footage: 1:1, at the origin. */
const OVERLAY_NODE = "overlay=x=0:y=0:format=auto";

/**
 * The `-filter_complex` graph that composites N rendered Overlays onto one
 * video in a SINGLE ffmpeg pass.
 *
 * Input `0` is the video; input `i + 1` is the i-th Overlay's rendered `.mov`.
 * Each one is shifted onto its own place in the timeline with `setpts`, then
 * chained through its own `overlay` node gated by `enable='between(t,...)'`.
 * The chain is what keeps this one pass: a second Overlay adds a node,
 * never another encode.
 *
 * Overlay renders start at frame 0 and last only as long as the Overlay, so the
 * `setpts` shift is what puts the first frame at the moment it is meant to
 * appear; `eof_action=pass` and `repeatlast=0` then let the video run on
 * untouched once the render's own frames are spent.
 *
 * Ahead of that chain sits the camera: an Overlay whose `kind` carries a
 * Transform (`features/videos/overlay-transform.ts`) also gets a `pad`/`crop`
 * pair on the video itself, which SLIDES the footage sideways — never zooms
 * it — out from under the graphic and back again. It carries its own window
 * in its ramps rather than in an `enable=`, and is an identity everywhere
 * outside it, so the panel and the move still start and end on the same frame.
 * An Overlay whose kind carries none — every Definition Card — adds no move at
 * all, so its graph is what it always was.
 *
 * Returns `null` for no Overlays at all — the signal to skip the pass entirely,
 * which is what leaves a Video without Overlays byte-for-byte as it was.
 */
export const buildOverlayCompositeFilterGraph = (
  overlays: ReadonlyArray<
    {
      startInSeconds: number;
      endInSeconds: number;
    } & Partial<OverlayCameraMove>
  >
): string | null => {
  if (overlays.length === 0) return null;

  const shifts = overlays.map(
    (overlay, index) =>
      `[${index + 1}:v]setpts=PTS-STARTPTS+${formatSeconds(overlay.startInSeconds)}/TB[ovl${index}]`
  );

  let current = "[0:v]";

  // The camera moves BEFORE anything is drawn on top of it: the panel is meant
  // to sit still in frame while the footage slides out from under it.
  const moves = overlays.flatMap((overlay, index) => {
    const crop = overlayTransformVideoFilter(overlay);
    return crop === null ? [] : [{ index, crop }];
  });
  const cropNodes = moves.map(({ index, crop }, position) => {
    const output = `[tf${index}]`;
    // Only the LAST move is normalized, because normalizing is a resize and
    // doing it once is enough. Each move hands on a frame of the size it was
    // given — its `pad` and `crop` cancel — so chaining them changes nothing
    // but where the picture sits, and two are never on screen at once anyway
    // (`cvm overlay add` refuses it).
    const normalize =
      position === moves.length - 1 ? `,${NORMALIZE_FILTER}` : "";
    const node = `${current}${crop}${normalize}${output}`;
    current = output;
    return node;
  });

  const chain = overlays.map((overlay, index) => {
    const isLast = index === overlays.length - 1;
    const output = isLast ? "[outv]" : `[comp${index}]`;
    const node =
      `${current}[ovl${index}]${OVERLAY_NODE}:eof_action=pass:repeatlast=0` +
      `:enable='between(t,${formatSeconds(overlay.startInSeconds)},${formatSeconds(overlay.endInSeconds)})'${output}`;
    current = output;
    return node;
  });

  return [...shifts, ...cropNodes, ...chain].join(";");
};

/**
 * The Overlay the export shows at `timelineSeconds` on the Video's timeline,
 * if any, and which frame of its content render is on screen then.
 *
 * Its window holds the moment (its camera move, if its kind has one, is read
 * there). `contentFrame` is the frame {@link buildOverlayCompositeFilterGraph}
 * composites at that moment: the render is shifted to the start as the graph
 * spells it (to the millisecond) and gated by the same `between`, and
 * ffmpeg's `overlay` shows the most recent frame whose time has passed, so it
 * is the FLOOR of the elapsed frames (as `overlay-transform.ts` measured). It
 * is `null` where the export draws none of the render: before its first
 * frame, or past its last.
 */
export const overlayOnScreenAt = <O extends PlacedOverlay>(
  overlays: ReadonlyArray<O>,
  timelineSeconds: number
): { overlay: O; contentFrame: number | null } | null => {
  const overlay = overlays.find(
    (o) =>
      o.startInSeconds <= timelineSeconds && timelineSeconds <= o.endInSeconds
  );
  if (!overlay) return null;
  const start = Number(formatSeconds(overlay.startInSeconds));
  const end = Number(formatSeconds(overlay.endInSeconds));
  const frame = Math.floor(
    (timelineSeconds - start) * OVERLAY_RENDER_FPS + FRAME_EPSILON
  );
  const frames = overlayRenderProps(overlay.content).durationInFrames;
  const drawn =
    start <= timelineSeconds &&
    timelineSeconds <= end &&
    frame >= 0 &&
    frame < frames;
  return { overlay, contentFrame: drawn ? frame : null };
};

/** A moment on the frame boundary is that frame (`overlay-transform.ts`). */
const FRAME_EPSILON = 1e-9;

/**
 * The composite pass at ONE frame of the Video's timeline (`timelineFrame`,
 * at the export's 60 fps): input `0` is that frame's picture, input `1` (when
 * `withContent`) the frame of the Overlay's content on screen then. It is
 * {@link buildOverlayCompositeFilterGraph}'s own camera move, resize and
 * `overlay` node, with the picture stamped at the moment it shows in the
 * export, so the move is read at the same `t`. Ends in `[outv]`.
 */
export const buildOverlayCompositeFrameFilterGraph = (
  overlay: Pick<PlacedOverlay, "startInSeconds" | "endInSeconds"> &
    Partial<OverlayCameraMove>,
  timelineFrame: number,
  withContent: boolean
): string => {
  // A timebase of one export frame, so `t` is exactly the frame's moment.
  const at = `settb=1/${OVERLAY_RENDER_FPS},setpts=${timelineFrame}`;
  const crop = overlayTransformVideoFilter(overlay);
  const move = crop === null ? "" : `,${crop},${NORMALIZE_FILTER}`;
  if (!withContent) return `[0:v]${at}${move}[outv]`;
  return [
    `[0:v]${at}${move}[pic]`,
    `[1:v]${at}[ovl]`,
    `[pic][ovl]${OVERLAY_NODE}[outv]`,
  ].join(";");
};
