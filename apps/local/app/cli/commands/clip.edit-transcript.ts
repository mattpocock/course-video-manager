import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { detail, emitObject, notFound, parseError } from "@/cli/helpers";
import { entityIdArg } from "../entity-id";
import { EDIT_TRANSCRIPT_HELP } from "./clip.help";
import { requireActiveClip, withEffectiveScene } from "./clip.shared";

/**
 * `cvm clip edit-transcript`: the editor's Edit Transcript as a find/replace
 * (#2666). It rewrites the Clip's text, and the service rewrites its
 * Transcript Words to match in the same write, so a misheard word is fixed in
 * a Short's captions without retyping the rest of the Clip.
 */

const findOpt = Options.text("find").pipe(
  Options.withDescription(
    "Text to find in the Clip's text: literal and case-sensitive. Every occurrence is replaced."
  )
);

const replaceOpt = Options.text("replace").pipe(
  Options.withDescription("What each occurrence of --find becomes.")
);

export const editTranscriptCmd = Command.make(
  "edit-transcript",
  { id: entityIdArg("clip"), find: findOpt, replace: replaceOpt },
  ({ id, find, replace }) =>
    Effect.gen(function* () {
      if (find.length === 0) {
        return yield* parseError("--find must not be empty", "clip");
      }
      const clip = yield* requireActiveClip(id);
      if (!clip.text.includes(find)) {
        return yield* parseError(
          `--find ${JSON.stringify(find)} is not in the clip's text; nothing changed`,
          "clip"
        );
      }
      const clipOps = yield* ClipOperationsService;
      const updated = yield* clipOps.setClipText(
        id,
        clip.text.replaceAll(find, replace)
      );
      if (!updated) return yield* notFound("clip", id);
      yield* emitObject(withEffectiveScene(updated));
    })
).pipe(Command.withDescription(detail(EDIT_TRANSCRIPT_HELP)));
