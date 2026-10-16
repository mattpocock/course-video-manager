import { Effect } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import type { ShortScene } from "@/services/short-clip-mockup-frame";
import { notFound, parseError, type ParseError } from "@/cli/helpers";
import type { FrameSource, FrameSpec } from "./clip-mockup.batch";
import {
  landscapeAddProblem,
  shortAddProblem,
  shortDeleteProblem,
  shortMoveProblem,
  shortUpdateProblem,
} from "./clip-mockup.short";

/**
 * The `cvm clip-mockup` verbs' side of a Short's order rule: each reads the
 * rows the rule needs, asks `clip-mockup.short.ts`, and fails with its reason
 * (exit 3) before anything is captured or written. On a Landscape Video every
 * one of them lets the write through unchanged.
 */

const refuse = (problem: string | undefined) =>
  problem === undefined
    ? Effect.void
    : Effect.fail(parseError(problem, "clipMockup"));

/** A Clip Mockup's Video's format, read even when the Video is archived. */
const isShortVideo = (videoId: string) =>
  Effect.gen(function* () {
    const svc = yield* VideoOperationsService;
    const row = yield* svc
      .getVideoDeepById(videoId)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", videoId)));
    return row.format === "short";
  });

/** A Short's Clip Mockup ids, in order: their positions are their scenes. */
export const shortOrderOf = (videoId: string) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupOperationsService;
    return (yield* svc.listClipMockupsByVideoId(videoId)).map((r) => r.id);
  });

/**
 * `add`: what each moment's frame is made from, once the order is checked. A
 * Short's moments are appended after its existing Clip Mockups.
 */
export const addFrameSpecs = (
  video: { readonly id: string; readonly format: string },
  moments: ReadonlyArray<{
    readonly entry: number;
    readonly scene: ShortScene | undefined;
    readonly frame: FrameSource | undefined;
  }>
) =>
  Effect.gen(function* () {
    if (video.format !== "short") {
      yield* refuse(landscapeAddProblem(moments));
      return moments.map((m): FrameSpec => ({
        format: "landscape",
        source: m.frame!,
      }));
    }
    const existing = (yield* shortOrderOf(video.id)).length;
    yield* refuse(shortAddProblem(existing, moments));
    return moments.map((m): FrameSpec =>
      m.scene === "camera"
        ? { format: "short", scene: "camera" }
        : { format: "short", scene: "code", source: m.frame! }
    );
  });

/**
 * `update`: the frame a new picture makes for the Clip Mockup with this id —
 * a Code frame on a Short (`order` is its Clip Mockup ids), refused on its
 * Camera moment.
 */
export const updateFrameSpec = (params: {
  readonly entry: number;
  readonly clipMockupId: string;
  readonly source: FrameSource;
  readonly shortOrder: ReadonlyArray<string> | undefined;
}) =>
  Effect.gen(function* (): Effect.fn.Return<FrameSpec, ParseError> {
    if (params.shortOrder === undefined) {
      return { format: "landscape", source: params.source };
    }
    yield* refuse(
      shortUpdateProblem(
        params.entry,
        params.shortOrder.indexOf(params.clipMockupId) + 1
      )
    );
    return { format: "short", scene: "code", source: params.source };
  });

/** `move`: a Short's Camera moment stays first. */
export const requireMoveKeepsShortOrder = (
  row: { readonly id: string; readonly videoId: string },
  beforeId: string | null
) =>
  Effect.gen(function* () {
    if (!(yield* isShortVideo(row.videoId))) return;
    const chapters = yield* ClipMockupChapterOperationsService;
    const items = yield* chapters.listAnimaticOrder(row.videoId);
    yield* refuse(shortMoveProblem(items, row.id, beforeId));
  });

/** `delete`: a Short's Camera moment goes last. */
export const requireDeleteKeepsShortOrder = (row: {
  readonly id: string;
  readonly videoId: string;
}) =>
  Effect.gen(function* () {
    if (!(yield* isShortVideo(row.videoId))) return;
    yield* refuse(shortDeleteProblem(yield* shortOrderOf(row.videoId), row.id));
  });
