import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  notFoundMany,
  parseError,
} from "@/cli/helpers";
import {
  OVERLAY_HELP,
  LIST_HELP,
  GET_HELP,
  ADD_HELP,
  UPDATE_HELP,
  DELETE_HELP,
} from "./overlay.help";

/**
 * overlay — a visual layer composited on top of a Video's footage.
 *
 * DOMAIN (see CONTEXT.md "Overlays and transitions"):
 *   An Overlay is anchored to ONE Clip at `at`, a plain Clip-relative offset in
 *   seconds, and carries its own `durationInSeconds` — independent of that
 *   Clip's length, so an Overlay may run on across the Clips that follow. Its
 *   visible content is a Definition Card: a `title` (the term) and a
 *   `description` (the definition), written inline on the Overlay itself.
 *   There is no shared glossary entity and no `kind` discriminator, because
 *   Definition Card is the only content-kind there is.
 *
 *   Overlays are CHILDREN of a Clip, addressed only by id, with no version
 *   scoping. Unlike every other write noun here, delete is a HARD delete: an
 *   Overlay has no `archived` flag and there is no restore.
 *
 * OUTPUT FIELDS:
 *   id                overlay id (use with `overlay get`)
 *   clipId            the anchor Clip
 *   at                offset from the anchor Clip's start, seconds (float)
 *   durationInSeconds how long it stays on screen, seconds (float)
 *   title             the Definition Card's heading — the term
 *   description       the Definition Card's body — the definition
 *
 * VERBS:
 *   overlay list --video <id> [--clip <id>]  a Video's Overlays, timeline order
 *   overlay get <id...>                      one or more Overlays by id
 *   overlay add --clip <id> --at <s> --duration <s> --title <t> --description <d>
 *   overlay update <id> [flags]              re-anchor and/or edit in place
 *   overlay delete <id>                      hard-delete (no restore)
 *
 * There is deliberately no `overlay move`: an Overlay's position IS its anchor
 * Clip plus its offset, so moving one is `update --clip` and/or `--at`.
 */

// ---------------------------------------------------------------------------
// Options / Args
// ---------------------------------------------------------------------------

const videoOpt = Options.text("video").pipe(
  Options.withDescription("The Video id whose Overlays to list (required).")
);

const clipFilterOpt = Options.text("clip").pipe(
  Options.withDescription(
    "Narrow the listing to the Overlays anchored to this Clip id."
  ),
  Options.optional
);

const clipAddOpt = Options.text("clip").pipe(
  Options.withDescription("The anchor Clip id (required).")
);

const clipUpdateOpt = Options.text("clip").pipe(
  Options.withDescription(
    "Re-anchor the Overlay to this Clip id, which must be in the SAME Video " +
      "(the offset stays Clip-relative)."
  ),
  Options.optional
);

const atAddOpt = Options.float("at").pipe(
  Options.withDescription(
    "Offset from the anchor Clip's own start, seconds (required, >= 0 and " +
      "less than that Clip's own length)."
  )
);

const atUpdateOpt = Options.float("at").pipe(
  Options.withDescription(
    "New offset from the anchor Clip's own start, seconds (>= 0 and less " +
      "than the anchor Clip's own length)."
  ),
  Options.optional
);

const durationAddOpt = Options.float("duration").pipe(
  Options.withDescription(
    "How long the Overlay stays on screen, seconds (required, > 0). Not " +
      "bounded by the anchor Clip's own length."
  )
);

const durationUpdateOpt = Options.float("duration").pipe(
  Options.withDescription("New on-screen length, seconds (> 0)."),
  Options.optional
);

const titleAddOpt = Options.text("title").pipe(
  Options.withDescription(
    "The Definition Card's heading — the term being defined (required)."
  )
);

const titleUpdateOpt = Options.text("title").pipe(
  Options.withDescription("New Definition Card heading."),
  Options.optional
);

const descriptionAddOpt = Options.text("description").pipe(
  Options.withDescription(
    "The Definition Card's body — the definition itself (required)."
  )
);

const descriptionUpdateOpt = Options.text("description").pipe(
  Options.withDescription("New Definition Card body."),
  Options.optional
);

