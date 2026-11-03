import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";
import {
  CLIP_ZOOM_TYPES,
  type ClipZoomType,
} from "@/features/videos/clip-zoom";
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";
import { entityIdArg, entityIdOption } from "../entity-id";
import { UPDATE_HELP } from "./clip.help";
import { requireActiveClip, withEffectiveScene } from "./clip.shared";

/**
 * `cvm clip update`: Clip Zoom, a retime, or another Clip's Layers. Split out
 * of clip.ts to keep that module under the repo's per-file token budget.
 */

const zoomOpt = Options.choice("zoom", CLIP_ZOOM_TYPES).pipe(
  Options.withDescription(
    `Clip Zoom to set: ${CLIP_ZOOM_TYPES.join(" | ")}. Camera scenes only.`
  ),
  Options.optional
);

const startOpt = Options.float("start").pipe(
  Options.withDescription(
    "New sourceStartTime, in seconds (in-point into the source file)."
  ),
  Options.optional
);

const endOpt = Options.float("end").pipe(
  Options.withDescription(
    "New sourceEndTime, in seconds (out-point into the source file)."
  ),
  Options.optional
);

const layersFromOpt = entityIdOption("layers-from", ["clip"]).pipe(
  Options.withDescription(
    "Copy THIS Clip's Layers onto every clip named (a copy: nothing is linked). Goes alone."
  ),
  Options.optional
);

/**
 * `--layers-from <clip>`: copy that Clip's Layers onto every one of `ids`, in
 * one write (a copy each; nothing is linked).
 */
const copyLayers = (ids: readonly string[], from: string) =>
  Effect.gen(function* () {
    yield* requireActiveClip(from);
    for (const id of ids) yield* requireActiveClip(id);
    const clipOps = yield* ClipOperationsService;
    const layers = yield* clipOps.listClipLayers(from);
    yield* clipOps.setClipLayers(ids, layers);
    const rows = yield* clipOps.getClipsByIds(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const updated = ids.map((id) => withEffectiveScene(byId.get(id)!));
    yield* ids.length === 1 ? emitObject(updated[0]!) : emitNdjson(updated);
  });

/** --layers-from on its own, onto at least one clip. */
const requireAlone = (ids: readonly string[], retimes: boolean) =>
  ids.length === 0
    ? parseError("update needs a clip id", "clip")
    : retimes
      ? parseError(
          "--layers-from goes alone: copy the Layers, then --zoom / --start / --end each Clip",
          "clip"
        )
      : Effect.void;

/** --zoom / --start / --end: at least one, on exactly one clip. */
const requireOneClip = (
  ids: readonly string[],
  flags: readonly (number | string | undefined)[]
) =>
  flags.every((flag) => flag === undefined)
    ? parseError(
        "update needs at least one of --zoom / --start / --end / --layers-from",
        "clip"
      )
    : ids.length !== 1
      ? parseError(
          ids.length === 0
            ? "update needs a clip id"
            : "--zoom / --start / --end update one clip at a time",
          "clip"
        )
      : Effect.succeed(ids[0]!);

export const updateCmd = Command.make(
  "update",
  {
    ids: entityIdArg("clip").pipe(Args.repeated),
    zoom: zoomOpt,
    start: startOpt,
    end: endOpt,
    layersFrom: layersFromOpt,
  },
  ({ ids, zoom, start, end, layersFrom }) =>
    Effect.gen(function* () {
      const z = Option.getOrUndefined(zoom);
      const s = Option.getOrUndefined(start);
      const e = Option.getOrUndefined(end);
      const from = Option.getOrUndefined(layersFrom);
      if (from !== undefined) {
        yield* requireAlone(
          ids,
          z !== undefined || s !== undefined || e !== undefined
        );
        return yield* copyLayers(ids, from);
      }
      const id = yield* requireOneClip(ids, [z, s, e]);

      const clipOps = yield* ClipOperationsService;
      let row = yield* requireActiveClip(id);

      if (s !== undefined || e !== undefined) {
        const newStart = s ?? row.sourceStartTime;
        const newEnd = e ?? row.sourceEndTime;
        if (newStart >= newEnd) {
          return yield* parseError(
            `--start (${newStart}) must be before --end (${newEnd})`,
            "clip"
          );
        }
        if (newEnd - newStart < MINIMUM_CLIP_LENGTH_SECONDS) {
          return yield* parseError(
            `clip would be ${(newEnd - newStart).toFixed(3)}s, below the ` +
              `${MINIMUM_CLIP_LENGTH_SECONDS}s minimum clip length`,
            "clip"
          );
        }
        // retimeClip, not updateClip: a recut moves the footage out from
        // under every Clip-relative offset stored against the Clip, so the
        // service cascades over its Transcript Words (shifted, dropped when
        // they no longer fit) and its Overlays (shifted, clamped, never
        // deleted) in the same transaction. Doing that here would be two round
        // trips and two transactions, either of which could leave the Clip
        // half-cascaded.
        row = yield* clipOps
          .retimeClip(id, {
            sourceStartTime: newStart,
            sourceEndTime: newEnd,
          })
          .pipe(Effect.catchTag("NotFoundError", () => notFound("clip", id)));
      }

      // setClipZoom re-checks eligibility — it is the service that owns the
      // rule. Translating its failure here is only about the exit code: an
      // ineligible clip is bad input (exit 3), not an internal fault.
      if (z !== undefined) {
        row = yield* clipOps
          .setClipZoom(id, z satisfies ClipZoomType)
          .pipe(
            Effect.catchTag("ClipNotZoomableError", (e) =>
              parseError(e.message, "clip")
            )
          );
      }

      yield* emitObject(withEffectiveScene(row));
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));
