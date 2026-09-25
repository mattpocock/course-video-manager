import { Effect, Option } from "effect";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { notFound, rejectBothFlags } from "@/cli/helpers";

/**
 * Resolve `--before` / `--after` into the single "anchor id" the Animatic's
 * positioning services write against, over the MERGED Clip Mockup + Clip Mockup
 * Chapter order space.
 *
 * THE ANIMATIC IS ITS OWN ORDER SPACE. `./timeline-position`'s
 * `resolveBeforeItemId` does the same job for the FILMED timeline (Clips and
 * Chapters) and reads `ClipOperationsService.listTimelineOrder`. That is the
 * wrong list here: a Clip Mockup and a Clip Mockup Chapter share a key space of
 * their own, which no Clip is in. The two resolvers are parallel on purpose,
 * because a single one would have to be told which space it is in on every
 * call — and getting that wrong is a silent mis-placement, not an error.
 *
 * An anchor may be EITHER kind of row: `clip-mockup-chapter add --after
 * <clipMockupId>` opens a divider right after a given moment, and
 * `clip-mockup move --before <chapterId>` slides a moment above a divider. The
 * lookup matches any Animatic row by id and never filters by type.
 *
 * `--after X` resolves to whatever row currently follows X (possibly a
 * divider). Neither flag returns `null` — "append to the end" for `add`; `move`
 * needs exactly one and rejects the neither case at its own call site, because
 * a move with no anchor would silently send the row to the end.
 * `excludeId` is the row being MOVED, skipped so it never anchors to itself;
 * `add` omits it, since the new row is not in the Animatic yet.
 *
 * `entity` only steers which noun the errors raised here are reported against;
 * the resolution is identical for both, which is why it lives here once.
 */
export const resolveBeforeAnimaticItemId = (params: {
  readonly entity: "clipMockup" | "clipMockupChapter";
  readonly videoId: string;
  readonly before: Option.Option<string>;
  readonly after: Option.Option<string>;
  readonly excludeId?: string;
}) =>
  Effect.gen(function* () {
    const before = Option.getOrUndefined(params.before);
    const after = Option.getOrUndefined(params.after);

    yield* rejectBothFlags({
      a: before,
      b: after,
      flags: ["--before", "--after"],
      entity: params.entity,
    });
    if (before === undefined && after === undefined) {
      return null;
    }

    const svc = yield* ClipMockupChapterOperationsService;
    const items = (yield* svc.listAnimaticOrder(params.videoId)).filter(
      (item) => item.id !== params.excludeId
    );

    if (before !== undefined) {
      if (!items.some((item) => item.id === before)) {
        return yield* notFound(params.entity, before);
      }
      return before;
    }

    const idx = items.findIndex((item) => item.id === after);
    if (idx === -1) {
      return yield* notFound(params.entity, after!);
    }
    return items[idx + 1]?.id ?? null;
  });