const idArg = Args.text({ name: "id" });
const idsArg = Args.text({ name: "id" }).pipe(Args.repeated);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The anchor Clip must exist and be active. `createOverlay`'s draft-guard
 * passes a missing Clip straight through (the insert would then fail on the
 * FK), so this turns a bad --clip into a clean not-found (exit 2) instead.
 * Archived clips are deleted as far as the timeline is concerned, so they are
 * not-found too — nothing may be anchored to one.
 */
const requireClip = (id: string) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [existing] = yield* clipOps.getClipsByIds([id]);
    if (!existing) {
      return yield* notFound("clip", id);
    }
    return existing;
  });

const requireActiveClip = (id: string) =>
  Effect.gen(function* () {
    const existing = yield* requireClip(id);
    if (existing.archived) {
      return yield* notFound("clip", id);
    }
    return existing;
  });

/** Resolve an Overlay for a write, or fail not-found (exit 2). */
const requireOverlay = (id: string) =>
  Effect.gen(function* () {
    const overlayOps = yield* OverlayOperationsService;
    const [existing] = yield* overlayOps.getOverlaysByIds([id]);
    if (!existing) {
      return yield* notFound("overlay", id);
    }
    return existing;
  });

/** `at` is an offset, never a countdown; a negative one addresses nothing. */
const requireNonNegativeAt = (at: number) =>
  at >= 0
    ? Effect.void
    : parseError(
        `--at (${at}) must be at or after the Clip's start (0)`,
        "overlay"
      );

/** A zero-length Overlay is never on screen, so it is invalid input. */
const requirePositiveDuration = (duration: number) =>
  duration > 0
    ? Effect.void
    : parseError(`--duration (${duration}) must be greater than 0`, "overlay");

/** A Clip's own length: what `at` is an offset into. */
type AnchorClip = {
  id: string;
  videoId: string;
  sourceStartTime: number;
  sourceEndTime: number;
};

/**
 * `at` addresses a moment INSIDE the anchor Clip.
 *
 * Only the DURATION is free to outrun the Clip (an Overlay may keep showing
 * over the Clips that follow) — the anchor is not. An `at` at or past the
 * Clip's own length points at footage that belongs to a LATER Clip, and the
 * export composites the card there without complaint, so it is refused here.
 */
const requireAtWithinClip = (at: number, clip: AnchorClip) => {
  const clipDuration = clip.sourceEndTime - clip.sourceStartTime;
  return at < clipDuration
    ? Effect.void
    : parseError(
        `--at (${at}) is at or past the end of Clip ${clip.id}, which is ` +
          `${clipDuration}s long. An Overlay's anchor must fall inside its ` +
          `own Clip — anchor it to the later Clip instead, or lower --at.`,
        "overlay"
      );
};

/**
 * Re-anchoring moves an Overlay along ONE Video's timeline, never between
 * Videos.
 *
 * An Overlay parked on another Video's Clip disappears from `overlay list
 * --video <original>` with nothing said, and silently changes a second Video's
 * Export Hash — so the cross-Video re-anchor is refused rather than performed.
 */
