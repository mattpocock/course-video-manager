import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { clipFrame } from "@/services/clip-frame";
import { OverlayFrameService } from "@/services/overlay-frame";
import { removeBestEffort } from "@/services/remove-best-effort";
import { assertUnderEffect } from "@/services/assert-under";
import { FRAMES_DIRECTORY } from "@/services/frame-stills";

/**
 * A Clip `at` seconds in, as its Video's render shows it, drawn by the same
 * code as `cvm clip frame` (`clipFrame`), for the editor's paused preview
 * (the Portrait Studio's, #2580). Like any still it is refused while anything records
 * (the Still Gate, 503); the editor asks again after the Stop. The PNG is
 * sent and its file removed: the URL's `v` names what it was drawn from, so
 * the browser may keep it.
 */
export const loader = makeLoader({
  errors: {
    NotFoundError: 404,
    StorageFileNotFoundError: 404,
    StillHeldError: 503,
    FrameRefusedError: 422,
  },
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const fs = yield* FileSystem.FileSystem;
      const at = Number(new URL(request.url).searchParams.get("at"));

      const [clip] = yield* clipOps.getClipsByIds([params.clipId!]);
      if (!clip) return new Response("No such Clip", { status: 404 });

      const path = yield* assertUnderEffect(
        FRAMES_DIRECTORY,
        yield* clipFrame(clip.id, at).pipe(
          Effect.provide(OverlayFrameService.Default)
        )
      );
      const png = yield* fs.readFile(path);
      yield* removeBestEffort(fs, path);

      return new Response(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }),
});
