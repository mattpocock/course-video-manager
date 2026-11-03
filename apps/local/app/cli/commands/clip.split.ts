import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { detail, emitNdjson, notFound, parseError } from "@/cli/helpers";
import type { ClipSplitAt } from "@cvm/core/features/videos/clip-split";
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";
import { entityIdArg } from "../entity-id";
import { SPLIT_HELP } from "./clip.help";
import { requireActiveClip, withEffectiveScene } from "./clip.shared";

/**
 * `cvm clip split` (#2670): one Clip becomes two adjacent Clips, cut at a
 * word boundary. The service (`splitClip`) owns where the cut snaps to and
 * what each side keeps; this verb only reads `--at`.
 */

const atOpt = Options.text("at").pipe(
  Options.withDescription(
    "Where to split: seconds on the clip's source clock (e.g. 15.3), or word:<n> to start the right side at Transcript Word n (0-based, as 'clip words' lists them)."
  )
);

/** `--at 15.3` is a moment on the source clock; `--at word:3` is before word 3. */
export const parseSplitAt = (input: string): ClipSplitAt | null => {
  const word = /^word:(\d+)$/.exec(input.trim());
  if (word) return { kind: "word", index: Number(word[1]) };
  const seconds = Number(input);
  return input.trim() !== "" && Number.isFinite(seconds)
    ? { kind: "source", seconds }
    : null;
};

export const splitCmd = Command.make(
  "split",
  { id: entityIdArg("clip"), at: atOpt },
  ({ id, at }) =>
    Effect.gen(function* () {
      const parsed = parseSplitAt(at);
      if (parsed === null) {
        return yield* parseError(
          `--at must be seconds on the clip's source clock (15.3) or word:<n>, not "${at}"`,
          "clip"
        );
      }
      yield* requireActiveClip(id);
      const clipOps = yield* ClipOperationsService;
      const { left, right } = yield* clipOps
        .splitClip(id, parsed, MINIMUM_CLIP_LENGTH_SECONDS)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("clip", id)));
      yield* emitNdjson([withEffectiveScene(left), withEffectiveScene(right)]);
    })
).pipe(Command.withDescription(detail(SPLIT_HELP)));
