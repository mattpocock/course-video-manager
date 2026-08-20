import { Effect, Option } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { notFound, rejectBothFlags } from "@/cli/helpers";

/**
 * Resolve `clip`/`chapter` `add`/`move`'s --before/--after into the single
 * "anchor id" the positioning service writes against, over the MERGED
 * clip+chapter order space.
 *
 * Clips and Chapters share ONE fractional `order` key (see
 * `app/cli/commands/clip.ts` docstring), so an anchor may legitimately be
 * EITHER a Clip or a Chapter — both `clip add --after <chapterId>` and
 * `chapter add --after <clipId>` are well-defined. The lookup therefore matches
 * against any timeline item by id, never filtering by type.
 *
 * `--after X` resolves to whatever item currently follows X (again, possibly a
 * Chapter). Neither flag returns `null` — "append to the end" for `add`; `move`
 * requires exactly one and rejects the neither case at its own call site (a
 * move that keeps an item where it is would be a silent no-op, not an append).
 * `excludeId` is the item being MOVED (skipped so it never anchors to itself);
 * `add` omits it, since the new item is not on the timeline yet.
 *
 * `entity` only steers the messages of the errors surfaced here (which noun the
 * CLI is reporting the not-found/both-flags against); the resolution logic is
 * identical for both, which is exactly why it lives here rather than being
 * duplicated per command.
 */
export const resolveBeforeItemId = (params: {
  readonly entity: "clip" | "chapter";
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

    const clipOps = yield* ClipOperationsService;
    const items = (yield* clipOps.listTimelineOrder(params.videoId)).filter(
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
