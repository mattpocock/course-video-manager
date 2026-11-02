import { CommandExecutor, FileSystem } from "@effect/platform";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { Effect } from "effect";
import { SidecarContext } from "./sidecar-context";
import { runShortOverlayRenderer } from "./short-overlay-frame";
import type { ShortOverlayProps } from "./short-render-clips";

export { ShortOverlayRenderError } from "./short-overlay-frame";

/**
 * The vertical render's overlay: a Short's captions and Chat Cards, the whole
 * of it as a transparent `.mov`, through the overlay renderer's process
 * boundary (`runShortOverlayRenderer`). Chromium for the whole Short is a
 * Job's work, so only the Sidecar reaches this. One frame of the same
 * composition is `ShortOverlayFrameService` (`short-overlay-frame.ts`). A
 * service so tests can fake it: no test here may drive a real Chromium render.
 */
export class ShortOverlayRendererService extends Effect.Service<ShortOverlayRendererService>()(
  "ShortOverlayRendererService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const executor = yield* CommandExecutor.CommandExecutor;

      /** The whole overlay as a transparent ProRes 4444 `.mov`: a Job's work. */
      const renderVideo = Effect.fn("renderShortOverlayVideo")(function* (
        props: ShortOverlayProps,
        outputPath: string
      ) {
        // Chromium for the whole Short: only the Sidecar provides this.
        yield* SidecarContext;
        yield* runShortOverlayRenderer(props, ["--out", outputPath]).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        );
      });

      return { renderVideo };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
