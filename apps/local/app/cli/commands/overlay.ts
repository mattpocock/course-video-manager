import { Command } from "@effect/cli";
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
  resolveOverlayKind,
  DEFAULT_OVERLAY_KIND,
} from "@/features/videos/overlay-kind";
import {
  videoOpt,
  clipFilterOpt,
  clipAddOpt,
  clipUpdateOpt,
  atAddOpt,
  atUpdateOpt,
  durationAddOpt,
  durationUpdateOpt,
  kindOpt,
  titleAddOpt,
  titleUpdateOpt,
  descriptionAddOpt,
  descriptionUpdateOpt,
  idArg,
  idsArg,
} from "./overlay.options";
import {
  bulletPanelOpts,
  hasBulletPanelFlags,
  requireStoredBulletsStillFit,
  resolveBulletPanelPatch,
} from "./overlay.bullets";
import { requireNoClipZoomUnderTransform } from "./overlay.clip-zoom-guard";
import { clipTimelineStarts } from "@/services/clip-timeline";
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
 *   `kind` says which content-kind it carries — `definitionCard` (the default,
 *   and what every Overlay written before the discriminator existed is) or
 *   `bulletPanel`. A Definition Card's content is a `title` (the term) and a
 *   `description` (the definition), written inline on the Overlay itself;
 *   there is no shared glossary entity. A Bullet Panel's content is a `title`
 *   (the panel's heading) and up to four `bullets`, each an icon, a line of
 *   text and its own `revealAt` — seconds after the Overlay's own start.
 *
 *   The `kind` also decides whether the FOOTAGE moves: a `bulletPanel` carries
 *   a Transform, a kind-derived pan/zoom over its own window, which is why one
 *   is refused on a Clip that already has a Clip Zoom — see
 *   `overlay.clip-zoom-guard.ts`.
 *
 *   At most ONE Overlay is visible at a given moment across the whole Video,
 *   so an Overlay whose window overlaps another's — of either kind, on any
 *   Clip of the same Video — is refused rather than authored.
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
 *   kind              which content-kind it carries (definitionCard default)
 *   title             the heading — the term, or the Bullet Panel's own title
 *   description       the Definition Card's body — the definition
 *   bullets           the Bullet Panel's bullets, or null for other kinds
 *   disableEnterAnimation / disableExitAnimation  hard-cut instead of easing
 *
 * VERBS:
 *   overlay list --video <id> [--clip <id>]  a Video's Overlays, timeline order
 *   overlay get <id...>                      one or more Overlays by id
 *   overlay add --clip <id> --at <s> --duration <s> [--kind <k>] --title <t>
 *               (--description <d> | --bullets-json <path|->)
 *   overlay update <id> [flags]              re-anchor and/or edit in place
 *   overlay delete <id>                      hard-delete (no restore)
 *
 * There is deliberately no `overlay move`: an Overlay's position IS its anchor
 * Clip plus its offset, so moving one is `update --clip` and/or `--at`.
 */

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

/**
 * At most ONE Overlay is ever visible at a given moment across the whole Video
 * (CONTEXT.md, "Overlays and transitions") — no tracks, no layering.
 *
 * The comparison is on the VIDEO's timeline, not within one Clip: an Overlay's
 * duration is free to outrun its anchor Clip, so two Overlays on different
 * Clips can still be on screen together. Touching windows are fine — one
 * Overlay ending exactly where the next begins shows only ever one at a time.
 *
 * `exclude` is the Overlay being updated: it may of course overlap itself.
 */
const requireNoOverlappingOverlay = (params: {
  videoId: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  exclude?: string;
}) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(params.videoId)
      .pipe(
        Effect.catchTag("NotFoundError", () =>
          notFound("video", params.videoId)
        )
      );

    const starts = clipTimelineStarts(video.clips);
    const anchorStart = starts.get(params.clipId);
    // An anchor that is not on this Video's timeline at all is somebody else's
    // refusal to make — requireActiveClip/requireSameVideo already made it.
    if (anchorStart === undefined) return;

    const startInSeconds = anchorStart + params.at;
    const endInSeconds = startInSeconds + params.durationInSeconds;

    const overlayOps = yield* OverlayOperationsService;
    const siblings = yield* overlayOps.listOverlaysByVideoId(
      params.videoId,
      null
    );

    for (const sibling of siblings) {
      if (sibling.id === params.exclude) continue;
      const siblingClipStart = starts.get(sibling.clipId);
      if (siblingClipStart === undefined) continue;
      const siblingStart = siblingClipStart + sibling.at;
      const siblingEnd = siblingStart + sibling.durationInSeconds;
      if (startInSeconds < siblingEnd && siblingStart < endInSeconds) {
        return yield* parseError(
          `this Overlay would be on screen from ${startInSeconds}s to ` +
            `${endInSeconds}s on the Video's timeline, where Overlay ` +
            `${sibling.id} is already showing (${siblingStart}s to ` +
            `${siblingEnd}s). At most one Overlay is visible at a time — ` +
            `move or shorten one of them, or delete ${sibling.id}.`,
          "overlay"
        );
      }
    }
  });

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
    kind: kindOpt,
    title: titleAddOpt,
    description: descriptionAddOpt,
    ...bulletPanelOpts,
  },
  ({ clip, at, duration, kind, title, description, ...flags }) =>
    Effect.gen(function* () {
      yield* requireNonNegativeAt(at);
      yield* requirePositiveDuration(duration);

      // Resolved before the anchor is looked up: a content mistake is a typo
      // in the command, and saying so needs no database round trip.
      const desc = Option.getOrUndefined(description);
      const panel = yield* resolveBulletPanelPatch({
        kind: Option.getOrUndefined(kind) ?? DEFAULT_OVERLAY_KIND,
        needsContent: true,
        durationInSeconds: duration,
        description: desc,
        flags,
      });

      const anchor = yield* requireActiveClip(clip);
      yield* requireAtWithinClip(at, anchor);
      yield* requireNoOverlappingOverlay({
        videoId: anchor.videoId,
        clipId: clip,
        at,
        durationInSeconds: duration,
      });
      yield* requireNoClipZoomUnderTransform({
        videoId: anchor.videoId,
        clipId: clip,
        at,
        durationInSeconds: duration,
        kind: Option.getOrUndefined(kind),
      });

      const overlayOps = yield* OverlayOperationsService;
      const created = yield* overlayOps.createOverlay({
        clipId: clip,
        at,
        durationInSeconds: duration,
        kind: Option.getOrUndefined(kind),
        title,
        // A Bullet Panel has no `description`, but the column is NOT NULL —
        // it stores the empty string rather than the caller inventing one.
        description: desc ?? "",
        bullets: panel.bullets ?? null,
        disableEnterAnimation: panel.disableEnterAnimation ?? false,
        disableExitAnimation: panel.disableExitAnimation ?? false,
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
    kind: kindOpt,
    title: titleUpdateOpt,
    description: descriptionUpdateOpt,
    ...bulletPanelOpts,
  },
  ({ id, clip, at, duration, kind, title, description, ...flags }) =>
    Effect.gen(function* () {
      const newClipId = Option.getOrUndefined(clip);
      const newAt = Option.getOrUndefined(at);
      const newDuration = Option.getOrUndefined(duration);
      const newKind = Option.getOrUndefined(kind);
      const newTitle = Option.getOrUndefined(title);
      const newDescription = Option.getOrUndefined(description);
      if (
        newClipId === undefined &&
        newAt === undefined &&
        newDuration === undefined &&
        newKind === undefined &&
        newTitle === undefined &&
        newDescription === undefined &&
        !hasBulletPanelFlags(flags)
      ) {
        return yield* parseError(
          "update needs at least one of --clip / --at / --duration / " +
            "--kind / --title / --description / --bullets-json / " +
            "--disable-enter-animation / --disable-exit-animation",
          "overlay"
        );
      }
      if (newAt !== undefined) yield* requireNonNegativeAt(newAt);
      if (newDuration !== undefined)
        yield* requirePositiveDuration(newDuration);

      const overlay = yield* requireOverlay(id);

      // Content is checked against the kind the Overlay will BE once this
      // lands, so a switch of kind and its new content go in together.
      const wasKind = resolveOverlayKind(overlay.kind);
      const willBeKind = newKind ?? wasKind;
      // What the Overlay's window will BE, which is what a bullet's reveal
      // time has to fit inside — not what it is now.
      const nextDuration = newDuration ?? overlay.durationInSeconds;
      const panel = yield* resolveBulletPanelPatch({
        kind: willBeKind,
        needsContent: willBeKind !== wasKind,
        durationInSeconds: nextDuration,
        currentDisableExitAnimation: overlay.disableExitAnimation,
        description: newDescription,
        flags,
      });
      const nextDisableExitAnimation =
        panel.disableExitAnimation ?? overlay.disableExitAnimation;

      // The bullets ALREADY stored were accepted against the window this
      // Overlay had when they were written. Shortening it, or turning its exit
      // animation back on, asks that question again — and the answer can now be
      // no, so it is asked here rather than discovered as a bullet clipped
      // mid-reveal in a render.
      const fitInputsChanged =
        nextDuration !== overlay.durationInSeconds ||
        nextDisableExitAnimation !== overlay.disableExitAnimation;
      if (
        willBeKind === "bulletPanel" &&
        panel.bullets === undefined &&
        fitInputsChanged
      ) {
        yield* requireStoredBulletsStillFit({
          bullets: overlay.bullets ?? [],
          durationInSeconds: nextDuration,
          disableExitAnimation: nextDisableExitAnimation,
        });
      }

      // Whichever of the anchor's two halves this update touches, it is the
      // RESULTING pair — new Clip or old, new offset or old — that has to be a
      // real moment inside one Clip of one Video.
      const current = yield* requireClip(overlay.clipId);
      let anchor = current;
      if (newClipId !== undefined) {
        const target = yield* requireActiveClip(newClipId);
        yield* requireSameVideo(current, target);
        yield* requireAtWithinClip(newAt ?? overlay.at, target);
        anchor = target;
      } else if (newAt !== undefined) {
        yield* requireAtWithinClip(newAt, current);
      }

      // Only a move or a resize can newly collide; editing the words of an
      // Overlay leaves its window exactly where it already was, and must not
      // be refused on account of data that predates this check.
      if (
        newClipId !== undefined ||
        newAt !== undefined ||
        newDuration !== undefined
      ) {
        yield* requireNoOverlappingOverlay({
          videoId: anchor.videoId,
          clipId: anchor.id,
          at: newAt ?? overlay.at,
          durationInSeconds: nextDuration,
          exclude: id,
        });
      }

      // A change of KIND can newly collide too, even standing still: an
      // Overlay that moved no camera yesterday moves one today.
      if (
        newClipId !== undefined ||
        newAt !== undefined ||
        newDuration !== undefined ||
        newKind !== undefined
      ) {
        yield* requireNoClipZoomUnderTransform({
          videoId: anchor.videoId,
          clipId: anchor.id,
          at: newAt ?? overlay.at,
          durationInSeconds: nextDuration,
          kind: willBeKind,
        });
      }

      const overlayOps = yield* OverlayOperationsService;
      // Bullets left on a row that is no longer a Bullet Panel would be
      // content nothing renders and the Export Hash still sees, so leaving the
      // kind clears them.
      const isLeavingBulletPanel =
        wasKind === "bulletPanel" && willBeKind !== "bulletPanel";

      const updated = yield* overlayOps.updateOverlay(id, {
        ...(newClipId === undefined ? {} : { clipId: newClipId }),
        ...(newAt === undefined ? {} : { at: newAt }),
        ...(newDuration === undefined
          ? {}
          : { durationInSeconds: newDuration }),
        ...(newKind === undefined ? {} : { kind: newKind }),
        ...(newTitle === undefined ? {} : { title: newTitle }),
        ...(newDescription === undefined
          ? {}
          : { description: newDescription }),
        ...(panel.bullets === undefined ? {} : { bullets: panel.bullets }),
        ...(isLeavingBulletPanel ? { bullets: null } : {}),
        ...(panel.disableEnterAnimation === undefined
          ? {}
          : { disableEnterAnimation: panel.disableEnterAnimation }),
        ...(panel.disableExitAnimation === undefined
          ? {}
          : { disableExitAnimation: panel.disableExitAnimation }),
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