const requireSameVideo = (from: AnchorClip, to: AnchorClip) =>
  from.videoId === to.videoId
    ? Effect.void
    : parseError(
        `--clip ${to.id} belongs to Video ${to.videoId}, but this Overlay is ` +
          `anchored in Video ${from.videoId}. An Overlay cannot be re-anchored ` +
          `into another Video; delete it and add one there instead.`,
        "overlay"
      );

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make(
  "list",
  { video: videoOpt, clip: clipFilterOpt },
  ({ video, clip }) =>
    Effect.gen(function* () {
      // The Video must exist: an unknown id would otherwise be indistinguishable
      // from a Video that simply has no Overlays yet (both print nothing).
      const videoOps = yield* VideoOperationsService;
      yield* videoOps
        .getVideoWithClipsById(video)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("video", video)));

      const overlayOps = yield* OverlayOperationsService;
      const rows = yield* overlayOps.listOverlaysByVideoId(
        video,
        Option.getOrNull(clip)
      );
      yield* emitNdjson(rows);
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

const getCmd = Command.make("get", { ids: idsArg }, ({ ids }) =>
  Effect.gen(function* () {
    const overlayOps = yield* OverlayOperationsService;
    const rows = yield* overlayOps.getOverlaysByIds(ids);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const found = ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    const missing = ids.filter((id) => !byId.has(id));

    if (ids.length === 1) {
      if (found.length === 1) {
        yield* emitObject(found[0]);
        return;
      }
      return yield* notFound("overlay", ids[0]!);
    }

    yield* emitNdjson(found);
    if (missing.length > 0) {
      return yield* notFoundMany("overlay", missing);
    }
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const addCmd = Command.make(
  "add",
  {
    clip: clipAddOpt,
    at: atAddOpt,
    duration: durationAddOpt,
    title: titleAddOpt,
    description: descriptionAddOpt,
  },
  ({ clip, at, duration, title, description }) =>
    Effect.gen(function* () {
      yield* requireNonNegativeAt(at);
      yield* requirePositiveDuration(duration);
      const anchor = yield* requireActiveClip(clip);
      yield* requireAtWithinClip(at, anchor);

      const overlayOps = yield* OverlayOperationsService;
      const created = yield* overlayOps.createOverlay({
        clipId: clip,
        at,
        durationInSeconds: duration,
        title,
        description,
      });
      yield* emitObject(created);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

const updateCmd = Command.make(
  "update",
  {
    id: idArg,
    clip: clipUpdateOpt,
    at: atUpdateOpt,
    duration: durationUpdateOpt,
    title: titleUpdateOpt,
    description: descriptionUpdateOpt,
  },
  ({ id, clip, at, duration, title, description }) =>
    Effect.gen(function* () {
      const c = Option.getOrUndefined(clip);
      const a = Option.getOrUndefined(at);
      const d = Option.getOrUndefined(duration);
      const t = Option.getOrUndefined(title);
      const desc = Option.getOrUndefined(description);

      if (
        c === undefined &&
        a === undefined &&
        d === undefined &&
        t === undefined &&
        desc === undefined
      ) {
        return yield* parseError(
          "update needs at least one of --clip / --at / --duration / " +
            "--title / --description",
          "overlay"
        );
      }
      if (a !== undefined) yield* requireNonNegativeAt(a);
      if (d !== undefined) yield* requirePositiveDuration(d);

      const overlay = yield* requireOverlay(id);

      // Whichever of the anchor's two halves this update touches, it is the
      // RESULTING pair — new Clip or old, new offset or old — that has to be a
      // real moment inside one Clip of one Video.
      if (c !== undefined) {
        const target = yield* requireActiveClip(c);
        const current = yield* requireClip(overlay.clipId);
        yield* requireSameVideo(current, target);
        yield* requireAtWithinClip(a ?? overlay.at, target);
      } else if (a !== undefined) {
        yield* requireAtWithinClip(a, yield* requireClip(overlay.clipId));
      }

      const overlayOps = yield* OverlayOperationsService;
      const updated = yield* overlayOps.updateOverlay(id, {
        ...(c === undefined ? {} : { clipId: c }),
        ...(a === undefined ? {} : { at: a }),
        ...(d === undefined ? {} : { durationInSeconds: d }),
        ...(t === undefined ? {} : { title: t }),
        ...(desc === undefined ? {} : { description: desc }),
      });
      if (!updated) {
        return yield* notFound("overlay", id);
      }
      yield* emitObject(updated);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    yield* requireOverlay(id);
    const overlayOps = yield* OverlayOperationsService;
    // The row is GONE after this, so what is echoed is what `deleteOverlay`
    // returned — there is nothing left to read back.
    const deleted = yield* overlayOps.deleteOverlay(id);
    if (!deleted) {
      return yield* notFound("overlay", id);
    }
    yield* emitObject(deleted);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const overlayCommand = Command.make("overlay").pipe(
  Command.withDescription(detail(OVERLAY_HELP)),
  Command.withSubcommands([listCmd, getCmd, addCmd, updateCmd, deleteCmd])
);
